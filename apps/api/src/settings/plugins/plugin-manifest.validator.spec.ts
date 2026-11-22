import {
  normalizeStandardPluginManifest,
  sanitizeRelativeAssetRef,
  validatePluginManifest,
} from '@/settings/plugins/plugin-manifest.validator';

describe('validatePluginManifest', () => {
  const valid = {
    id: 'sample.theme-kit',
    name: 'Sample Theme Kit',
    version: '1.0.0',
    apiVersion: 1,
    description: 'Adds custom read-only metadata',
    author: 'PkgSteward Team',
    homepage: 'https://github.com/LienThuan04/PkgSteward',
    capabilities: ['theme-preset', 'dashboard-widget'],
    minAppVersion: '1.0.0',
    settingsSchema: [
      {
        key: 'accentLabel',
        label: 'Accent label',
        type: 'string',
        defaultValue: 'Default',
      },
      {
        key: 'compactMode',
        label: 'Compact mode',
        type: 'boolean',
        defaultValue: false,
      },
    ],
  };

  it('validates a well-formed manifest', () => {
    expect(validatePluginManifest(valid)).toEqual(valid);
  });

  it('rejects unsupported apiVersion, prototype keys, javascript URLs, and unknown keys', () => {
    expect(() => validatePluginManifest({ ...valid, apiVersion: 2 })).toThrow(
      /apiVersion/,
    );

    expect(() =>
      validatePluginManifest({ ...valid, entry: './malicious.js' }),
    ).toThrow(/Unknown key "entry"/);

    const protoManifest = JSON.parse(
      JSON.stringify({ ...valid, __proto__: { admin: true } }),
    ) as Record<string, unknown>;
    // Assign own __proto__ explicitly to simulate JSON.parse payload with __proto__
    const crafted = JSON.parse(
      `{"id":"a","name":"A","version":"1.0.0","apiVersion":1,"capabilities":["theme-preset"],"__proto__":{"bad":1}}`,
    ) as unknown;
    expect(protoManifest).toBeDefined();
    expect(() => validatePluginManifest(crafted)).toThrow(
      /Forbidden key "__proto__"/,
    );

    expect(() =>
      validatePluginManifest({ ...valid, homepage: 'javascript:alert(1)' }),
    ).toThrow(/https:\/\/ or http:\/\//);

    expect(() => validatePluginManifest({ ...valid, id: '../evil' })).toThrow(
      /Manifest "id"/,
    );
  });

  it('normalizes standard manifest.json, package.json, and Wallpaper Engine project.json safely', () => {
    const webExt = normalizeStandardPluginManifest('manifest.json', {
      name: 'Neon Matrix',
      version: '2.1.0',
      main: 'index.html',
    });
    expect(webExt).toMatchObject({
      id: 'neon-matrix',
      name: 'Neon Matrix',
      version: '2.1.0',
      format: 'manifest.json',
      entry: { kind: 'web-sandbox', file: 'index.html' },
      capabilities: ['live-wallpaper'],
    });

    const npmPkg = normalizeStandardPluginManifest('package.json', {
      name: '@community/pkgsteward-shader-bg',
      version: '1.0.4',
      main: 'dist/wall.html',
      author: { name: 'Community Dev' },
    });
    expect(npmPkg).toMatchObject({
      id: 'community.pkgsteward-shader-bg',
      name: '@community/pkgsteward-shader-bg',
      author: 'Community Dev',
      format: 'package.json',
      entry: { kind: 'web-sandbox', file: 'dist/wall.html' },
    });

    const weProject = normalizeStandardPluginManifest(
      'project.json',
      {
        title: 'Cyber City Rain',
        type: 'web',
        file: './scene.html',
        general: {
          properties: {
            rainSpeed: { type: 'slider', text: 'Rain Speed', value: 1.5 },
            showClock: { type: 'bool', text: 'Show Clock', value: true },
          },
        },
      },
      'cyber-city',
    );
    expect(weProject).toMatchObject({
      id: 'cyber-city',
      name: 'Cyber City Rain',
      format: 'project.json',
      entry: { kind: 'web-sandbox', file: 'scene.html' },
      capabilities: ['live-wallpaper'],
    });
    expect(weProject.settingsSchema).toHaveLength(2);

    expect(() => sanitizeRelativeAssetRef('../secret.js')).toThrow(/traversal/);
    expect(() => sanitizeRelativeAssetRef('https://evil.example/x.js')).toThrow(
      /URL scheme/,
    );
    expect(() =>
      normalizeStandardPluginManifest('project.json', {
        title: 'Evil',
        type: 'web',
        file: '../../Windows/win.ini',
      }),
    ).toThrow(/traversal/);
  });
});
