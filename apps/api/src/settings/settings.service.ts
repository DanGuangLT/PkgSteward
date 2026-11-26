import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
  ConflictException,
  NotFoundException,
  ValidationException,
} from '@/common/exceptions/app.exception';
import { hasTraversalSegment, toPathPlatform } from '@/common/utils/path.util';
import { readRawSettingsOverrides } from '@/config/config-loader';
import { AppMode, validateEnv } from '@/config/environment/env.validation';
import { parseScanRootPaths } from '@/config/environment/scan-roots';
import { AppPathsService } from '@/core/app-paths/app-paths.service';
import {
  isDataDirWriteError,
  wrapDataDirWriteError,
} from '@/core/app-paths/app-paths.util';
import { AuditLogService } from '@/core/audit-log/audit-log.service';
import { MutationGateService } from '@/core/mutation-gate/mutation-gate.service';
import { PathGuardService } from '@/core/path-guard/path-guard.service';
import { RuntimeConfigService } from '@/core/runtime-config/runtime-config.service';
import {
  DRIVE_DETECTOR,
  type IDriveDetector,
} from '@/platform/interfaces/drive-detector.interface';
import { DiskUsageService } from '@/disk-usage/disk-usage.service';
import { FileOpsService } from '@/file-ops/file-ops.service';
import { ProjectsService } from '@/projects/projects.service';
import { ScannerService } from '@/scanner/scanner.service';
import type {
  IPluginManifest,
  IPluginsCatalog,
} from '@/settings/plugins/interfaces/plugin.types';
import { PluginInstallerService } from '@/settings/plugins/plugin-installer.service';
import { PluginRegistryService } from '@/settings/plugins/plugin-registry.service';
import {
  DEFAULT_WALLPAPER_PLUGIN_ID,
  ensurePreinstalledWallpaperPlugin,
} from '@/settings/plugins/preinstalled-wallpaper';
import type { ISettingsService } from '@/settings/interfaces/settings.service.interface';
import type {
  IPluginInstallPreviewResponse,
  IPluginSandboxDocumentResponse,
  IPluginUninstallPreviewResponse,
  ISettingDiffItem,
  ISettingsExportResponse,
  ISettingsPreviewResponse,
  ISettingsRisk,
  ISettingsRiskReason,
  ISettingsSnapshot,
  SettingsResetScope,
  SettingValueSource,
} from '@/settings/interfaces/settings.types';
import {
  applyOverridesToDocument,
  createDefaultSettingsDocument,
  migrateLegacyFlatSettings,
  parseStructuredSettingsOverrides,
  SETTINGS_SCHEMA_VERSION,
} from '@/settings/schema/settings.schema';
import type {
  IRuntimeSettings,
  IServerSettings,
  ISettingsDocument,
  ISettingsOverrides,
  PrimitiveConfigValue,
} from '@/settings/schema/settings.schema';

export const SETTINGS_PROCESS_ENV = Symbol('SETTINGS_PROCESS_ENV');
const PREVIEW_TTL_MS = 10 * 60 * 1000;
const MAX_STORED_PREVIEWS = 20;
const MAX_IMPORT_JSON_BYTES = 256 * 1024;

interface IStoredPreview {
  previewId: string;
  action: 'update' | 'import' | 'reset';
  baseHash: string;
  targetOverrides: ISettingsOverrides;
  targetDocument: ISettingsDocument;
  changes: ISettingDiffItem[];
  clearsScanCache: boolean;
  risk: ISettingsRisk;
  expiresAtMs: number;
}

const RUNTIME_ENV_KEYS: Record<keyof IRuntimeSettings, string> = {
  scanRootPaths: 'SCAN_ROOT_PATHS',
  maxScanDepth: 'MAX_SCAN_DEPTH',
  scanTimeoutMs: 'SCAN_TIMEOUT_MS',
  npmCommandTimeoutMs: 'NPM_COMMAND_TIMEOUT_MS',
};

const SERVER_ENV_KEYS: Record<keyof IServerSettings, string> = {
  mode: 'MODE',
  host: 'HOST',
  port: 'PORT',
  globalPrefix: 'GLOBAL_PREFIX',
  version: 'VERSION',
  listOriginCors: 'LIST_ORIGIN_CORS',
  exportSwaggerApiJson: 'EXPORT_SWAGGER_API_JSON',
};

const hashJson = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

const hasNonBlankEnv = (
  env: Readonly<Record<string, string | undefined>>,
  key: string,
): boolean => typeof env[key] === 'string' && env[key].trim() !== '';

