import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { lookup as nodeDnsLookup } from 'node:dns/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { isIP, type LookupFunction } from 'node:net';
import { basename, extname, join } from 'node:path';
import {
  ConflictException,
  NotFoundException,
  ValidationException,
} from '@/common/exceptions/app.exception';
import { isSameOrInside, toPathPlatform } from '@/common/utils/path.util';
import {
  isDataDirWriteError,
  wrapDataDirWriteError,
} from '@/core/app-paths/app-paths.util';
import { AuditLogService } from '@/core/audit-log/audit-log.service';
import { MutationGateService } from '@/core/mutation-gate/mutation-gate.service';
import { PathGuardService } from '@/core/path-guard/path-guard.service';
import type {
  IPluginInstallPreviewResponse,
  IPluginUninstallPreviewResponse,
  ISettingsRisk,
  ISettingsRiskReason,
} from '@/settings/interfaces/settings.types';
import {
  PLUGIN_ID_REGEX,
  PLUGIN_MANIFEST_FILENAMES,
} from '@/settings/plugins/interfaces/plugin.types';
import type {
  IPluginManifest,
  PluginManifestFormat,
} from '@/settings/plugins/interfaces/plugin.types';
import {
  normalizeStandardPluginManifest,
  slugifyPluginId,
} from '@/settings/plugins/plugin-manifest.validator';
import { PluginRegistryService } from '@/settings/plugins/plugin-registry.service';
import {
  DEFAULT_WALLPAPER_PLUGIN_ID,
  ensurePreinstalledWallpaperPlugin,
  WALLPAPER_INSTALL_MARKER_FILE,
} from '@/settings/plugins/preinstalled-wallpaper';
import {
  extractTarGzBuffer,
  extractZipBuffer,
  MAX_PLUGIN_ARCHIVE_BYTES,
  MAX_PLUGIN_UNCOMPRESSED_BYTES,
} from '@/settings/plugins/safe-archive.util';
import type { IExtractedArchiveFile } from '@/settings/plugins/safe-archive.util';
import type { IPluginsSettings } from '@/settings/schema/settings.schema';

const PREVIEW_TTL_MS = 10 * 60 * 1000;
const MAX_STORED_PREVIEWS = 20;
const MAX_REMOTE_REDIRECTS = 5;
const REMOTE_FETCH_TIMEOUT_MS = 20_000;

export type DnsLookupFn = (
  hostname: string,
) => Promise<ReadonlyArray<{ address: string }>>;
type RemoteDestination =
  | { kind: 'loopback'; hostname: 'localhost' | '127.0.0.1' | '::1' }
  | { kind: 'https'; address: string };

// Preserve both localhost address families without consulting DNS.
const lookupLocalhost: LookupFunction = (_host, options, callback) => {
  const ipv6 = { address: '::1', family: 6 };
  const ipv4 = { address: '127.0.0.1', family: 4 };
  const addresses =
    options.family === 4 || options.family === 'IPv4'
      ? [ipv4]
      : options.family === 6 || options.family === 'IPv6'
        ? [ipv6]
        : [ipv6, ipv4];
  if (options.all) callback(null, addresses);
  else callback(null, addresses[0].address, addresses[0].family);
};

interface IStagedInstallPreview {
  kind: 'install';
  previewId: string;
  sourceKind: 'file' | 'url';
  sourceLabel: string;
  sourceUrl: string | null;
  manifest: IPluginManifest;
  format: PluginManifestFormat;
  files: IExtractedArchiveFile[];
  totalBytes: number;
  willOverwrite: boolean;
  risk: ISettingsRisk;
  expiresAtMs: number;
}

interface IStagedUninstallPreview {
  kind: 'uninstall';
  previewId: string;
  pluginId: string;
  pluginName: string;
  preinstalled: boolean;
  targetDir: string;
  risk: ISettingsRisk;
  expiresAtMs: number;
}

type IStoredPluginPreview = IStagedInstallPreview | IStagedUninstallPreview;

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.ogg']);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.').map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  ) {
    return null;
  }
  return (
    ((parts[0] << 24) >>> 0) +
    ((parts[1] << 16) >>> 0) +
    ((parts[2] << 8) >>> 0) +
    (parts[3] >>> 0)
  );
}

function isForbiddenIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true;
  const inCidr = (baseIp: string, bits: number): boolean => {
    const base = ipv4ToInt(baseIp)!;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) === (base & mask);
  };
  return (
    inCidr('0.0.0.0', 8) ||
    inCidr('10.0.0.0', 8) ||
    inCidr('100.64.0.0', 10) ||
    inCidr('127.0.0.0', 8) ||
    inCidr('169.254.0.0', 16) ||
    inCidr('172.16.0.0', 12) ||
    inCidr('192.0.0.0', 24) ||
    inCidr('192.0.2.0', 24) ||
    inCidr('192.168.0.0', 16) ||
    inCidr('198.18.0.0', 15) ||
    inCidr('198.51.100.0', 24) ||
    inCidr('203.0.113.0', 24) ||
    inCidr('224.0.0.0', 4) ||
    inCidr('240.0.0.0', 4)
  );
}

