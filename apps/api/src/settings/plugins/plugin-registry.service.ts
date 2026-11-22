import { Injectable } from '@nestjs/common';
import type { Dirent, Stats } from 'node:fs';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { isSameOrInside, toPathPlatform } from '@/common/utils/path.util';
import { AppPathsService } from '@/core/app-paths/app-paths.service';
import { PathGuardService } from '@/core/path-guard/path-guard.service';
import {
  MAX_DISCOVERED_PLUGINS,
  MAX_PLUGIN_MANIFEST_BYTES,
  PLUGIN_API_VERSION,
  PLUGIN_CAPABILITIES,
} from '@/settings/plugins/interfaces/plugin.types';
import type {
  IDiscoveredPlugin,
  IInvalidPluginManifest,
  IPluginExtensionPoint,
  IPluginsCatalog,
} from '@/settings/plugins/interfaces/plugin.types';
import { validatePluginManifest } from '@/settings/plugins/plugin-manifest.validator';
import type { IPluginsSettings } from '@/settings/schema/settings.schema';

export const PLUGIN_MANIFEST_FILE_NAME = 'pkgsteward.plugin.json';

export interface IPluginRegistryFs {
  readdir(dirPath: string): Promise<Dirent[]>;
  lstat(
    targetPath: string,
  ): Promise<Pick<Stats, 'isDirectory' | 'isFile' | 'isSymbolicLink' | 'size'>>;
  realpath(targetPath: string): Promise<string>;
  readFile(filePath: string): Promise<string>;
}

const defaultFs: IPluginRegistryFs = {
  readdir: (dirPath) => readdir(dirPath, { withFileTypes: true }),
  lstat: (targetPath) => lstat(targetPath),
  realpath: (targetPath) => realpath(targetPath),
  readFile: (filePath) => readFile(filePath, 'utf8'),
};

const EXTENSION_POINTS: readonly IPluginExtensionPoint[] =
  PLUGIN_CAPABILITIES.map((capability) => ({
    capability,
    apiVersion: PLUGIN_API_VERSION,
    status: 'schema-ready',
  }));

@Injectable()
export class PluginRegistryService {
  private readonly platform = toPathPlatform();
  private fsAdapter: IPluginRegistryFs = defaultFs;

  constructor(
    private readonly appPaths: AppPathsService,
    private readonly pathGuard: PathGuardService,
  ) {}

  setFsAdapterForTest(adapter: IPluginRegistryFs): void {
    this.fsAdapter = adapter;
  }

  resolvePluginsDir(settings: IPluginsSettings): string {
    return settings.directory ?? this.appPaths.pluginsDir;
  }

  async discover(settings: IPluginsSettings): Promise<IPluginsCatalog> {
    const pluginsDir = this.resolvePluginsDir(settings);
    const baseCatalog: IPluginsCatalog = {
      apiVersion: PLUGIN_API_VERSION,
      runtimeMode: 'manifest-only',
      pluginsEnabled: settings.enabled,
      allowLocalPlugins: settings.allowLocalPlugins,
      pluginsDir,
      extensionPoints: [...EXTENSION_POINTS],
      discovered: [],
      invalid: [],
    };

    if (
      settings.directory !== null &&
      (await this.pathGuard.findDenyReason(pluginsDir)) !== null
    ) {
      baseCatalog.invalid.push({
        directoryName: '.',
        manifestPath: pluginsDir,
        error: 'Custom plugins directory falls inside a protected tree',
      });
      return baseCatalog;
    }

    let dirEntries: Dirent[];
    let dirReal: string;
    try {
      const dirStat = await this.fsAdapter.lstat(pluginsDir);
      if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
        baseCatalog.invalid.push({
          directoryName: '.',
          manifestPath: pluginsDir,
          error: 'Plugins directory must be a real non-symlink directory',
        });
        return baseCatalog;
      }
      dirReal = await this.fsAdapter.realpath(pluginsDir);
      if (
        settings.directory !== null &&
        (await this.pathGuard.findDenyReason(dirReal)) !== null
      ) {
        baseCatalog.invalid.push({
          directoryName: '.',
          manifestPath: pluginsDir,
          error: 'Custom plugins directory resolves inside a protected tree',
        });
        return baseCatalog;
      }
      dirEntries = await this.fsAdapter.readdir(dirReal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return baseCatalog;
      }
      baseCatalog.invalid.push({
        directoryName: '.',
        manifestPath: pluginsDir,
        error: `Cannot read plugins directory: ${(error as Error).message}`,
      });
      return baseCatalog;
    }

