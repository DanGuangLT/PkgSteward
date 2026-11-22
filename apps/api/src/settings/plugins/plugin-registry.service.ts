import { Injectable } from '@nestjs/common';
import type { Dirent, Stats } from 'node:fs';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { extname, join } from 'node:path';
import {
  NotFoundException,
  ValidationException,
} from '@/common/exceptions/app.exception';
import { isSameOrInside, toPathPlatform } from '@/common/utils/path.util';
import { AppPathsService } from '@/core/app-paths/app-paths.service';
import { PathGuardService } from '@/core/path-guard/path-guard.service';
import {
  MAX_DISCOVERED_PLUGINS,
  MAX_PLUGIN_MANIFEST_BYTES,
  PLUGIN_API_VERSION,
  PLUGIN_CAPABILITIES,
  PLUGIN_ID_REGEX,
  PLUGIN_MANIFEST_FILENAMES,
} from '@/settings/plugins/interfaces/plugin.types';
import type {
  IDiscoveredPlugin,
  IInvalidPluginManifest,
  IPluginExtensionPoint,
  IPluginManifest,
  IPluginOrigin,
  IPluginsCatalog,
  PluginManifestFormat,
} from '@/settings/plugins/interfaces/plugin.types';
import {
  normalizeStandardPluginManifest,
  sanitizeRelativeAssetRef,
} from '@/settings/plugins/plugin-manifest.validator';
import {
  DEFAULT_WALLPAPER_PLUGIN_ID,
  WALLPAPER_INSTALL_MARKER_FILE,
} from '@/settings/plugins/preinstalled-wallpaper';
import type { IPluginsSettings } from '@/settings/schema/settings.schema';

export const PLUGIN_MANIFEST_FILE_NAME = 'pkgsteward.plugin.json';

