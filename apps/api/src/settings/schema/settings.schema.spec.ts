import 'reflect-metadata';
import {
  applyOverridesToDocument,
  createDefaultSettingsDocument,
  MAX_PLUGIN_CONFIG_STRING_LENGTH,
  MAX_TIMEOUT_MS,
  migrateLegacyFlatSettings,
  parseStructuredSettingsDocument,
  parseStructuredSettingsOverrides,
  projectStructuredSettingsToEnvMap,
  validateCorsOriginList,
} from '@/settings/schema/settings.schema';

describe('settings.schema', () => {
  it('creates a valid complete default document', () => {
    const doc = createDefaultSettingsDocument();
    expect(doc.schemaVersion).toBe(1);
    expect(doc.runtime).toEqual({
      scanRootPaths: '*',
      maxScanDepth: 0,
      scanTimeoutMs: null,
      npmCommandTimeoutMs: null,
    });
    expect(doc.appearance.themePreset).toBe('default');
    expect(doc.appearance.navigationLayout).toBe('topbar');
    expect(doc.appearance.showBreadcrumbs).toBe(false);
    expect(doc.behavior.paginationEnabled).toBe(true);
    expect(doc.behavior.showPageSizeSelector).toBe(true);
    expect(doc.behavior.scrollToTopOnPageChange).toBe(true);
    expect(doc.behavior.advancedMode).toBe(false);
    expect(doc.plugins.enabled).toBe(true);
    expect(doc.plugins.allowLocalPlugins).toBe(true);
    expect(doc.plugins.removedPreinstalled).toEqual([]);
  });

  it('parses partial structured overrides without injecting unrelated defaults', () => {
    const overrides = parseStructuredSettingsOverrides(
      {
        schemaVersion: 1,
        appearance: { themePreset: 'ocean', fontFamily: 'be-vietnam-pro' },
        runtime: { scanTimeoutMs: null },
      },
      { platform: 'win32' },
    );
    expect(overrides).toEqual({
      schemaVersion: 1,
      appearance: { themePreset: 'ocean', fontFamily: 'be-vietnam-pro' },
      runtime: { scanTimeoutMs: null },
    });
    expect(projectStructuredSettingsToEnvMap(overrides)).toEqual({
      SCAN_TIMEOUT_MS: '',
    });
  });

  it('projects runtime and server structured settings into flat env keys', () => {
    const overrides = parseStructuredSettingsOverrides(
      {
        schemaVersion: 1,
        runtime: {
          scanRootPaths: 'D:\\Work',
          maxScanDepth: 4,
          scanTimeoutMs: 5000,
          npmCommandTimeoutMs: null,
        },
        server: {
          mode: 'production',
          host: '::1',
          port: 24699,
          globalPrefix: 'api',
          version: '2',
          listOriginCors: 'http://localhost:24680, http://127.0.0.1:24680/',
          exportSwaggerApiJson: false,
        },
      },
      { platform: 'win32' },
    );
    expect(projectStructuredSettingsToEnvMap(overrides)).toEqual({
      SCAN_ROOT_PATHS: 'D:\\Work',
      MAX_SCAN_DEPTH: 4,
      SCAN_TIMEOUT_MS: 5000,
      NPM_COMMAND_TIMEOUT_MS: '',
      MODE: 'production',
      HOST: '::1',
      PORT: 24699,
      GLOBAL_PREFIX: 'api',
      VERSION: '2',
      LIST_ORIGIN_CORS: 'http://localhost:24680, http://127.0.0.1:24680',
      EXPORT_SWAGGER_API_JSON: false,
    });
  });

  it('rejects prototype pollution keys, PKGSTEWARD_DATA_DIR, and unknown fields', () => {
    const protoJson = JSON.parse(
      '{"schemaVersion":1,"__proto__":{"polluted":true}}',
    ) as unknown;
    expect(() => parseStructuredSettingsOverrides(protoJson)).toThrow(
      /forbidden key "__proto__"/,
    );

    const desktopProto = JSON.parse(
      '{"schemaVersion":1,"desktop":{"constructor":"bad"}}',
    ) as unknown;
    expect(() => parseStructuredSettingsOverrides(desktopProto)).toThrow(
      /forbidden key "constructor"/,
    );

    expect(() =>
      parseStructuredSettingsOverrides({
        schemaVersion: 1,
        PKGSTEWARD_DATA_DIR: 'D:\\data',
      }),
    ).toThrow(/PKGSTEWARD_DATA_DIR cannot be set/);

    expect(() =>
      parseStructuredSettingsOverrides({
        schemaVersion: 1,
        appearance: { fontScale: 999 },
      }),
    ).toThrow(/appearance\.fontScale/);

    expect(() =>
      parseStructuredSettingsOverrides({
        schemaVersion: 2,
      }),
    ).toThrow(/unsupported schemaVersion/);
  });

  it('rejects unsafe CORS origins, non-loopback hosts, and relative plugin paths', () => {
    expect(() => validateCorsOriginList('*')).toThrow(/invalid origin/);
    expect(() => validateCorsOriginList('http://localhost:24680/path')).toThrow(
      /without path/,
    );
    expect(() =>
      parseStructuredSettingsOverrides({
        schemaVersion: 1,
        server: { host: '0.0.0.0' },
      }),
    ).toThrow(/server\.host/);
    expect(() =>
      parseStructuredSettingsOverrides(
        {
          schemaVersion: 1,
          plugins: { directory: 'relative-plugins' },
        },
        { platform: 'win32' },
      ),
    ).toThrow(/plugins\.directory/);
    expect(() =>
      parseStructuredSettingsOverrides({
        schemaVersion: 1,
        plugins: {
          trustedRegistries: ['http://evil.example.com'],
        },
      }),
    ).toThrow(/trustedRegistries/);
  });

  it('validates plugin entries and enforces safe plugin IDs', () => {
    const parsed = parseStructuredSettingsDocument(
      {
        schemaVersion: 1,
        plugins: {
          enabled: true,
          allowLocalPlugins: true,
          directory: 'D:\\Plugins',
          trustedRegistries: ['https://registry.npmjs.org'],
          entries: {
            'my.plugin-1': {
              enabled: true,
              version: '1.0.0',
              source: 'local',
              config: { maxItems: 10, compact: true },
            },
          },
        },
      },
      { platform: 'win32' },
    );
    expect(parsed.plugins.entries['my.plugin-1']).toEqual({
      enabled: true,
      version: '1.0.0',
      source: 'local',
      config: { maxItems: 10, compact: true },
    });

    expect(() =>
      parseStructuredSettingsOverrides({
        schemaVersion: 1,
        plugins: {
          entries: {
            '../escape': { enabled: true, config: {} },
          },
        },
      }),
    ).toThrow(/invalid plugin id/);
  });

  it('migrates legacy flat settings.json records into structured overrides', () => {
    const migrated = migrateLegacyFlatSettings(
      {
        SCAN_ROOT_PATHS: 'D:\\Projects',
        MAX_SCAN_DEPTH: 3,
        SCAN_TIMEOUT_MS: '',
        PORT: 24688,
        EXPORT_SWAGGER_API_JSON: 'false',
      },
      { platform: 'win32' },
    );
    expect(migrated).toEqual({
      schemaVersion: 1,
      runtime: {
        scanRootPaths: 'D:\\Projects',
        maxScanDepth: 3,
        scanTimeoutMs: null,
      },
      server: {
        port: 24688,
        exportSwaggerApiJson: false,
      },
    });
    const full = applyOverridesToDocument(
      createDefaultSettingsDocument(),
      migrated,
    );
    expect(full.server.exportSwaggerApiJson).toBe(false);
    expect(full.runtime.scanRootPaths).toBe('D:\\Projects');
  });

  it('normalizes comma-only scanRootPaths to "*" and enforces timeout / traversal limits', () => {
    const parsed = parseStructuredSettingsOverrides(
      {
        schemaVersion: 1,
        runtime: { scanRootPaths: ' , , ' },
      },
      { platform: 'win32' },
    );
    expect(parsed.runtime?.scanRootPaths).toBe('*');

    expect(() =>
      parseStructuredSettingsOverrides({
        schemaVersion: 1,
        runtime: { scanTimeoutMs: MAX_TIMEOUT_MS + 1 },
      }),
    ).toThrow(/between 1000 and/);

    expect(() =>
      parseStructuredSettingsOverrides(
        {
          schemaVersion: 1,
          plugins: { directory: 'D:\\Plugins\\..\\Escape' },
        },
        { platform: 'win32' },
      ),
    ).toThrow(/path traversal/);

    const longUrl = `https://example.com/${'a'.repeat(1500)}.jpg`;
    const withLongConfig = parseStructuredSettingsOverrides({
      schemaVersion: 1,
      plugins: {
        entries: {
          'wallpaper-engine': {
            enabled: true,
            config: { mediaUrl: longUrl, mediaSource: 'url' },
          },
        },
      },
    });
    expect(
      withLongConfig.plugins?.entries?.['wallpaper-engine']?.config.mediaUrl,
    ).toBe(longUrl);

    expect(() =>
      parseStructuredSettingsOverrides({
        schemaVersion: 1,
        plugins: {
          entries: {
            'wallpaper-engine': {
              enabled: true,
              config: {
                mediaUrl: `https://example.com/${'a'.repeat(MAX_PLUGIN_CONFIG_STRING_LENGTH)}`,
              },
            },
          },
        },
      }),
    ).toThrow(/exceeds 2048 characters/);

    expect(() =>
      parseStructuredSettingsOverrides({
        schemaVersion: 1,
        plugins: { trustedRegistries: ['not a url'] },
      }),
    ).toThrow(/trustedRegistries.*contains invalid URL/);

    expect(() =>
      parseStructuredSettingsOverrides({
        schemaVersion: 1,
        behavior: { paginationEnabled: 'yes' },
      }),
    ).toThrow(/behavior\.paginationEnabled/);
  });
});
