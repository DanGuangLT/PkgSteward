import { validatePluginManifest } from '@/settings/plugins/plugin-manifest.validator';

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
});
