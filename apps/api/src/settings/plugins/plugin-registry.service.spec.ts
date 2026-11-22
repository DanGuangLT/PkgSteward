import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppPathsService } from '@/core/app-paths/app-paths.service';
import type { PathGuardService } from '@/core/path-guard/path-guard.service';
import {
  PLUGIN_MANIFEST_FILE_NAME,
  PluginRegistryService,
} from '@/settings/plugins/plugin-registry.service';
import { DEFAULT_PLUGINS_SETTINGS } from '@/settings/schema/settings.schema';

describe('PluginRegistryService', () => {
  let root: string;
  let pluginsDir: string;
  let isInsideProtectedTree: jest.Mock<Promise<boolean>, [string]>;
  let findDenyReason: jest.Mock<Promise<string | null>, [string]>;
  let service: PluginRegistryService;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pkgsteward-plugins-'));
    pluginsDir = join(root, 'plugins');
    isInsideProtectedTree = jest.fn<Promise<boolean>, [string]>(() =>
      Promise.resolve(false),
    );
    findDenyReason = jest.fn<Promise<string | null>, [string]>(() =>
      Promise.resolve(null),
    );
    service = new PluginRegistryService(
      { pluginsDir } as AppPathsService,
      {
        isInsideProtectedTree,
        findDenyReason,
      } as unknown as PathGuardService,
    );
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('returns an empty catalog gracefully when plugins directory does not exist', async () => {
    const catalog = await service.discover({
      ...DEFAULT_PLUGINS_SETTINGS,
      trustedRegistries: [],
      entries: {},
    });
    expect(catalog.runtimeMode).toBe('sandboxed-web');
    expect(catalog.apiVersion).toBe(1);
    expect(catalog.pluginsDir).toBe(pluginsDir);
    expect(catalog.discovered).toEqual([]);
    expect(catalog.invalid).toEqual([]);
  });

  it('discovers valid plugin manifests and isolates invalid ones without failing', async () => {
    mkdirSync(join(pluginsDir, 'good-plugin'), { recursive: true });
    writeFileSync(
      join(pluginsDir, 'good-plugin', PLUGIN_MANIFEST_FILE_NAME),
      JSON.stringify({
        id: 'good-plugin',
        name: 'Good Plugin',
        version: '1.2.0',
        apiVersion: 1,
        capabilities: ['dashboard-widget'],
        settingsSchema: [
          {
            key: 'refreshSec',
            label: 'Refresh (s)',
            type: 'number',
            defaultValue: 30,
          },
        ],
      }),
    );

    mkdirSync(join(pluginsDir, 'broken-plugin'), { recursive: true });
    writeFileSync(
      join(pluginsDir, 'broken-plugin', PLUGIN_MANIFEST_FILE_NAME),
      JSON.stringify({ id: 'BAD/ID', apiVersion: 99 }),
    );

    const catalog = await service.discover({
      enabled: true,
      directory: null,
      allowLocalPlugins: true,
      trustedRegistries: [],
      removedPreinstalled: [],
      entries: {
        'good-plugin': {
          enabled: true,
          config: { refreshSec: 60 },
        },
      },
    });

    expect(catalog.discovered).toHaveLength(1);
    expect(catalog.discovered[0]).toMatchObject({
      id: 'good-plugin',
      name: 'Good Plugin',
      version: '1.2.0',
      enabled: true,
      config: { refreshSec: 60 },
    });
    expect(catalog.invalid).toHaveLength(1);
    expect(catalog.invalid[0].directoryName).toBe('broken-plugin');
  });

  it('blocks custom plugins directory inside a protected tree and rejects symlink escapes', async () => {
    findDenyReason.mockResolvedValueOnce('system folder');
    const catalog = await service.discover({
      enabled: true,
      directory: 'C:\\Windows\\System32\\plugins',
      allowLocalPlugins: true,
      trustedRegistries: [],
      removedPreinstalled: [],
      entries: {},
    });
    expect(catalog.discovered).toEqual([]);
    expect(catalog.invalid[0].error).toMatch(/protected tree/);

    // Simulate symlink escape on a plugin subdir via fs adapter
    service.setFsAdapterForTest({
      readdir: () =>
        Promise.resolve([{ name: 'evil', isDirectory: () => true } as never]),
      lstat: () =>
        Promise.resolve({
          isDirectory: () => true,
          isFile: () => false,
          isSymbolicLink: () => false,
          size: 0,
        }),
      realpath: (p) =>
        Promise.resolve(
          p.endsWith('evil') ? join(tmpdir(), 'outside-target') : pluginsDir,
        ),
      readFile: () => Promise.resolve(''),
    });
    const escapeCatalog = await service.discover({
      ...DEFAULT_PLUGINS_SETTINGS,
      trustedRegistries: [],
      entries: {},
    });
    expect(escapeCatalog.discovered).toEqual([]);
    expect(escapeCatalog.invalid[0].error).toMatch(
      /outside configured plugins/,
    );
  });

  it('blocks custom plugins directory whose realpath resolves inside a protected tree', async () => {
    service.setFsAdapterForTest({
      readdir: () => Promise.resolve([]),
      lstat: () =>
        Promise.resolve({
          isDirectory: () => true,
          isFile: () => false,
          isSymbolicLink: () => false,
          size: 0,
        }),
      realpath: () => Promise.resolve('C:\\Windows\\System32\\plugins'),
      readFile: () => Promise.resolve(''),
    });
    findDenyReason
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('system folder');

    const catalog = await service.discover({
      enabled: true,
      directory: 'D:\\SafeAlias\\plugins',
      allowLocalPlugins: true,
      trustedRegistries: [],
      removedPreinstalled: [],
      entries: {},
    });

    expect(catalog.discovered).toEqual([]);
    expect(catalog.invalid[0].error).toMatch(/resolves inside a protected/);
  });

  it('rejects oversized manifest content after reading even if lstat size was smaller', async () => {
    const bigRaw = 'x'.repeat(65 * 1024);
    service.setFsAdapterForTest({
      readdir: () =>
        Promise.resolve([
          { name: 'oversized', isDirectory: () => true } as never,
        ]),
      lstat: () =>
        Promise.resolve({
          isDirectory: () => true,
          isFile: () => true,
          isSymbolicLink: () => false,
          size: 128,
        }),
      realpath: (p) => Promise.resolve(p),
      readFile: () => Promise.resolve(bigRaw),
    });

    const catalog = await service.discover({
      ...DEFAULT_PLUGINS_SETTINGS,
      trustedRegistries: [],
      entries: {},
    });

    expect(catalog.discovered).toEqual([]);
    expect(catalog.invalid[0].error).toMatch(/Manifest exceeds/);
  });

  it('builds sandboxed HTML document with strict CSP and blocks asset traversal', async () => {
    const pluginDir = join(pluginsDir, 'web-wp');
    mkdirSync(join(pluginDir, 'scripts'), { recursive: true });
    writeFileSync(
      join(pluginDir, 'manifest.json'),
      JSON.stringify({
        id: 'web-wp',
        name: 'Web Wallpaper',
        version: '1.0.0',
        capabilities: ['live-wallpaper'],
        entry: { kind: 'web-sandbox', file: 'index.html' },
      }),
    );
    writeFileSync(
      join(pluginDir, 'scripts', 'app.js'),
      'window.__testTag = "</script><script>alert(1)</script>"; window.__dollar = "$&$\'";',
    );
    writeFileSync(
      join(pluginDir, 'index.html'),
      '<!-- <head> --><script>evilEarly()</script><head></head><body><script src="scripts/app.js"></script></body>',
    );

    const enabledSettings = {
      ...DEFAULT_PLUGINS_SETTINGS,
      trustedRegistries: [],
      removedPreinstalled: [],
      entries: {
        'web-wp': { enabled: true, config: {} },
      },
    };

    const doc = await service.buildSandboxedHtmlDocument(
      enabledSettings,
      'web-wp',
    );
    const cspPos = doc.html.indexOf('http-equiv="Content-Security-Policy"');
    const evilScriptPos = doc.html.indexOf('<script>evilEarly()</script>');
    expect(cspPos).toBeGreaterThan(-1);
    expect(evilScriptPos).toBeGreaterThan(cspPos);
    expect(doc.html).toContain("connect-src 'none'");
    expect(doc.html).toContain('<\\/script>');
    expect(doc.html).toContain('window.__dollar = "$&$\'";');
    expect(doc.html).toContain('pkgsteward:applyUserProperties');
    expect(doc.html).not.toContain('pkgsteward-wallpaper-config');

    const safeAsset = await service.resolveSafeAssetPath(
      enabledSettings,
      'web-wp',
      'scripts/app.js',
    );
    expect(safeAsset.contentType).toContain('javascript');

    await expect(
      service.resolveSafeAssetPath(enabledSettings, 'web-wp', '../outside.txt'),
    ).rejects.toThrow();

    // Missing file maps cleanly to NotFoundException (404), disabled plugin is blocked
    await expect(
      service.resolveSafeAssetPath(
        enabledSettings,
        'web-wp',
        'scripts/missing.js',
      ),
    ).rejects.toThrow(/not found/i);

    const disabledSettings = {
      ...DEFAULT_PLUGINS_SETTINGS,
      trustedRegistries: [],
      removedPreinstalled: [],
      entries: {
        'web-wp': { enabled: false, config: {} },
      },
    };
    await expect(
      service.buildSandboxedHtmlDocument(disabledSettings, 'web-wp'),
    ).rejects.toThrow(/disabled/);
    await expect(
      service.resolveSafeAssetPath(
        disabledSettings,
        'web-wp',
        'scripts/app.js',
      ),
    ).rejects.toThrow(/disabled/);
  });
});