    const discovered: IDiscoveredPlugin[] = [];
    const invalid: IInvalidPluginManifest[] = [];
    const subdirs = dirEntries
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, MAX_DISCOVERED_PLUGINS);

    for (const subdir of subdirs) {
      const pluginDir = join(dirReal, subdir.name);
      const manifestPath = join(pluginDir, PLUGIN_MANIFEST_FILE_NAME);
      try {
        const subStat = await this.fsAdapter.lstat(pluginDir);
        if (subStat.isSymbolicLink() || !subStat.isDirectory()) {
          continue;
        }
        const subReal = await this.fsAdapter.realpath(pluginDir);
        if (!isSameOrInside(subReal, dirReal, this.platform)) {
          invalid.push({
            directoryName: subdir.name,
            manifestPath,
            error:
              'Plugin directory resolves outside configured plugins directory',
          });
          continue;
        }
        if (
          settings.directory !== null &&
          (await this.pathGuard.isInsideProtectedTree(subReal))
        ) {
          invalid.push({
            directoryName: subdir.name,
            manifestPath,
            error: 'Plugin directory falls inside a protected tree',
          });
          continue;
        }

        const manifestStat = await this.fsAdapter.lstat(manifestPath);
        if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
          invalid.push({
            directoryName: subdir.name,
            manifestPath,
            error: 'Manifest must be a regular non-symlink file',
          });
          continue;
        }
        if (manifestStat.size > MAX_PLUGIN_MANIFEST_BYTES) {
          invalid.push({
            directoryName: subdir.name,
            manifestPath,
            error: `Manifest exceeds ${MAX_PLUGIN_MANIFEST_BYTES} bytes`,
          });
          continue;
        }
        const manifestReal = await this.fsAdapter.realpath(manifestPath);
        if (!isSameOrInside(manifestReal, subReal, this.platform)) {
          invalid.push({
            directoryName: subdir.name,
            manifestPath,
            error: 'Manifest resolves outside plugin directory',
          });
          continue;
        }

        const raw = await this.fsAdapter.readFile(manifestReal);
        if (Buffer.byteLength(raw, 'utf8') > MAX_PLUGIN_MANIFEST_BYTES) {
          invalid.push({
            directoryName: subdir.name,
            manifestPath,
            error: `Manifest exceeds ${MAX_PLUGIN_MANIFEST_BYTES} bytes`,
          });
          continue;
        }
        const parsedJson = JSON.parse(raw.replace(/^\uFEFF/, '')) as unknown;
        const manifest = validatePluginManifest(parsedJson);
        const savedEntry = settings.entries[manifest.id];
        const schemaDefaults: Record<string, string | number | boolean | null> =
          {};
        for (const field of manifest.settingsSchema) {
          schemaDefaults[field.key] = field.defaultValue;
        }

        discovered.push({
          id: manifest.id,
          name: manifest.name,
          version: manifest.version,
          apiVersion: manifest.apiVersion,
          description: manifest.description ?? null,
          author: manifest.author ?? null,
          homepage: manifest.homepage ?? null,
          capabilities: manifest.capabilities,
          minAppVersion: manifest.minAppVersion ?? null,
          manifestPath: manifestReal,
          source: 'local',
          enabled: Boolean(
            settings.enabled &&
            settings.allowLocalPlugins &&
            savedEntry?.enabled,
          ),
          config: { ...schemaDefaults, ...(savedEntry?.config ?? {}) },
          settingsSchema: manifest.settingsSchema,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          continue;
        }
        invalid.push({
          directoryName: subdir.name,
          manifestPath,
          error: (error as Error).message,
        });
      }
    }

    return { ...baseCatalog, discovered, invalid };
  }
}