@Injectable()
export class SettingsService implements ISettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private readonly platform = toPathPlatform();
  private readonly previews = new Map<string, IStoredPreview>();
  private writePending: Promise<void> = Promise.resolve();

  constructor(
    private readonly appPaths: AppPathsService,
    private readonly runtimeConfig: RuntimeConfigService,
    private readonly pathGuard: PathGuardService,
    private readonly auditLog: AuditLogService,
    private readonly gate: MutationGateService,
    private readonly scanner: ScannerService,
    private readonly diskUsage: DiskUsageService,
    private readonly fileOps: FileOpsService,
    private readonly projects: ProjectsService,
    private readonly pluginRegistry: PluginRegistryService,
    private readonly pluginInstaller: PluginInstallerService,
    @Optional()
    @Inject(DRIVE_DETECTOR)
    private readonly driveDetector?: IDriveDetector,
    @Optional()
    @Inject(SETTINGS_PROCESS_ENV)
    private readonly injectedEnv?: Readonly<Record<string, string | undefined>>,
  ) {}

  async initializePreinstalledPlugins(): Promise<void> {
    const { document } = await this.readCurrentState();
    await this.pluginInstaller.ensurePreinstalled(document.plugins);
  }

  private envSource(): Readonly<Record<string, string | undefined>> {
    return (
      this.injectedEnv ?? this.runtimeConfig.getStartupEnvOnly() ?? process.env
    );
  }

  async getSnapshot(): Promise<ISettingsSnapshot> {
    const { document, sources } = await this.readCurrentState();
    const plugins = await this.pluginRegistry.discover(document.plugins);
    let availableDrives: string[] = [];
    try {
      availableDrives = (await this.driveDetector?.listFixedDrives()) ?? [];
    } catch (error) {
      this.logger.warn(
        'Could not detect fixed drives for settings snapshot',
        error,
      );
    }
    return {
      document,
      sources,
      restartRequiredFields: this.computeRestartRequiredFields(document.server),
      availableDrives,
      systemPaths: {
        settingsFilePath: this.appPaths.settingsFilePath,
        dataDir: this.appPaths.dataDir,
        logsDir: this.appPaths.logsDir,
        cacheDir: this.appPaths.cacheDir,
        pluginsDir: this.appPaths.pluginsDir,
        auditLogFilePath: this.appPaths.auditLogFilePath,
        appInstallDir: this.appPaths.appInstallDir,
        sourceCheckoutDir: this.appPaths.sourceCheckoutDir,
        platform: process.platform,
        nodeVersion: process.versions.node,
      },
      plugins,
    };
  }

  async getPluginsCatalog(): Promise<IPluginsCatalog> {
    const { document } = await this.readCurrentState();
    return this.pluginRegistry.discover(document.plugins);
  }

  async previewPluginInstallFromUrl(
    url: string,
  ): Promise<IPluginInstallPreviewResponse> {
    const { document } = await this.readCurrentState();
    return this.pluginInstaller.previewInstallFromUrl(document.plugins, url);
  }

  async previewPluginInstallFromFile(
    fileName: string,
    buffer: Buffer,
  ): Promise<IPluginInstallPreviewResponse> {
    const { document } = await this.readCurrentState();
    return this.pluginInstaller.previewInstallFromFile(
      document.plugins,
      fileName,
      buffer,
    );
  }

  async executePluginInstall(input: {
    previewId: string;
    confirm: boolean;
    acknowledgedRisks?: string[];
  }): Promise<ISettingsSnapshot> {
    const { document } = await this.readCurrentState();
    await this.pluginInstaller.executeInstall(
      document.plugins,
      input,
      async (manifest) => {
        await this.enqueueWrite(async () => {
          const latest = await this.readCurrentState();
          const currentPlugins = latest.overrides.plugins ?? {};
          const existingEntries = currentPlugins.entries ?? {};
          const existingEntry = existingEntries[manifest.id];
          const defaultsFromSchema = this.extractSchemaDefaults(manifest);
          const existingConfig = existingEntry?.config ?? {};
          const mergedConfig: Record<string, PrimitiveConfigValue> = {
            ...defaultsFromSchema,
            ...existingConfig,
          };
          const nextRemoved = (currentPlugins.removedPreinstalled ?? []).filter(
            (id) => id !== manifest.id,
          );
          const nextOverrides: ISettingsOverrides = {
            ...latest.overrides,
            schemaVersion: SETTINGS_SCHEMA_VERSION,
            plugins: {
              ...currentPlugins,
              removedPreinstalled: nextRemoved,
              entries: {
                ...structuredClone(existingEntries),
                [manifest.id]: {
                  enabled: true,
                  source:
                    existingEntry?.source ??
                    (manifest.id === DEFAULT_WALLPAPER_PLUGIN_ID
                      ? 'builtin'
                      : 'local'),
                  config: mergedConfig,
                },
              },
            },
          };
          await this.writeOverridesAtomic(nextOverrides);
        });
      },
    );
    return this.getSnapshot();
  }

  async previewPluginUninstall(
    pluginId: string,
  ): Promise<IPluginUninstallPreviewResponse> {
    const { document } = await this.readCurrentState();
    return this.pluginInstaller.previewUninstall(document.plugins, pluginId);
  }

  async executePluginUninstall(input: {
    previewId: string;
    confirm: boolean;
  }): Promise<ISettingsSnapshot> {
    const { document } = await this.readCurrentState();
    await this.pluginInstaller.executeUninstall(
      document.plugins,
      input,
      async (pluginId, wasPreinstalled) => {
        await this.enqueueWrite(async () => {
          const latest = await this.readCurrentState();
          const currentPlugins = latest.overrides.plugins ?? {};
          const nextEntries = currentPlugins.entries
            ? structuredClone(currentPlugins.entries)
            : {};
          delete nextEntries[pluginId];

          const existingRemoved = new Set(
            currentPlugins.removedPreinstalled ?? [],
          );
          if (wasPreinstalled) {
            existingRemoved.add(pluginId);
          }

          const nextOverrides: ISettingsOverrides = {
            ...latest.overrides,
            schemaVersion: SETTINGS_SCHEMA_VERSION,
            plugins: {
              ...currentPlugins,
              removedPreinstalled: [...existingRemoved],
              entries: nextEntries,
            },
          };
          await this.writeOverridesAtomic(nextOverrides);
        });
      },
    );
    return this.getSnapshot();
  }

  async restoreDefaultPlugins(): Promise<ISettingsSnapshot> {
    let targetPlugins = (await this.readCurrentState()).document.plugins;
    await this.enqueueWrite(async () => {
      const latest = await this.readCurrentState();
      const currentPlugins = latest.overrides.plugins ?? {};
      const nextEntries = currentPlugins.entries
        ? structuredClone(currentPlugins.entries)
        : {};
      const existingDefault = nextEntries[DEFAULT_WALLPAPER_PLUGIN_ID];
      nextEntries[DEFAULT_WALLPAPER_PLUGIN_ID] = {
        enabled: true,
        source: existingDefault?.source ?? 'builtin',
        config: existingDefault?.config ?? {},
      };
      const nextRemoved = (currentPlugins.removedPreinstalled ?? []).filter(
        (id) => id !== DEFAULT_WALLPAPER_PLUGIN_ID,
      );
      const nextOverrides: ISettingsOverrides = {
        ...latest.overrides,
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        plugins: {
          ...currentPlugins,
          removedPreinstalled: nextRemoved,
          entries: nextEntries,
        },
      };
      await this.writeOverridesAtomic(nextOverrides);
      targetPlugins = this.materializeDocument(nextOverrides).plugins;
    });

    await ensurePreinstalledWallpaperPlugin(
      this.pluginRegistry.resolvePluginsDir(targetPlugins),
      targetPlugins.removedPreinstalled,
    );
    return this.getSnapshot();
  }

  async uploadWallpaperMedia(
    fileName: string,
    buffer: Buffer,
  ): Promise<ISettingsSnapshot> {
    const { document } = await this.readCurrentState();
    const saved = await this.pluginInstaller.saveWallpaperMedia(
      document.plugins,
      fileName,
      buffer,
    );

    await this.enqueueWrite(async () => {
      const latest = await this.readCurrentState();
      const currentPlugins = latest.overrides.plugins ?? {};
      const nextEntries = currentPlugins.entries
        ? structuredClone(currentPlugins.entries)
        : {};
      const existingEntry = nextEntries[DEFAULT_WALLPAPER_PLUGIN_ID];
      nextEntries[DEFAULT_WALLPAPER_PLUGIN_ID] = {
        enabled: true,
        source: 'builtin',
        config: {
          ...(existingEntry?.config ?? {}),
          mode: saved.mediaType,
          mediaSource: 'local',
          mediaAsset: saved.assetPath,
        },
      };
      const nextRemoved = (currentPlugins.removedPreinstalled ?? []).filter(
        (id) => id !== DEFAULT_WALLPAPER_PLUGIN_ID,
      );
      const nextOverrides: ISettingsOverrides = {
        ...latest.overrides,
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        plugins: {
          ...currentPlugins,
          removedPreinstalled: nextRemoved,
          entries: nextEntries,
        },
      };
      await this.writeOverridesAtomic(nextOverrides);
    });

    return this.getSnapshot();
  }

  async getPluginAsset(
    pluginId: string,
    relativePath: string,
  ): Promise<{ absolutePath: string; contentType: string }> {
    const { document } = await this.readCurrentState();
    if (!document.plugins.enabled) {
      throw new ValidationException('Plugin subsystem is disabled');
    }
    return this.pluginRegistry.resolveSafeAssetPath(
      document.plugins,
      pluginId,
      relativePath,
    );
  }

  async getPluginSandboxDocument(
    pluginId: string,
  ): Promise<IPluginSandboxDocumentResponse> {
    const { document } = await this.readCurrentState();
    if (!document.plugins.enabled) {
      throw new ValidationException('Plugin subsystem is disabled');
    }
    return this.pluginRegistry.buildSandboxedHtmlDocument(
      document.plugins,
      pluginId,
    );
  }

  async exportSettings(): Promise<ISettingsExportResponse> {
    const { document } = await this.readCurrentState();
    return {
      exportedAt: new Date().toISOString(),
      document: structuredClone(document),
    };
  }

  async updatePreferences(
    patch: Record<string, unknown>,
  ): Promise<ISettingsSnapshot> {
    for (const key of Object.getOwnPropertyNames(patch)) {
      if (
        !['appearance', 'behavior', 'desktop', 'plugins'].includes(key) ||
        key === '__proto__'
      ) {
        throw new ValidationException(
          `Field "${key}" requires preview and confirmation via POST /settings/preview`,
        );
      }
    }

    if (patch.plugins !== undefined) {
      if (
        typeof patch.plugins !== 'object' ||
        patch.plugins === null ||
        Array.isArray(patch.plugins)
      ) {
        throw new ValidationException('"plugins" must be an object');
      }
      for (const pKey of Object.getOwnPropertyNames(patch.plugins)) {
        if (pKey !== 'enabled' && pKey !== 'entries') {
          throw new ValidationException(
            `Plugin field "plugins.${pKey}" requires preview and confirmation`,
          );
        }
      }
    }

    let parsedPatch: ISettingsOverrides;
    try {
      parsedPatch = parseStructuredSettingsOverrides(
        { schemaVersion: SETTINGS_SCHEMA_VERSION, ...patch },
        { platform: this.platform },
      );
    } catch (error) {
      throw new ValidationException((error as Error).message);
    }

    await this.enqueueWrite(async () => {
      const { overrides } = await this.readCurrentState();
      const merged = this.mergeOverrides(overrides, parsedPatch);
      try {
        parseStructuredSettingsOverrides(merged, { platform: this.platform });
      } catch (error) {
        throw new ValidationException((error as Error).message);
      }
      await this.writeOverridesAtomic(merged);
    });

    return this.getSnapshot();
  }

  async previewUpdate(
    patch: Record<string, unknown>,
  ): Promise<ISettingsPreviewResponse> {
    let parsedPatch: ISettingsOverrides;
    try {
      parsedPatch = parseStructuredSettingsOverrides(
        { schemaVersion: SETTINGS_SCHEMA_VERSION, ...patch },
        { platform: this.platform },
      );
    } catch (error) {
      throw new ValidationException((error as Error).message);
    }

    await this.assertPluginDirSafe(parsedPatch.plugins?.directory ?? null);
    const current = await this.readCurrentState();
    const targetOverrides = this.mergeOverrides(current.overrides, parsedPatch);
    const targetDocument = this.materializeDocument(targetOverrides);
    return this.createAndStorePreview(
      'update',
      current.document,
      targetOverrides,
      targetDocument,
    );
  }

  async previewImport(rawImport: unknown): Promise<ISettingsPreviewResponse> {
    if (
      typeof rawImport !== 'object' ||
      rawImport === null ||
      Array.isArray(rawImport)
    ) {
      throw new ValidationException('Imported settings must be a JSON object');
    }
    if (
      Buffer.byteLength(JSON.stringify(rawImport), 'utf8') >
      MAX_IMPORT_JSON_BYTES
    ) {
      throw new ValidationException(
        `Imported settings exceed ${MAX_IMPORT_JSON_BYTES} bytes`,
      );
    }

    let targetOverrides: ISettingsOverrides;
    try {
      const record = rawImport as Record<string, unknown>;
      targetOverrides =
        'schemaVersion' in record
          ? parseStructuredSettingsOverrides(record, {
              platform: this.platform,
            })
          : migrateLegacyFlatSettings(record, { platform: this.platform });
    } catch (error) {
      throw new ValidationException((error as Error).message);
    }

    await this.assertPluginDirSafe(targetOverrides.plugins?.directory ?? null);
    const current = await this.readCurrentState();
    const targetDocument = this.materializeDocument(targetOverrides);
    return this.createAndStorePreview(
      'import',
      current.document,
      targetOverrides,
      targetDocument,
    );
  }

  async previewReset(
    scope: SettingsResetScope,
  ): Promise<ISettingsPreviewResponse> {
    const current = await this.readCurrentState();
    const nextOverrides: ISettingsOverrides = structuredClone(
      current.overrides,
    );
    const defaults = createDefaultSettingsDocument();

    if (scope === 'appearance' || scope === 'all') {
      nextOverrides.appearance = { ...defaults.appearance };
    }
    if (scope === 'behavior' || scope === 'all') {
      nextOverrides.behavior = { ...defaults.behavior };
    }
    if (scope === 'plugins' || scope === 'all') {
      nextOverrides.plugins = {
        ...defaults.plugins,
        trustedRegistries: [],
        removedPreinstalled: [],
        entries: {},
      };
    }
    if (scope === 'runtime' || scope === 'all') {
      delete nextOverrides.runtime;
    }
    if (scope === 'server' || scope === 'all') {
      delete nextOverrides.server;
    }
    if (scope === 'all') {
      nextOverrides.desktop = {};
    }

    const targetDocument = this.materializeDocument(nextOverrides);
    return this.createAndStorePreview(
      'reset',
      current.document,
      nextOverrides,
      targetDocument,
      scope,
    );
  }

  async executePreviewedAction(
    expectedAction: 'update' | 'import' | 'reset',
    input: {
      previewId: string;
      confirm: boolean;
      acknowledgedRisks?: string[];
    },
  ): Promise<ISettingsSnapshot> {
    if (input.confirm !== true) {
      throw new ValidationException(
        'Explicit confirmation (confirm: true) is required',
      );
    }
    const preview = this.getValidPreview(input.previewId, expectedAction);
    const requiredHighRisks = [
      ...new Set(
        preview.risk.reasons
          .filter((reason) => reason.level === 'high')
          .map((reason) => reason.code),
      ),
    ];
    const ackSet = new Set(input.acknowledgedRisks ?? []);
    const missingAcks = requiredHighRisks.filter((code) => !ackSet.has(code));
    if (missingAcks.length > 0) {
      throw new ValidationException(
        `High-risk changes must be acknowledged: ${missingAcks.join(', ')}`,
      );
    }

    await this.assertPluginDirSafe(
      preview.targetOverrides.plugins?.directory ?? null,
    );

    const token = this.gate.tryEnter();
    if (!token) {
      throw new ConflictException(
        'A file operation or command run is already in progress',
      );
    }
    try {
      if (
        this.scanner.hasRunningScan() ||
        this.diskUsage.hasRunningMeasurement() ||
        this.fileOps.hasRunningPreview() ||
        this.projects.hasRunningAnalysis()
      ) {
        throw new ConflictException(
          'Cannot apply settings while a scan, disk measurement, file preview, or project analysis is running',
        );
      }

      const operation = `settings.${expectedAction}`;
      const targets =
        preview.changes.length > 0
          ? preview.changes.map((c) => c.path)
          : [this.appPaths.settingsFilePath];

      await this.enqueueWrite(async () => {
        const latest = await this.readCurrentState();
        if (hashJson(latest.document) !== preview.baseHash) {
          throw new ConflictException(
            'Settings changed after preview; please preview again',
          );
        }

        // Consume the preview token once preconditions pass and we write intent.
        this.previews.delete(preview.previewId);

        await this.auditLog.append({
          operation,
          operationId: preview.previewId,
          phase: 'intent',
          targets,
          method: expectedAction,
          risk: {
            level: preview.risk.level,
            codes: preview.risk.reasons.map((r) => r.code),
          },
          result: 'pending',
          errorCode: null,
        });

        try {
          await this.writeOverridesAtomic(preview.targetOverrides);
          await this.applyRuntimeSideEffects(
            latest.document,
            preview.targetDocument,
          );
          if (expectedAction === 'reset' && preview.targetOverrides.plugins) {
            await this.pluginInstaller.ensurePreinstalled(
              preview.targetDocument.plugins,
            );
          }
          await this.auditLog.append({
            operation,
            operationId: preview.previewId,
            phase: 'result',
            targets,
            method: expectedAction,
            risk: {
              level: preview.risk.level,
              codes: preview.risk.reasons.map((r) => r.code),
            },
            result: 'completed',
            errorCode: null,
          });
        } catch (error) {
          try {
            await this.auditLog.append({
              operation,
              operationId: preview.previewId,
              phase: 'result',
              targets,
              method: expectedAction,
              risk: {
                level: preview.risk.level,
                codes: preview.risk.reasons.map((r) => r.code),
              },
              result: 'failed',
              errorCode:
                error instanceof Error ? error.name : 'INTERNAL_SERVER_ERROR',
            });
          } catch (auditErr) {
            this.logger.warn('Failed to append failure audit record', auditErr);
          }
          throw error;
        }
      });
    } finally {
      this.gate.leave(token);
    }

    return this.getSnapshot();
  }

  private async readCurrentState(): Promise<{
    overrides: ISettingsOverrides;
    document: ISettingsDocument;
    sources: ISettingsSnapshot['sources'];
  }> {
    let rawOverrides: ISettingsOverrides | null = null;
    try {
      const content = await readFile(this.appPaths.settingsFilePath, 'utf8');
      rawOverrides = readRawSettingsOverrides(
        this.appPaths.settingsFilePath,
        () => content,
        this.platform,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    const overrides: ISettingsOverrides = rawOverrides ?? {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
    };
    const document = this.materializeDocument(overrides);
    const sources = this.computeSources(overrides);
    return { overrides, document, sources };
  }

  private readEnvBaseline(): {
    runtime: IRuntimeSettings;
    server: IServerSettings;
  } {
    const defaults = createDefaultSettingsDocument();
    const sourceEnv = this.envSource();
    try {
      const envOnly: Record<string, string | undefined> = {};
      for (const envKey of Object.values(RUNTIME_ENV_KEYS)) {
        if (hasNonBlankEnv(sourceEnv, envKey)) {
          envOnly[envKey] = sourceEnv[envKey];
        }
      }
      for (const envKey of Object.values(SERVER_ENV_KEYS)) {
        if (hasNonBlankEnv(sourceEnv, envKey)) {
          envOnly[envKey] = sourceEnv[envKey];
        }
      }
      if (Object.keys(envOnly).length === 0) {
        return {
          runtime: { ...defaults.runtime },
          server: { ...defaults.server },
        };
      }
      const validated = validateEnv(envOnly, this.platform);
      return {
        runtime: {
          scanRootPaths: validated.SCAN_ROOT_PATHS ?? '*',
          maxScanDepth: validated.MAX_SCAN_DEPTH ?? 0,
          scanTimeoutMs: validated.SCAN_TIMEOUT_MS ?? null,
          npmCommandTimeoutMs: validated.NPM_COMMAND_TIMEOUT_MS ?? null,
        },
        server: {
          mode:
            validated.MODE === AppMode.Production
              ? 'production'
              : 'development',
          host:
            validated.HOST === 'localhost' ||
            validated.HOST === '::1' ||
            validated.HOST === '127.0.0.1'
              ? validated.HOST
              : '127.0.0.1',
          port: validated.PORT ?? 24681,
          globalPrefix: validated.GLOBAL_PREFIX ?? 'api',
          version: validated.VERSION ?? '1',
          listOriginCors:
            validated.LIST_ORIGIN_CORS ?? 'http://localhost:24680',
          exportSwaggerApiJson: validated.EXPORT_SWAGGER_API_JSON ?? true,
        },
      };
    } catch {
      return {
        runtime: this.runtimeConfig.getRuntimeSnapshot(),
        server: { ...this.runtimeConfig.getStartupServerConfig() },
      };
    }
  }

  private materializeDocument(
    overrides: ISettingsOverrides,
  ): ISettingsDocument {
    const envBase = this.readEnvBaseline();
    const base = createDefaultSettingsDocument();
    base.runtime = envBase.runtime;
    base.server = envBase.server;
    return applyOverridesToDocument(base, overrides);
  }

  private computeSources(
    overrides: ISettingsOverrides,
  ): ISettingsSnapshot['sources'] {
    const sourceEnv = this.envSource();
    const runtimeSources = {} as Record<
      keyof IRuntimeSettings,
      SettingValueSource
    >;
    for (const field of Object.keys(
      RUNTIME_ENV_KEYS,
    ) as (keyof IRuntimeSettings)[]) {
      if (overrides.runtime && field in overrides.runtime) {
        runtimeSources[field] = 'settings';
      } else if (hasNonBlankEnv(sourceEnv, RUNTIME_ENV_KEYS[field])) {
        runtimeSources[field] = 'env';
      } else {
        runtimeSources[field] = 'default';
      }
    }

    const serverSources = {} as Record<
      keyof IServerSettings,
      SettingValueSource
    >;
    for (const field of Object.keys(
      SERVER_ENV_KEYS,
    ) as (keyof IServerSettings)[]) {
      if (overrides.server && field in overrides.server) {
        serverSources[field] = 'settings';
      } else if (hasNonBlankEnv(sourceEnv, SERVER_ENV_KEYS[field])) {
        serverSources[field] = 'env';
      } else {
        serverSources[field] = 'default';
      }
    }
    return { runtime: runtimeSources, server: serverSources };
  }

  private computeRestartRequiredFields(
    effectiveServer: IServerSettings,
  ): (keyof IServerSettings)[] {
    const startup = this.runtimeConfig.getStartupServerConfig();
    const changed: (keyof IServerSettings)[] = [];
    for (const field of Object.keys(startup) as (keyof IServerSettings)[]) {
      if (effectiveServer[field] !== startup[field]) {
        changed.push(field);
      }
    }
    return changed;
  }

  private mergeOverrides(
    current: ISettingsOverrides,
    patch: ISettingsOverrides,
  ): ISettingsOverrides {
    const next: ISettingsOverrides = {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      ...(current.runtime || patch.runtime
        ? { runtime: { ...current.runtime, ...patch.runtime } }
        : {}),
      ...(current.server || patch.server
        ? { server: { ...current.server, ...patch.server } }
        : {}),
      ...(current.appearance || patch.appearance
        ? { appearance: { ...current.appearance, ...patch.appearance } }
        : {}),
      ...(current.behavior || patch.behavior
        ? { behavior: { ...current.behavior, ...patch.behavior } }
        : {}),
      ...(current.desktop || patch.desktop
        ? { desktop: { ...current.desktop, ...patch.desktop } }
        : {}),
    };

    if (current.plugins || patch.plugins) {
      next.plugins = {
        ...(current.plugins?.enabled !== undefined ||
        patch.plugins?.enabled !== undefined
          ? {
              enabled:
                patch.plugins?.enabled ?? current.plugins?.enabled ?? false,
            }
          : {}),
        ...(current.plugins?.directory !== undefined ||
        patch.plugins?.directory !== undefined
          ? {
              directory:
                patch.plugins?.directory !== undefined
                  ? patch.plugins.directory
                  : (current.plugins?.directory ?? null),
            }
          : {}),
        ...(current.plugins?.allowLocalPlugins !== undefined ||
        patch.plugins?.allowLocalPlugins !== undefined
          ? {
              allowLocalPlugins:
                patch.plugins?.allowLocalPlugins ??
                current.plugins?.allowLocalPlugins ??
                false,
            }
          : {}),
        ...(current.plugins?.trustedRegistries !== undefined ||
        patch.plugins?.trustedRegistries !== undefined
          ? {
              trustedRegistries:
                patch.plugins?.trustedRegistries !== undefined
                  ? [...patch.plugins.trustedRegistries]
                  : [...(current.plugins?.trustedRegistries ?? [])],
            }
          : {}),
        ...(current.plugins?.removedPreinstalled !== undefined ||
        patch.plugins?.removedPreinstalled !== undefined
          ? {
              removedPreinstalled:
                patch.plugins?.removedPreinstalled !== undefined
                  ? [...patch.plugins.removedPreinstalled]
                  : [...(current.plugins?.removedPreinstalled ?? [])],
            }
          : {}),
        ...(current.plugins?.entries !== undefined ||
        patch.plugins?.entries !== undefined
          ? {
              entries: {
                ...(current.plugins?.entries
                  ? structuredClone(current.plugins.entries)
                  : {}),
                ...(patch.plugins?.entries
                  ? structuredClone(patch.plugins.entries)
                  : {}),
              },
            }
          : {}),
      };
    }

    return next;
  }

  private async assertPluginDirSafe(directory: string | null): Promise<void> {
    if (!directory) return;
    if (directory.includes('\0') || hasTraversalSegment(directory)) {
      throw new ValidationException(
        'plugins.directory must not contain null bytes or ".." traversal segments',
      );
    }
    if ((await this.pathGuard.findDenyReason(directory)) !== null) {
      throw new ValidationException(
        'plugins.directory cannot point inside a protected system or application directory',
      );
    }

    try {
      const stat = await lstat(directory);
      if (stat.isSymbolicLink()) {
        throw new ValidationException(
          'plugins.directory cannot be a symbolic link or junction',
        );
      }
    } catch (error) {
      if (error instanceof ValidationException) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        throw new ValidationException(
          `Cannot inspect plugins.directory "${directory}": ${(error as Error).message}`,
        );
      }
    }

    let probe = directory;
    const suffix: string[] = [];
    while (true) {
      try {
        const realProbe = await realpath(probe);
        const candidate =
          suffix.length > 0 ? join(realProbe, ...suffix.reverse()) : realProbe;
        if ((await this.pathGuard.findDenyReason(candidate)) !== null) {
          throw new ValidationException(
            'plugins.directory cannot resolve inside a protected system or application directory',
          );
        }
        break;
      } catch (error) {
        if (error instanceof ValidationException) throw error;
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') {
          const parent = dirname(probe);
          if (parent === probe) break;
          suffix.push(basename(probe));
          probe = parent;
          continue;
        }
        throw new ValidationException(
          `Cannot inspect plugins.directory "${directory}": ${(error as Error).message}`,
        );
      }
    }
  }

  private createAndStorePreview(
    action: 'update' | 'import' | 'reset',
    currentDoc: ISettingsDocument,
    targetOverrides: ISettingsOverrides,
    targetDocument: ISettingsDocument,
    resetScope?: SettingsResetScope,
  ): ISettingsPreviewResponse {
    const changes = this.diffDocuments(currentDoc, targetDocument);
    const hotReloadFields = changes
      .filter((c) => c.effect === 'hot-reload')
      .map((c) => c.path);
    const restartRequiredFields = changes
      .filter((c) => c.effect === 'restart-required')
      .map((c) => c.path);
    const clearsScanCache =
      currentDoc.runtime.scanRootPaths !==
        targetDocument.runtime.scanRootPaths ||
      currentDoc.runtime.maxScanDepth !== targetDocument.runtime.maxScanDepth;

    const risk = this.assessSettingsRisk(
      action,
      currentDoc,
      targetDocument,
      changes,
      resetScope,
    );

    this.prunePreviews();
    const previewId = randomUUID();
    const expiresAtMs = Date.now() + PREVIEW_TTL_MS;
    this.previews.set(previewId, {
      previewId,
      action,
      baseHash: hashJson(currentDoc),
      targetOverrides: structuredClone(targetOverrides),
      targetDocument: structuredClone(targetDocument),
      changes,
      clearsScanCache,
      risk,
      expiresAtMs,
    });

    return {
      previewId,
      action,
      expiresAt: new Date(expiresAtMs).toISOString(),
      changes,
      hotReloadFields,
      restartRequiredFields,
      clearsScanCache,
      risk,
      targetDocument,
      targetOverrides,
    };
  }

  private diffDocuments(
    beforeDoc: ISettingsDocument,
    afterDoc: ISettingsDocument,
  ): ISettingDiffItem[] {
    const items: ISettingDiffItem[] = [];
    const compareFlat = (
      prefix: string,
      a: Record<string, unknown>,
      b: Record<string, unknown>,
      effect: ISettingDiffItem['effect'],
    ) => {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const key of [...keys].sort()) {
        if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
          items.push({
            path: `${prefix}.${key}`,
            before: a[key],
            after: b[key],
            effect,
          });
        }
      }
    };

    compareFlat(
      'runtime',
      beforeDoc.runtime as unknown as Record<string, unknown>,
      afterDoc.runtime as unknown as Record<string, unknown>,
      'hot-reload',
    );
    compareFlat(
      'server',
      beforeDoc.server as unknown as Record<string, unknown>,
      afterDoc.server as unknown as Record<string, unknown>,
      'restart-required',
    );
    compareFlat(
      'appearance',
      beforeDoc.appearance as unknown as Record<string, unknown>,
      afterDoc.appearance as unknown as Record<string, unknown>,
      'instant',
    );
    compareFlat(
      'behavior',
      beforeDoc.behavior as unknown as Record<string, unknown>,
      afterDoc.behavior as unknown as Record<string, unknown>,
      'instant',
    );
    compareFlat(
      'plugins',
      beforeDoc.plugins as unknown as Record<string, unknown>,
      afterDoc.plugins as unknown as Record<string, unknown>,
      'instant',
    );
    compareFlat('desktop', beforeDoc.desktop, afterDoc.desktop, 'instant');
    return items;
  }

  private assessSettingsRisk(
    action: 'update' | 'import' | 'reset',
    beforeDoc: ISettingsDocument,
    afterDoc: ISettingsDocument,
    changes: ISettingDiffItem[],
    resetScope?: SettingsResetScope,
  ): ISettingsRisk {
    const reasons: ISettingsRiskReason[] = [];
    const push = (reason: ISettingsRiskReason) => {
      if (!reasons.some((r) => r.code === reason.code)) {
        reasons.push(reason);
      }
    };

    if (
      parseScanRootPaths(beforeDoc.runtime.scanRootPaths, this.platform)
        .kind !== 'all-fixed-drives' &&
      parseScanRootPaths(afterDoc.runtime.scanRootPaths, this.platform).kind ===
        'all-fixed-drives'
    ) {
      push({
        code: 'BROAD_SCAN_ROOTS',
        level: 'high',
        message:
          'Scanning all fixed drives ("*") grants path access across every non-protected directory on all fixed drives.',
      });
    }

    if (
      beforeDoc.runtime.scanRootPaths !== afterDoc.runtime.scanRootPaths ||
      beforeDoc.runtime.maxScanDepth !== afterDoc.runtime.maxScanDepth
    ) {
      push({
        code: 'SCAN_SCOPE_CHANGED',
        level: 'medium',
        message:
          'Changing scan root paths or depth clears existing scan and disk-usage caches.',
      });
    }

    if (changes.some((c) => c.effect === 'restart-required')) {
      push({
        code: 'SERVER_RESTART_REQUIRED',
        level: 'medium',
        message:
          'Server listener/CORS/API settings require restarting the backend process to take effect.',
      });
    }

    const enablingLocalPlugins =
      afterDoc.plugins.allowLocalPlugins &&
      !beforeDoc.plugins.allowLocalPlugins;
    const changingPluginDir =
      afterDoc.plugins.directory !== beforeDoc.plugins.directory &&
      afterDoc.plugins.directory !== null;
    if (enablingLocalPlugins || changingPluginDir) {
      push({
        code: 'PLUGINS_LOCAL_ENABLED',
        level: 'high',
        message:
          'Allowing local plugin discovery reads plugin manifests from disk (executable plugins remain disabled in v1.0).',
      });
    }

    if (action === 'reset' && changes.length > 0) {
      push({
        code: 'SETTINGS_RESET',
        level:
          resetScope === 'all' ||
          resetScope === 'runtime' ||
          resetScope === 'server'
            ? 'medium'
            : 'low',
        message: `Resets ${resetScope ?? 'selected'} settings section(s) cleanly.`,
      });
    }

    const level = reasons.some((r) => r.level === 'high')
      ? 'high'
      : reasons.some((r) => r.level === 'medium')
        ? 'medium'
        : 'low';
    return { level, reasons };
  }

  private prunePreviews(): void {
    const now = Date.now();
    for (const [id, item] of this.previews) {
      if (item.expiresAtMs <= now) {
        this.previews.delete(id);
      }
    }
    while (this.previews.size >= MAX_STORED_PREVIEWS) {
      const oldestKey = this.previews.keys().next().value;
      if (oldestKey === undefined) break;
      this.previews.delete(oldestKey);
    }
  }

  private getValidPreview(
    previewId: string,
    expectedAction: 'update' | 'import' | 'reset',
  ): IStoredPreview {
    const preview = this.previews.get(previewId);
    if (!preview || preview.action !== expectedAction) {
      throw new NotFoundException('Settings preview', previewId);
    }
    if (preview.expiresAtMs <= Date.now()) {
      this.previews.delete(previewId);
      throw new ValidationException(
        'Settings preview expired; generate a new preview',
      );
    }
    return preview;
  }

  private async applyRuntimeSideEffects(
    prevDoc: ISettingsDocument,
    nextDoc: ISettingsDocument,
  ): Promise<void> {
    const liveRuntime = this.runtimeConfig.getRuntimeSnapshot();
    this.runtimeConfig.applyRuntimeUpdate(nextDoc.runtime);

    if (
      prevDoc.runtime.scanRootPaths !== nextDoc.runtime.scanRootPaths ||
      liveRuntime.scanRootPaths !== nextDoc.runtime.scanRootPaths
    ) {
      this.pathGuard.reloadScanRoots(nextDoc.runtime.scanRootPaths);
    }

    if (
      prevDoc.runtime.scanRootPaths !== nextDoc.runtime.scanRootPaths ||
      liveRuntime.scanRootPaths !== nextDoc.runtime.scanRootPaths ||
      prevDoc.runtime.maxScanDepth !== nextDoc.runtime.maxScanDepth ||
      liveRuntime.maxScanDepth !== nextDoc.runtime.maxScanDepth
    ) {
      await this.scanner.invalidateForConfigChange();
      this.diskUsage.clearCache();
      this.projects.invalidateAllAfterMutation();
    }
  }

  private extractSchemaDefaults(
    manifest: IPluginManifest,
  ): Record<string, PrimitiveConfigValue> {
    const defaults: Record<string, PrimitiveConfigValue> = {};
    for (const field of manifest.settingsSchema) {
      if (field.defaultValue !== undefined) {
        defaults[field.key] = field.defaultValue;
      }
    }
    return defaults;
  }

  private enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writePending.then(task);
    this.writePending = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async writeOverridesAtomic(
    overrides: ISettingsOverrides,
  ): Promise<void> {
    const filePath = this.appPaths.settingsFilePath;
    const serialized = `${JSON.stringify(overrides, null, 2)}\n`;
    const tempPath = `${filePath}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(filePath), { recursive: true });
      // Validate round-trip before rename so corrupt JSON never replaces settings.json
      const verifyParsed = parseStructuredSettingsOverrides(
        JSON.parse(serialized),
        { platform: this.platform },
      );
      void verifyParsed;
      await writeFile(tempPath, serialized, 'utf8');
      await rename(tempPath, filePath);
    } catch (error) {
      if (isDataDirWriteError(error)) {
        throw wrapDataDirWriteError(this.appPaths.dataDir, filePath, error);
      }
      throw error;
    } finally {
      try {
        await unlink(tempPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          this.logger.warn(
            `Could not remove temporary settings file ${tempPath}`,
            error,
          );
        }
      }
    }
  }
}