function parseIpv6Hextets(rawIp: string): number[] | null {
  const ip = rawIp.toLowerCase();
  const doubleColonParts = ip.split('::');
  if (doubleColonParts.length > 2) return null;

  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    const tokens = side.split(':');
    const out: number[] = [];
    for (let i = 0; i < tokens.length; i += 1) {
      const tok = tokens[i];
      if (!tok) return null;
      if (tok.includes('.')) {
        if (i !== tokens.length - 1 || isIP(tok) !== 4) return null;
        const v4 = tok.split('.').map((part) => Number(part));
        out.push(((v4[0] << 8) | v4[1]) & 0xffff);
        out.push(((v4[2] << 8) | v4[3]) & 0xffff);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(tok)) return null;
        out.push(Number.parseInt(tok, 16));
      }
    }
    return out;
  };

  if (doubleColonParts.length === 1) {
    const full = parseSide(doubleColonParts[0]);
    return full && full.length === 8 ? full : null;
  }

  const left = parseSide(doubleColonParts[0]);
  const right = parseSide(doubleColonParts[1]);
  if (!left || !right) return null;
  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;
  return [...left, ...new Array<number>(missing).fill(0), ...right];
}

function hextetPairToIpv4(hi: number, lo: number): string {
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

export function isForbiddenIpAddress(rawIp: string): boolean {
  const ip = rawIp
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  const zoneIdx = ip.indexOf('%');
  const cleanIp = zoneIdx >= 0 ? ip.slice(0, zoneIdx) : ip;
  const ver = isIP(cleanIp);
  if (ver === 4) return isForbiddenIpv4(cleanIp);
  if (ver !== 6) return true;

  const h = parseIpv6Hextets(cleanIp);
  if (!h) return true;

  const isAllZero = h.every((part) => part === 0);
  if (isAllZero) return true; // ::/128
  if (h.slice(0, 7).every((part) => part === 0) && h[7] === 1) return true; // ::1/128

  // ::/96 deprecated IPv4-compatible IPv6
  if (h.slice(0, 6).every((part) => part === 0)) {
    return isForbiddenIpv4(hextetPairToIpv4(h[6], h[7]));
  }
  // ::ffff:0:0/96 IPv4-mapped IPv6
  if (h.slice(0, 5).every((part) => part === 0) && h[5] === 0xffff) {
    return isForbiddenIpv4(hextetPairToIpv4(h[6], h[7]));
  }
  // 64:ff9b::/96 & 64:ff9b:1::/48 NAT64
  if (
    h[0] === 0x0064 &&
    h[1] === 0xff9b &&
    ((h.slice(2, 6).every((part) => part === 0) &&
      isForbiddenIpv4(hextetPairToIpv4(h[6], h[7]))) ||
      h[2] === 0x0001)
  ) {
    return true;
  }
  if (h[0] === 0x0100 && h[1] === 0 && h[2] === 0 && h[3] === 0) return true; // 100::/64 discard
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true; // 2001:db8::/32 documentation
  if (h[0] === 0x2001 && h[1] === 0x0000) return true; // 2001::/32 Teredo
  if (h[0] === 0x2002) {
    // 2002::/16 6to4 embedded IPv4
    return isForbiddenIpv4(hextetPairToIpv4(h[1], h[2]));
  }
  if ((h[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((h[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 Link-local (fe80..febf)
  if ((h[0] & 0xff00) === 0xff00) return true; // ff00::/8 Multicast

  return false;
}

export function hasMatchingMediaMagic(
  fileName: string,
  buffer: unknown,
): boolean {
  if (typeof buffer !== 'object' || !Buffer.isBuffer(buffer)) return false;
  const ext = extname(fileName).toLowerCase();
  if (ext === '.png') {
    return (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    );
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    return (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    );
  }
  if (ext === '.gif') {
    return (
      buffer.length >= 6 &&
      (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' ||
        buffer.subarray(0, 6).toString('ascii') === 'GIF89a')
    );
  }
  if (ext === '.webp') {
    return (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  if (ext === '.webm') {
    return (
      buffer.length >= 4 &&
      buffer[0] === 0x1a &&
      buffer[1] === 0x45 &&
      buffer[2] === 0xdf &&
      buffer[3] === 0xa3
    );
  }
  if (ext === '.mp4' || ext === '.avif') {
    return (
      buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp'
    );
  }
  if (ext === '.ogg') {
    return (
      buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === 'OggS'
    );
  }
  if (ext === '.svg') {
    const head = buffer.subarray(0, 512).toString('utf8').toLowerCase();
    return head.includes('<svg') && !head.includes('<script');
  }
  return false;
}

@Injectable()
export class PluginInstallerService {
  private readonly logger = new Logger(PluginInstallerService.name);
  private readonly platform = toPathPlatform();
  private readonly previews = new Map<string, IStoredPluginPreview>();
  private lookupImpl: DnsLookupFn = (host) =>
    nodeDnsLookup(host, { all: true });

  constructor(
    private readonly registry: PluginRegistryService,
    private readonly pathGuard: PathGuardService,
    private readonly auditLog: AuditLogService,
    private readonly gate: MutationGateService,
  ) {}

  setNetworkAdaptersForTest(adapters: { lookup?: DnsLookupFn }): void {
    if (adapters.lookup) this.lookupImpl = adapters.lookup;
  }

  async ensurePreinstalled(pluginsSettings: IPluginsSettings): Promise<void> {
    if (pluginsSettings.directory !== null) return;
    const pluginsDir = this.registry.resolvePluginsDir(pluginsSettings);
    try {
      await ensurePreinstalledWallpaperPlugin(
        pluginsDir,
        pluginsSettings.removedPreinstalled ?? [],
      );
    } catch (error) {
      if (isDataDirWriteError(error)) {
        const dataDir =
          'getDataDir' in this.registry &&
          typeof this.registry.getDataDir === 'function'
            ? this.registry.getDataDir()
            : pluginsDir;
        throw wrapDataDirWriteError(dataDir, pluginsDir, error);
      }
      throw error;
    }
  }

  async previewInstallFromFile(
    pluginsSettings: IPluginsSettings,
    fileName: string,
    buffer: Buffer,
  ): Promise<IPluginInstallPreviewResponse> {
    this.assertCanModifyPlugins(pluginsSettings);
    if (typeof buffer !== 'object' || !Buffer.isBuffer(buffer)) {
      throw new ValidationException('Plugin file payload must be a Buffer');
    }
    if (buffer.length === 0) {
      throw new ValidationException('Plugin file payload cannot be empty');
    }
    if (buffer.length > MAX_PLUGIN_ARCHIVE_BYTES) {
      throw new ValidationException(
        `Plugin package exceeds ${MAX_PLUGIN_ARCHIVE_BYTES} bytes`,
      );
    }
    const safeName = basename(fileName.trim() || 'plugin.zip');
    return this.stagePackagePreview(
      pluginsSettings,
      safeName,
      buffer,
      'file',
      safeName,
      null,
    );
  }

  async previewInstallFromUrl(
    pluginsSettings: IPluginsSettings,
    rawInput: string,
  ): Promise<IPluginInstallPreviewResponse> {
    this.assertCanModifyPlugins(pluginsSettings);
    const trimmed = rawInput.trim();
    if (!trimmed) {
      throw new ValidationException('Plugin URL or package reference is empty');
    }

    const { downloadUrl, fallbackName } = await this.resolveDownloadTarget(
      pluginsSettings,
      trimmed,
    );
    const { buffer, finalFileName } = await this.downloadRemoteBytes(
      downloadUrl,
      pluginsSettings.trustedRegistries,
      fallbackName,
    );

    return this.stagePackagePreview(
      pluginsSettings,
      finalFileName,
      buffer,
      'url',
      trimmed,
      downloadUrl,
    );
  }

  async executeInstall(
    pluginsSettings: IPluginsSettings,
    input: {
      previewId: string;
      confirm: boolean;
      acknowledgedRisks?: string[];
    },
    onAfterInstall: (
      manifest: IPluginManifest,
      wasPreinstalledRemoved: boolean,
    ) => Promise<void>,
  ): Promise<{ pluginId: string }> {
    if (input.confirm !== true) {
      throw new ValidationException(
        'Explicit confirmation (confirm: true) is required',
      );
    }
    const preview = this.getValidPreview(input.previewId, 'install');
    this.assertHighRiskAck(preview.risk, input.acknowledgedRisks);
    this.assertCanModifyPlugins(pluginsSettings);

    const token = this.gate.tryEnter();
    if (!token) {
      throw new ConflictException(
        'A file operation or command run is already in progress',
      );
    }

    const operationId = preview.previewId;
    const targets = [
      preview.manifest.id,
      ...(preview.sourceUrl ? [preview.sourceUrl] : []),
    ];

    try {
      this.previews.delete(preview.previewId);
      await this.auditLog.append({
        operation: 'plugins.install',
        operationId,
        phase: 'intent',
        targets,
        method: preview.sourceKind,
        risk: {
          level: preview.risk.level,
          codes: preview.risk.reasons.map((r) => r.code),
        },
        result: 'pending',
        errorCode: null,
      });

      const pluginsDir = await this.resolveSafePluginsRoot(pluginsSettings);
      const targetDir = join(pluginsDir, preview.manifest.id);
      const stagingDir = join(pluginsDir, `.staging-${randomUUID()}`);

      try {
        await mkdir(stagingDir, { recursive: true });
        for (const file of preview.files) {
          const dest = join(stagingDir, ...file.relativePath.split('/'));
          await mkdir(join(dest, '..'), { recursive: true });
          await writeFile(dest, file.content);
        }

        await writeFile(
          join(stagingDir, WALLPAPER_INSTALL_MARKER_FILE),
          `${JSON.stringify(
            {
              preinstalled: preview.manifest.id === DEFAULT_WALLPAPER_PLUGIN_ID,
              sourceKind: preview.sourceKind,
              sourceUrl: preview.sourceUrl,
              installedAt: new Date().toISOString(),
            },
            null,
            2,
          )}\n`,
          'utf8',
        );

        await rm(targetDir, { recursive: true, force: true });
        await rename(stagingDir, targetDir);

        await onAfterInstall(
          preview.manifest,
          preview.manifest.id === DEFAULT_WALLPAPER_PLUGIN_ID,
        );

        await this.auditLog.append({
          operation: 'plugins.install',
          operationId,
          phase: 'result',
          targets,
          method: preview.sourceKind,
          risk: {
            level: preview.risk.level,
            codes: preview.risk.reasons.map((r) => r.code),
          },
          result: 'completed',
          errorCode: null,
        });
      } catch (error) {
        await rm(stagingDir, { recursive: true, force: true }).catch(
          () => undefined,
        );
        await this.auditLog
          .append({
            operation: 'plugins.install',
            operationId,
            phase: 'result',
            targets,
            method: preview.sourceKind,
            risk: {
              level: preview.risk.level,
              codes: preview.risk.reasons.map((r) => r.code),
            },
            result: 'failed',
            errorCode: error instanceof Error ? error.name : 'INSTALL_ERROR',
          })
          .catch((e) =>
            this.logger.warn('Failed to write plugin install audit log', e),
          );
        throw error;
      }

      return { pluginId: preview.manifest.id };
    } finally {
      this.gate.leave(token);
    }
  }

  async previewUninstall(
    pluginsSettings: IPluginsSettings,
    pluginId: string,
  ): Promise<IPluginUninstallPreviewResponse> {
    if (!PLUGIN_ID_REGEX.test(pluginId)) {
      throw new ValidationException(`Invalid plugin id "${pluginId}"`);
    }
    const catalog = await this.registry.discover(pluginsSettings);
    const plugin = catalog.discovered.find((item) => item.id === pluginId);
    if (!plugin) {
      throw new NotFoundException('Plugin', pluginId);
    }

    const pluginsDir = await this.resolveSafePluginsRoot(pluginsSettings);
    const pluginFolder = await this.findFolderRealByPluginId(
      pluginsDir,
      plugin.manifestPath,
      pluginId,
    );

    const reasons: ISettingsRiskReason[] = [
      {
        code: 'PLUGIN_UNINSTALL',
        level: 'medium',
        message: `Removes installed plugin "${plugin.name}" (${plugin.id}) from the plugins directory.`,
      },
    ];

    this.prunePreviews();
    const previewId = randomUUID();
    const expiresAtMs = Date.now() + PREVIEW_TTL_MS;
    const risk: ISettingsRisk = { level: 'medium', reasons };

    this.previews.set(previewId, {
      kind: 'uninstall',
      previewId,
      pluginId: plugin.id,
      pluginName: plugin.name,
      preinstalled: plugin.preinstalled,
      targetDir: pluginFolder,
      risk,
      expiresAtMs,
    });

    return {
      previewId,
      action: 'uninstall',
      expiresAt: new Date(expiresAtMs).toISOString(),
      pluginId: plugin.id,
      pluginName: plugin.name,
      preinstalled: plugin.preinstalled,
      targetDir: pluginFolder,
      risk,
    };
  }

  async executeUninstall(
    pluginsSettings: IPluginsSettings,
    input: { previewId: string; confirm: boolean },
    onAfterUninstall: (
      pluginId: string,
      wasPreinstalled: boolean,
    ) => Promise<void>,
  ): Promise<void> {
    if (input.confirm !== true) {
      throw new ValidationException(
        'Explicit confirmation (confirm: true) is required',
      );
    }
    const preview = this.getValidPreview(input.previewId, 'uninstall');
    const token = this.gate.tryEnter();
    if (!token) {
      throw new ConflictException(
        'A file operation or command run is already in progress',
      );
    }

    const targets = [preview.pluginId, preview.targetDir];
    try {
      this.previews.delete(preview.previewId);
      await this.auditLog.append({
        operation: 'plugins.uninstall',
        operationId: preview.previewId,
        phase: 'intent',
        targets,
        method: 'uninstall',
        risk: {
          level: preview.risk.level,
          codes: preview.risk.reasons.map((r) => r.code),
        },
        result: 'pending',
        errorCode: null,
      });

      try {
        const pluginsDir = await this.resolveSafePluginsRoot(pluginsSettings);
        const pluginsReal = await realpath(pluginsDir);
        const targetReal = await realpath(preview.targetDir);
        if (
          targetReal === pluginsReal ||
          !isSameOrInside(targetReal, pluginsReal, this.platform)
        ) {
          throw new ValidationException(
            'Refusing to remove directory outside configured plugins root',
          );
        }
        await rm(targetReal, { recursive: true, force: true });
        await onAfterUninstall(
          preview.pluginId,
          preview.preinstalled ||
            preview.pluginId === DEFAULT_WALLPAPER_PLUGIN_ID,
        );

        await this.auditLog.append({
          operation: 'plugins.uninstall',
          operationId: preview.previewId,
          phase: 'result',
          targets,
          method: 'uninstall',
          risk: {
            level: preview.risk.level,
            codes: preview.risk.reasons.map((r) => r.code),
          },
          result: 'completed',
          errorCode: null,
        });
      } catch (error) {
        await this.auditLog
          .append({
            operation: 'plugins.uninstall',
            operationId: preview.previewId,
            phase: 'result',
            targets,
            method: 'uninstall',
            risk: {
              level: preview.risk.level,
              codes: preview.risk.reasons.map((r) => r.code),
            },
            result: 'failed',
            errorCode: error instanceof Error ? error.name : 'UNINSTALL_ERROR',
          })
          .catch((e) =>
            this.logger.warn('Failed to write plugin uninstall audit log', e),
          );
        throw error;
      }
    } finally {
      this.gate.leave(token);
    }
  }

  async saveWallpaperMedia(
    pluginsSettings: IPluginsSettings,
    fileName: string,
    buffer: Buffer,
  ): Promise<{ assetPath: string; mediaType: 'image' | 'video' }> {
    if (typeof buffer !== 'object' || !Buffer.isBuffer(buffer)) {
      throw new ValidationException('Wallpaper media file must be a Buffer');
    }
    if (buffer.length === 0) {
      throw new ValidationException('Wallpaper media file is empty');
    }
    if (buffer.length > MAX_PLUGIN_ARCHIVE_BYTES) {
      throw new ValidationException(
        `Wallpaper media exceeds ${MAX_PLUGIN_ARCHIVE_BYTES} bytes`,
      );
    }
    const ext = extname(fileName.trim()).toLowerCase();
    const isImage = IMAGE_EXTS.has(ext);
    const isVideo = VIDEO_EXTS.has(ext);
    if (!isImage && !isVideo) {
      throw new ValidationException(
        `Unsupported wallpaper media extension "${ext}"`,
      );
    }
    if (!hasMatchingMediaMagic(fileName, buffer)) {
      throw new ValidationException(
        `File content does not match "${ext}" media format`,
      );
    }

    const pluginsDir = await this.resolveSafePluginsRoot(pluginsSettings);
    await ensurePreinstalledWallpaperPlugin(pluginsDir, []);

    const assetsDir = join(pluginsDir, DEFAULT_WALLPAPER_PLUGIN_ID, 'assets');
    await mkdir(assetsDir, { recursive: true });
    const safeFile = `custom-wallpaper${ext}`;
    const targetFile = join(assetsDir, safeFile);

    // Clean older custom-wallpaper.* files before saving the new one
    const existing = await readdir(assetsDir).catch(() => []);
    for (const oldFile of existing) {
      if (oldFile.startsWith('custom-wallpaper')) {
        await rm(join(assetsDir, oldFile), { force: true });
      }
    }
    await writeFile(targetFile, buffer);

    return {
      assetPath: `assets/${safeFile}`,
      mediaType: isVideo ? 'video' : 'image',
    };
  }

  private assertCanModifyPlugins(pluginsSettings: IPluginsSettings): void {
    if (!pluginsSettings.enabled || !pluginsSettings.allowLocalPlugins) {
      throw new ValidationException(
        'Plugins and local plugin packages must be enabled before installing',
      );
    }
  }

  private async resolveSafePluginsRoot(
    pluginsSettings: IPluginsSettings,
  ): Promise<string> {
    const pluginsDir = this.registry.resolvePluginsDir(pluginsSettings);
    if (
      pluginsSettings.directory !== null &&
      (await this.pathGuard.findDenyReason(pluginsDir)) !== null
    ) {
      throw new ValidationException(
        'Plugins directory points inside a protected location',
      );
    }
    await mkdir(pluginsDir, { recursive: true });
    const dirStat = await lstat(pluginsDir);
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
      throw new ValidationException(
        'Plugins directory must be a non-symlink directory',
      );
    }
    const real = await realpath(pluginsDir);
    if (
      pluginsSettings.directory !== null &&
      (await this.pathGuard.findDenyReason(real)) !== null
    ) {
      throw new ValidationException(
        'Plugins directory resolves inside a protected location',
      );
    }
    return real;
  }

  private async findFolderRealByPluginId(
    pluginsReal: string,
    manifestPath: string,
    pluginId: string,
  ): Promise<string> {
    const parentCandidate = join(manifestPath, '..');
    const folderReal = await realpath(parentCandidate);
    if (
      folderReal === pluginsReal ||
      !isSameOrInside(folderReal, pluginsReal, this.platform)
    ) {
      throw new ValidationException(
        `Plugin folder for "${pluginId}" is outside plugins root`,
      );
    }
    return folderReal;
  }

  private async resolveDownloadTarget(
    pluginsSettings: IPluginsSettings,
    rawInput: string,
  ): Promise<{ downloadUrl: string; fallbackName: string }> {
    const npmMatch =
      /^(?:npm:|https?:\/\/(?:www\.)?npmjs\.com\/package\/)([^\s?#]+)$/i.exec(
        rawInput,
      );
    if (npmMatch) {
      const pkgName = npmMatch[1].replace(/\/+$/, '');
      const metaUrl = `https://registry.npmjs.org/${encodeURIComponent(pkgName).replace(/%2F/gi, '%2f')}/latest`;
      const { buffer } = await this.downloadRemoteBytes(
        metaUrl,
        pluginsSettings.trustedRegistries,
        'package.json',
      );
      const parsed = JSON.parse(buffer.toString('utf8')) as {
        dist?: { tarball?: string };
      };
      if (!parsed.dist?.tarball) {
        throw new ValidationException(
          `npm package "${pkgName}" metadata has no tarball URL`,
        );
      }
      return {
        downloadUrl: parsed.dist.tarball,
        fallbackName: `${pkgName.replace(/[^a-z0-9._-]/gi, '-')}.tgz`,
      };
    }

    const ghMatch =
      /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(
        rawInput,
      );
    if (ghMatch) {
      const [, owner, repo] = ghMatch;
      const mainZip = `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/main`;
      return { downloadUrl: mainZip, fallbackName: `${repo}.zip` };
    }

    await this.assertSafeRemoteUrl(rawInput, pluginsSettings.trustedRegistries);
    const parsedUrl = new URL(rawInput);
    const seg =
      parsedUrl.pathname.split('/').filter(Boolean).pop() ?? 'plugin.zip';
    return { downloadUrl: rawInput, fallbackName: seg };
  }

  async assertSafeRemoteUrl(
    rawUrl: string,
    trustedRegistries: readonly string[],
  ): Promise<URL> {
    const validated = await this.validateAndPinRemoteUrl(
      rawUrl,
      trustedRegistries,
    );
    return validated.url;
  }

  private async validateAndPinRemoteUrl(
    rawUrl: string,
    trustedRegistries: readonly string[],
  ): Promise<{
    url: URL;
    destination: RemoteDestination;
  }> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new ValidationException(`Invalid plugin URL "${rawUrl}"`);
    }
    if (url.username !== '' || url.password !== '') {
      throw new ValidationException('Plugin URLs must not contain credentials');
    }

    const loopbackHost =
      url.hostname === 'localhost'
        ? 'localhost'
        : url.hostname === '127.0.0.1'
          ? '127.0.0.1'
          : url.hostname === '[::1]'
            ? '::1'
            : null;
    if (
      url.protocol === 'http:' &&
      loopbackHost !== null &&
      trustedRegistries.includes(url.origin)
    ) {
      return { url, destination: { kind: 'loopback', hostname: loopbackHost } };
    }
    if (url.protocol !== 'https:') {
      throw new ValidationException(
        'Only https:// URLs (or explicitly trusted loopback registries) are allowed',
      );
    }

    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host)) {
      if (isForbiddenIpAddress(host)) {
        throw new ValidationException(
          'Blocked plugin URL targeting private or loopback IP address',
        );
      }
      return { url, destination: { kind: 'https', address: host } };
    }

    let records: ReadonlyArray<{ address: string }>;
    try {
      records = await this.lookupImpl(host);
    } catch (error) {
      throw new ValidationException(
        `Could not resolve plugin host "${host}": ${(error as Error).message}`,
      );
    }
    const [first] = records;
    if (!first) {
      throw new ValidationException(`Host "${host}" resolved no addresses`);
    }
    for (const { address } of records) {
      if (!isIP(address) || isForbiddenIpAddress(address)) {
        throw new ValidationException(
          `Blocked plugin host "${host}" with an invalid or non-public IP address`,
        );
      }
    }
    return { url, destination: { kind: 'https', address: first.address } };
  }

  private async downloadRemoteBytes(
    initialUrl: string,
    trustedRegistries: readonly string[],
    fallbackName: string,
  ): Promise<{ buffer: Buffer; finalFileName: string }> {
    let currentUrl = initialUrl;
    let ghFallbackTried = false;

    for (let hop = 0; hop <= MAX_REMOTE_REDIRECTS; hop += 1) {
      const validated = await this.validateAndPinRemoteUrl(
        currentUrl,
        trustedRegistries,
      );

      const { status, headers, bodyBuffer } = await this.performRemoteGet(
        validated.url,
        validated.destination,
      );

      const location = headers.get('location');
      if (status >= 300 && status < 400 && location) {
        try {
          currentUrl = new URL(location, validated.url).toString();
        } catch {
          throw new ValidationException(
            'Invalid redirect URL returned while downloading plugin',
          );
        }
        continue;
      }

      if (
        status === 404 &&
        !ghFallbackTried &&
        validated.url.hostname.toLowerCase() === 'codeload.github.com' &&
        validated.url.pathname.endsWith('/zip/refs/heads/main')
      ) {
        ghFallbackTried = true;
        currentUrl = currentUrl.replace(
          /\/zip\/refs\/heads\/main$/,
          '/zip/refs/heads/master',
        );
        continue;
      }

      if (status < 200 || status >= 300) {
        throw new ValidationException(
          `Remote plugin download failed with HTTP ${status}`,
        );
      }

      const disposition = headers.get('content-disposition') ?? '';
      const dispMatch = /filename\*?=(?:UTF-8'')?["']?([^"';\s]+)/i.exec(
        disposition,
      );
      const urlName = validated.url.pathname.split('/').filter(Boolean).pop();
      const finalFileName = basename(dispMatch?.[1] ?? urlName ?? fallbackName);
      return { buffer: bodyBuffer, finalFileName };
    }

    throw new ValidationException(
      'Too many redirects while downloading plugin',
    );
  }

  private performRemoteGet(
    url: URL,
    destination: RemoteDestination,
  ): Promise<{ status: number; headers: Headers; bodyBuffer: Buffer }> {
    return new Promise((resolve, reject) => {
      const loopback = destination.kind === 'loopback';
      const request = loopback ? http.request : https.request;
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      // Connect only to a checked IP or a fixed loopback destination.
      const req = request(
        {
          ...(loopback
            ? {
                hostname: destination.hostname,
                port: url.port || 80,
                lookup: lookupLocalhost,
                signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS),
              }
            : {
                hostname: destination.address,
                port: Number(url.port || '443'),
                servername: isIP(hostname) ? '' : hostname,
                rejectUnauthorized: true,
              }),
          path: `${url.pathname}${url.search}`,
          agent: false,
          method: 'GET',
          timeout: REMOTE_FETCH_TIMEOUT_MS,
          headers: {
            Host: url.host,
            'User-Agent': 'PkgSteward-PluginInstaller/1.0',
          },
        },
        (res) => {
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (Array.isArray(value)) {
              for (const v of value) responseHeaders.append(key, v);
            } else if (typeof value === 'string') {
              responseHeaders.set(key, value);
            }
          }

          const contentLen = Number(responseHeaders.get('content-length'));
          if (
            Number.isFinite(contentLen) &&
            contentLen > MAX_PLUGIN_ARCHIVE_BYTES
          ) {
            res.destroy();
            reject(
              new ValidationException(
                `Remote plugin exceeds ${MAX_PLUGIN_ARCHIVE_BYTES} bytes limit`,
              ),
            );
            return;
          }

          const chunks: Buffer[] = [];
          let total = 0;
          res.on('data', (chunk: Buffer) => {
            total += chunk.length;
            if (total > MAX_PLUGIN_ARCHIVE_BYTES) {
              res.destroy();
              reject(
                new ValidationException(
                  `Remote plugin exceeds ${MAX_PLUGIN_ARCHIVE_BYTES} bytes limit`,
                ),
              );
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            resolve({
              status: res.statusCode ?? 502,
              headers: responseHeaders,
              bodyBuffer: Buffer.concat(chunks),
            });
          });
          res.on('error', (err) => reject(err));
        },
      );

      req.on('timeout', () => {
        req.destroy(
          new ValidationException('Timed out while downloading remote plugin'),
        );
      });
      req.on('error', (err) => {
        if (err instanceof ValidationException) {
          reject(err);
        } else {
          reject(
            new ValidationException(
              `Remote plugin request failed: ${err.message}`,
            ),
          );
        }
      });
      req.end();
    });
  }

  private async stagePackagePreview(
    pluginsSettings: IPluginsSettings,
    fileName: string,
    buffer: Buffer,
    sourceKind: 'file' | 'url',
    sourceLabel: string,
    sourceUrl: string | null,
  ): Promise<IPluginInstallPreviewResponse> {
    const lower = fileName.toLowerCase();
    let files: IExtractedArchiveFile[];

    try {
      if (lower.endsWith('.zip')) {
        files = extractZipBuffer(buffer);
      } else if (lower.endsWith('.tgz') || lower.endsWith('.tar.gz')) {
        files = extractTarGzBuffer(buffer);
      } else if (lower.endsWith('.json')) {
        const format: PluginManifestFormat = PLUGIN_MANIFEST_FILENAMES.includes(
          lower as PluginManifestFormat,
        )
          ? (lower as PluginManifestFormat)
          : 'manifest.json';
        files = [{ relativePath: format, content: buffer }];
      } else if (lower.endsWith('.html') || lower.endsWith('.htm')) {
        const title = basename(fileName, extname(fileName)) || 'Web Wallpaper';
        const autoProject = {
          title,
          type: 'web',
          file: 'index.html',
          description:
            'Single-file HTML live wallpaper installed via PkgSteward',
        };
        files = [
          {
            relativePath: 'project.json',
            content: Buffer.from(`${JSON.stringify(autoProject, null, 2)}\n`),
          },
          { relativePath: 'index.html', content: buffer },
        ];
      } else if (
        IMAGE_EXTS.has(extname(lower)) ||
        VIDEO_EXTS.has(extname(lower))
      ) {
        const ext = extname(lower);
        if (!hasMatchingMediaMagic(fileName, buffer)) {
          throw new ValidationException(
            `File content does not match "${ext}" media signature`,
          );
        }
        const mediaType = VIDEO_EXTS.has(ext) ? 'video' : 'image';
        const title = basename(fileName, ext) || 'Media Wallpaper';
        const autoProject = {
          title,
          type: mediaType,
          file: `media${ext}`,
          description: `Custom ${mediaType} wallpaper installed via PkgSteward`,
        };
        files = [
          {
            relativePath: 'project.json',
            content: Buffer.from(`${JSON.stringify(autoProject, null, 2)}\n`),
          },
          { relativePath: `media${ext}`, content: buffer },
        ];
      } else {
        throw new ValidationException(
          `Unsupported plugin package file "${fileName}". Use .zip, .tgz, .json, .html, image, or video.`,
        );
      }
    } catch (error) {
      if (error instanceof ValidationException) throw error;
      throw new ValidationException((error as Error).message);
    }

    const totalBytes = files.reduce((acc, { content }) => {
      if (typeof content !== 'object' || !Buffer.isBuffer(content)) {
        throw new ValidationException('Plugin entry content must be a Buffer');
      }
      return acc + content.length;
    }, 0);
    if (totalBytes > MAX_PLUGIN_UNCOMPRESSED_BYTES) {
      throw new ValidationException(
        `Extracted plugin exceeds ${MAX_PLUGIN_UNCOMPRESSED_BYTES} bytes`,
      );
    }

    let chosenFormat: PluginManifestFormat | null = null;
    let chosenFile: IExtractedArchiveFile | undefined;
    for (const fmt of PLUGIN_MANIFEST_FILENAMES) {
      const hit = files.find((f) => f.relativePath.toLowerCase() === fmt);
      if (hit) {
        chosenFormat = fmt;
        chosenFile = hit;
        break;
      }
    }
    if (!chosenFormat || !chosenFile) {
      throw new ValidationException(
        `Plugin package must include one of: ${PLUGIN_MANIFEST_FILENAMES.join(', ')}`,
      );
    }

    let manifest: IPluginManifest;
    try {
      const parsedJson = JSON.parse(
        chosenFile.content.toString('utf8').replace(/^\uFEFF/, ''),
      ) as unknown;
      const parsedRecord =
        typeof parsedJson === 'object' && parsedJson !== null
          ? (parsedJson as Record<string, unknown>)
          : null;
      const explicitManifestTitle =
        parsedRecord &&
        typeof parsedRecord.title === 'string' &&
        parsedRecord.title.trim()
          ? parsedRecord.title
          : parsedRecord &&
              typeof parsedRecord.name === 'string' &&
              parsedRecord.name.trim()
            ? parsedRecord.name
            : undefined;
      const fallbackId = slugifyPluginId(
        explicitManifestTitle ??
          (basename(fileName, extname(fileName)) || 'custom-plugin'),
      );
      manifest = normalizeStandardPluginManifest(
        chosenFormat,
        parsedJson,
        fallbackId,
      );
    } catch (error) {
      throw new ValidationException(
        `Invalid ${chosenFormat}: ${(error as Error).message}`,
      );
    }

    const entry = manifest.entry ?? { kind: 'none', file: null };
    if (entry.file) {
      const hasEntryFile = files.some(
        (f) => f.relativePath.toLowerCase() === entry.file!.toLowerCase(),
      );
      if (!hasEntryFile) {
        throw new ValidationException(
          `Manifest references missing entry file "${entry.file}"`,
        );
      }
    }

    const catalog = await this.registry.discover(pluginsSettings);
    const willOverwrite = catalog.discovered.some(
      (item) => item.id === manifest.id,
    );

    const reasons: ISettingsRiskReason[] = [];
    if (sourceKind === 'url') {
      reasons.push({
        code: 'PLUGIN_INSTALL_REMOTE',
        level: 'high',
        message: `Downloads and extracts external plugin content from "${sourceLabel}".`,
      });
    }
    if (entry.kind === 'web-sandbox') {
      reasons.push({
        code: 'PLUGIN_SANDBOX_SCRIPT',
        level: 'high',
        message:
          'Plugin contains interactive HTML/JS wallpaper code executed inside an isolated null-origin iframe sandbox (connect-src none).',
      });
    }
    if (willOverwrite) {
      reasons.push({
        code: 'PLUGIN_OVERWRITE',
        level: 'medium',
        message: `Replaces existing plugin folder "${manifest.id}".`,
      });
    }

    const level = reasons.some((r) => r.level === 'high')
      ? 'high'
      : reasons.some((r) => r.level === 'medium')
        ? 'medium'
        : 'low';
    const risk: ISettingsRisk = { level, reasons };

    this.prunePreviews();
    const previewId = randomUUID();
    const expiresAtMs = Date.now() + PREVIEW_TTL_MS;
    this.previews.set(previewId, {
      kind: 'install',
      previewId,
      sourceKind,
      sourceLabel,
      sourceUrl,
      manifest,
      format: chosenFormat,
      files,
      totalBytes,
      willOverwrite,
      risk,
      expiresAtMs,
    });

    return {
      previewId,
      action: 'install',
      expiresAt: new Date(expiresAtMs).toISOString(),
      sourceKind,
      sourceLabel,
      pluginId: manifest.id,
      pluginName: manifest.name,
      version: manifest.version,
      format: chosenFormat,
      entryKind: entry.kind,
      fileCount: files.length,
      totalBytes,
      willOverwrite,
      risk,
    };
  }

  private assertHighRiskAck(risk: ISettingsRisk, acks?: string[]): void {
    const required = [
      ...new Set(
        risk.reasons.filter((r) => r.level === 'high').map((r) => r.code),
      ),
    ];
    const ackSet = new Set(acks ?? []);
    const missing = required.filter((code) => !ackSet.has(code));
    if (missing.length > 0) {
      throw new ValidationException(
        `High-risk plugin changes must be acknowledged: ${missing.join(', ')}`,
      );
    }
  }

  private prunePreviews(): void {
    const now = Date.now();
    for (const [id, item] of this.previews) {
      if (item.expiresAtMs <= now) {
        this.previews.delete(id);
      }
    }
    while (this.previews.size >= MAX_STORED_PREVIEWS) {
      const oldest = this.previews.keys().next().value;
      if (oldest === undefined) break;
      this.previews.delete(oldest);
    }
  }

  private getValidPreview<K extends 'install' | 'uninstall'>(
    previewId: string,
    expectedKind: K,
  ): Extract<IStoredPluginPreview, { kind: K }> {
    const item = this.previews.get(previewId);
    if (!item || item.kind !== expectedKind) {
      throw new NotFoundException('Plugin action preview', previewId);
    }
    if (item.expiresAtMs <= Date.now()) {
      this.previews.delete(previewId);
      throw new ValidationException(
        'Plugin preview expired; generate a new preview',
      );
    }
    return item as Extract<IStoredPluginPreview, { kind: K }>;
  }
}

export async function readSafePluginAssetBytes(
  filePath: string,
): Promise<Buffer> {
  return readFile(filePath);
}