const MAX_SANDBOX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_SANDBOX_TOTAL_INLINED_BYTES = 5 * 1024 * 1024;

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
    status:
      capability === 'live-wallpaper' || capability === 'theme-preset'
        ? 'schema-ready'
        : 'planned',
  }));

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const SANDBOX_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' blob:",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'media-src data: blob:',
  'font-src data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
].join('; ');

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
    const removedList = settings.removedPreinstalled ?? [];
    const baseCatalog: IPluginsCatalog = {
      apiVersion: PLUGIN_API_VERSION,
      runtimeMode: 'sandboxed-web',
      pluginsEnabled: settings.enabled,
      allowLocalPlugins: settings.allowLocalPlugins,
      preinstalledAvailable: removedList.includes(DEFAULT_WALLPAPER_PLUGIN_ID),
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
      const fallbackManifestPath = join(pluginDir, PLUGIN_MANIFEST_FILE_NAME);
      try {
        const subStat = await this.fsAdapter.lstat(pluginDir);
        if (subStat.isSymbolicLink() || !subStat.isDirectory()) {
          continue;
        }
        const subReal = await this.fsAdapter.realpath(pluginDir);
        if (!isSameOrInside(subReal, dirReal, this.platform)) {
          invalid.push({
            directoryName: subdir.name,
            manifestPath: fallbackManifestPath,
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
            manifestPath: fallbackManifestPath,
            error: 'Plugin directory falls inside a protected tree',
          });
          continue;
        }

        const located = await this.readPluginManifestFromDir(
          subReal,
          subdir.name,
        );
        if (!located) {
          continue;
        }

        const marker = await this.readInstallMarker(subReal);
        const manifest = located.manifest;
        const savedEntry = settings.entries[manifest.id];
        const schemaDefaults: Record<string, string | number | boolean | null> =
          {};
        for (const field of manifest.settingsSchema) {
          schemaDefaults[field.key] = field.defaultValue;
        }

        const isPreinstalled =
          marker.preinstalled || manifest.id === DEFAULT_WALLPAPER_PLUGIN_ID;

        discovered.push({
          id: manifest.id,
          name: manifest.name,
          version: manifest.version,
          apiVersion: manifest.apiVersion,
          format: manifest.format ?? located.format,
          entry: manifest.entry ?? { kind: 'none', file: null },
          description: manifest.description ?? null,
          author: manifest.author ?? null,
          homepage: manifest.homepage ?? null,
          capabilities: manifest.capabilities,
          minAppVersion: manifest.minAppVersion ?? null,
          manifestPath: located.manifestPath,
          source: 'local',
          preinstalled: isPreinstalled,
          removable: true,
          origin: marker.origin,
          enabled: Boolean(
            settings.enabled &&
            settings.allowLocalPlugins &&
            (savedEntry?.enabled ?? isPreinstalled),
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
          manifestPath:
            (error as { manifestPath?: string }).manifestPath ??
            fallbackManifestPath,
          error: (error as Error).message,
        });
      }
    }

    return {
      ...baseCatalog,
      preinstalledAvailable:
        removedList.includes(DEFAULT_WALLPAPER_PLUGIN_ID) ||
        !discovered.some((plugin) => plugin.id === DEFAULT_WALLPAPER_PLUGIN_ID),
      discovered,
      invalid,
    };
  }

  async resolveSafeAssetPath(
    settings: IPluginsSettings,
    pluginId: string,
    relativeAssetPath: string,
  ): Promise<{ absolutePath: string; contentType: string }> {
    if (!PLUGIN_ID_REGEX.test(pluginId)) {
      throw new ValidationException('Invalid plugin id');
    }
    let cleanRel: string;
    try {
      cleanRel = sanitizeRelativeAssetRef(relativeAssetPath, 'assetPath');
    } catch (error) {
      throw new ValidationException((error as Error).message);
    }

    const ext = extname(cleanRel).toLowerCase();
    const contentType = MIME_BY_EXT[ext];
    if (!contentType) {
      throw new ValidationException(
        `Unsupported plugin asset extension "${ext}"`,
      );
    }

    const pluginsDir = this.resolvePluginsDir(settings);
    let pluginsReal: string;
    try {
      pluginsReal = await realpath(pluginsDir);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        throw new NotFoundException('Plugin asset', cleanRel);
      }
      throw error;
    }
    if (
      settings.directory !== null &&
      (await this.pathGuard.findDenyReason(pluginsReal)) !== null
    ) {
      throw new ValidationException('Plugins directory is protected');
    }

    const pluginDirReal = await this.findPluginFolderRealById(
      settings,
      pluginId,
      pluginsReal,
      true,
    );
    const candidatePath = join(pluginDirReal, ...cleanRel.split('/'));
    let fileStat: Pick<Stats, 'isFile' | 'isSymbolicLink'>;
    let candidateReal: string;
    try {
      fileStat = await lstat(candidatePath);
      if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
        throw new ValidationException('Plugin asset must be a regular file');
      }
      candidateReal = await realpath(candidatePath);
    } catch (error) {
      if (error instanceof ValidationException) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        throw new NotFoundException('Plugin asset', cleanRel);
      }
      throw error;
    }
    if (!isSameOrInside(candidateReal, pluginDirReal, this.platform)) {
      throw new ValidationException(
        'Plugin asset resolves outside plugin directory',
      );
    }

    return { absolutePath: candidateReal, contentType };
  }

  async buildSandboxedHtmlDocument(
    settings: IPluginsSettings,
    pluginId: string,
  ): Promise<{ pluginId: string; entryFile: string; html: string }> {
    const catalog = await this.discover(settings);
    const plugin = catalog.discovered.find((item) => item.id === pluginId);
    if (!plugin) {
      throw new NotFoundException('Plugin', pluginId);
    }
    if (!plugin.enabled) {
      throw new ValidationException(`Plugin "${pluginId}" is disabled`);
    }
    if (plugin.entry.kind !== 'web-sandbox' || !plugin.entry.file) {
      throw new ValidationException(
        `Plugin "${pluginId}" does not define a web-sandbox HTML entry`,
      );
    }

    const pluginsDir = this.resolvePluginsDir(settings);
    let pluginsReal: string;
    try {
      pluginsReal = await realpath(pluginsDir);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        throw new NotFoundException('Plugin', pluginId);
      }
      throw error;
    }
    const pluginDirReal = await this.findPluginFolderRealById(
      settings,
      pluginId,
      pluginsReal,
      true,
    );
    const entryRel = sanitizeRelativeAssetRef(plugin.entry.file, 'entry.file');
    const entryPath = join(pluginDirReal, ...entryRel.split('/'));
    let entryStat: Pick<Stats, 'isFile' | 'isSymbolicLink' | 'size'>;
    let entryReal: string;
    try {
      entryStat = await lstat(entryPath);
      if (entryStat.isSymbolicLink() || !entryStat.isFile()) {
        throw new ValidationException(
          'Plugin HTML entry must be a regular file',
        );
      }
      if (entryStat.size > MAX_SANDBOX_HTML_BYTES) {
        throw new ValidationException(
          `Plugin HTML entry exceeds ${MAX_SANDBOX_HTML_BYTES} bytes`,
        );
      }
      entryReal = await realpath(entryPath);
    } catch (error) {
      if (error instanceof ValidationException) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        throw new NotFoundException('Plugin entry', entryRel);
      }
      throw error;
    }
    if (!isSameOrInside(entryReal, pluginDirReal, this.platform)) {
      throw new ValidationException('Plugin HTML entry escapes plugin folder');
    }

    let html = (await readFile(entryReal, 'utf8')).replace(/^\uFEFF/, '');
    let remainingBudget = MAX_SANDBOX_TOTAL_INLINED_BYTES;

    const readRelativeTextAsset = async (
      refPath: string,
    ): Promise<string | null> => {
      if (/^(https?:|data:|blob:|\/\/)/i.test(refPath.trim())) {
        return null;
      }
      try {
        const clean = sanitizeRelativeAssetRef(refPath, 'asset');
        const target = join(pluginDirReal, ...clean.split('/'));
        const st = await lstat(target);
        if (st.isSymbolicLink() || !st.isFile()) return null;
        if (st.size > remainingBudget) return null;
        const targetReal = await realpath(target);
        if (!isSameOrInside(targetReal, pluginDirReal, this.platform)) {
          return null;
        }
        const content = await readFile(targetReal, 'utf8');
        remainingBudget -= Buffer.byteLength(content, 'utf8');
        return content;
      } catch {
        return null;
      }
    };

    const linkRegex =
      /<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
    const linkMatches = [...html.matchAll(linkRegex)];
    for (const match of linkMatches) {
      const css = await readRelativeTextAsset(match[1]);
      if (css !== null) {
        const safeCss = css.replace(/<\/style/gi, '<\\/style');
        html = html.replace(match[0], () => `<style>\n${safeCss}\n</style>`);
      }
    }

    const scriptRegex =
      /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi;
    const scriptMatches = [...html.matchAll(scriptRegex)];
    for (const match of scriptMatches) {
      const js = await readRelativeTextAsset(match[1]);
      if (js !== null) {
        const safeJs = js.replace(/<\/script/gi, '<\\/script');
        html = html.replace(match[0], () => `<script>\n${safeJs}\n</script>`);
      }
    }

    const bootstrapHead = [
      `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">`,
      '<script>',
      'window.addEventListener("message", function (ev) {',
      '  if (!ev || !ev.data || ev.data.type !== "pkgsteward:applyUserProperties") return;',
      '  if (window.wallpaperPropertyListener && typeof window.wallpaperPropertyListener.applyUserProperties === "function") {',
      '    window.wallpaperPropertyListener.applyUserProperties(ev.data.properties || {});',
      '  }',
      '});',
      '<\\/script>'.replace('\\/', '/'),
    ].join('\n');

    // Inject CSP + property bridge at document start (right after leading <!doctype ...> if present) so comments/early scripts cannot precede SANDBOX_CSP
    const doctypeMatch = /^\s*(<!doctype\b[^>]*>)/i.exec(html);
    if (doctypeMatch) {
      const doctypeEnd = doctypeMatch.index + doctypeMatch[0].length;
      html = `${doctypeMatch[1]}\n${bootstrapHead}\n${html.slice(doctypeEnd)}`;
    } else {
      html = `<!doctype html>\n${bootstrapHead}\n${html}`;
    }

    return { pluginId, entryFile: entryRel, html };
  }

  private async findPluginFolderRealById(
    settings: IPluginsSettings,
    pluginId: string,
    pluginsReal: string,
    requireEnabled = false,
  ): Promise<string> {
    const catalog = await this.discover(settings);
    const match = catalog.discovered.find((item) => item.id === pluginId);
    if (!match) {
      throw new NotFoundException('Plugin', pluginId);
    }
    if (requireEnabled && !match.enabled) {
      throw new ValidationException(`Plugin "${pluginId}" is disabled`);
    }
    const directCandidate = join(pluginsReal, pluginId);
    try {
      const st = await lstat(directCandidate);
      if (!st.isSymbolicLink() && st.isDirectory()) {
        const folderReal = await realpath(directCandidate);
        if (isSameOrInside(folderReal, pluginsReal, this.platform)) {
          const located = await this.readPluginManifestFromDir(
            folderReal,
            pluginId,
          );
          if (located && located.manifest.id === pluginId) {
            return folderReal;
          }
        }
      }
    } catch {
      // Fallback: search real subdirectories by manifest id
    }
    const entries = await readdir(pluginsReal, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const folder = join(pluginsReal, entry.name);
      try {
        const st = await lstat(folder);
        if (st.isSymbolicLink() || !st.isDirectory()) continue;
        const folderReal = await realpath(folder);
        if (!isSameOrInside(folderReal, pluginsReal, this.platform)) continue;
        const located = await this.readPluginManifestFromDir(
          folderReal,
          entry.name,
        );
        if (located && located.manifest.id === pluginId) {
          return folderReal;
        }
      } catch {
        continue;
      }
    }
    throw new NotFoundException('Plugin folder', pluginId);
  }

  private async readPluginManifestFromDir(
    pluginDirReal: string,
    dirName: string,
  ): Promise<{
    format: PluginManifestFormat;
    manifestPath: string;
    manifest: IPluginManifest;
  } | null> {
    for (const format of PLUGIN_MANIFEST_FILENAMES) {
      const manifestPath = join(pluginDirReal, format);
      let manifestStat: Pick<
        Stats,
        'isDirectory' | 'isFile' | 'isSymbolicLink' | 'size'
      >;
      try {
        manifestStat = await this.fsAdapter.lstat(manifestPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          continue;
        }
        throw Object.assign(error as Error, { manifestPath });
      }

      if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
        throw Object.assign(
          new Error('Manifest must be a regular non-symlink file'),
          { manifestPath },
        );
      }
      if (manifestStat.size > MAX_PLUGIN_MANIFEST_BYTES) {
        throw Object.assign(
          new Error(`Manifest exceeds ${MAX_PLUGIN_MANIFEST_BYTES} bytes`),
          { manifestPath },
        );
      }

      const manifestReal = await this.fsAdapter.realpath(manifestPath);
      if (!isSameOrInside(manifestReal, pluginDirReal, this.platform)) {
        throw Object.assign(
          new Error('Manifest resolves outside plugin directory'),
          { manifestPath },
        );
      }

      const raw = await this.fsAdapter.readFile(manifestReal);
      if (Buffer.byteLength(raw, 'utf8') > MAX_PLUGIN_MANIFEST_BYTES) {
        throw Object.assign(
          new Error(`Manifest exceeds ${MAX_PLUGIN_MANIFEST_BYTES} bytes`),
          { manifestPath },
        );
      }

      try {
        const parsedJson = JSON.parse(raw.replace(/^\uFEFF/, '')) as unknown;
        const manifest = normalizeStandardPluginManifest(
          format,
          parsedJson,
          dirName,
        );
        return { format, manifestPath: manifestReal, manifest };
      } catch (error) {
        throw Object.assign(error as Error, { manifestPath });
      }
    }
    return null;
  }

  private async readInstallMarker(pluginDirReal: string): Promise<{
    preinstalled: boolean;
    origin: IPluginOrigin;
  }> {
    const markerPath = join(pluginDirReal, WALLPAPER_INSTALL_MARKER_FILE);
    try {
      const st = await this.fsAdapter.lstat(markerPath);
      if (st.isSymbolicLink() || !st.isFile() || st.size > 16 * 1024) {
        return {
          preinstalled: false,
          origin: { kind: 'local', sourceUrl: null, installedAt: null },
        };
      }
      const raw = await this.fsAdapter.readFile(markerPath);
      const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as {
        preinstalled?: boolean;
        sourceKind?: string;
        sourceUrl?: string;
        installedAt?: string;
      };
      const kind: IPluginOrigin['kind'] =
        parsed.preinstalled || parsed.sourceKind === 'preinstalled'
          ? 'preinstalled'
          : parsed.sourceKind === 'url'
            ? 'url'
            : parsed.sourceKind === 'file'
              ? 'file'
              : 'local';
      return {
        preinstalled: Boolean(parsed.preinstalled),
        origin: {
          kind,
          sourceUrl:
            typeof parsed.sourceUrl === 'string' ? parsed.sourceUrl : null,
          installedAt:
            typeof parsed.installedAt === 'string' ? parsed.installedAt : null,
        },
      };
    } catch {
      return {
        preinstalled: false,
        origin: { kind: 'local', sourceUrl: null, installedAt: null },
      };
    }
  }
}
