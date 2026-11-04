import 'reflect-metadata';
import { AppException } from '@/common/exceptions/app.exception';
import {
  assertGlobalConfigUnchanged,
  assessGlobalRegistryPolicy,
  captureGlobalEnvironment,
  GLOBAL_CONFIG_FILE_LIMIT,
  GLOBAL_CONFIG_TOTAL_LIMIT,
  parseGlobalNpmrc,
} from '@/global-packages/global-config';
import { GLOBAL_ENVIRONMENT_KEYS } from '@/global-packages/interfaces/global-packages.runtime';
import type {
  IGlobalConfigIdentity,
  IGlobalRegistryInput,
} from '@/global-packages/interfaces/global-packages.runtime';
import { buildRunnerEnvironment } from '@/npm-runner/runner-environment';
import type { IRunnerTool } from '@/npm-runner/interfaces/npm-runner.types';

const registryInput = (
  patch: Partial<IGlobalRegistryInput> = {},
): IGlobalRegistryInput => ({
  packageName: '@test/tool',
  action: 'change',
  configs: [],
  environment: {},
  provenanceKnown: true,
  ...patch,
});
const expectReason = (run: () => unknown, reason: string) => {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AppException);
  expect((caught as AppException).details).toMatchObject({ reason });
};

describe('global environment capture before runner stripping', () => {
  it('captures exactly the eight allowed location overrides, case-insensitively', () => {
    const snapshot: NodeJS.ProcessEnv = {
      npm_config_registry: 'https://registry.npmjs.org/',
      NPM_TOKEN: 'TEST-not-a-token',
      npm_config_force: 'true',
      PATH: 'D:\\TEST\\bin',
    };
    for (const key of GLOBAL_ENVIRONMENT_KEYS)
      snapshot[key.toUpperCase()] = `D:\\TEST\\${key}`;
    const before = { ...snapshot };
    const captured = captureGlobalEnvironment(Object.freeze(snapshot));
    expect(Object.keys(captured).sort()).toEqual(
      [...GLOBAL_ENVIRONMENT_KEYS].sort(),
    );
    for (const key of GLOBAL_ENVIRONMENT_KEYS)
      expect(captured[key]).toBe(`D:\\TEST\\${key}`);
    expect(snapshot).toEqual(before);
    expect(JSON.stringify(captured)).not.toContain('TEST-not-a-token');
  });
  it('allows duplicate casing only for identical values', () => {
    expect(
      captureGlobalEnvironment({
        npm_config_prefix: 'D:\\TEST',
        NPM_CONFIG_PREFIX: 'D:\\TEST',
      }),
    ).toEqual({ npm_config_prefix: 'D:\\TEST' });
    expectReason(
      () =>
        captureGlobalEnvironment({
          npm_config_prefix: 'D:\\TEST',
          NPM_CONFIG_PREFIX: 'D:\\OTHER',
        }),
      'CONFIG_UNSUPPORTED',
    );
  });
  it.each(GLOBAL_ENVIRONMENT_KEYS)(
    'detects casing conflicts for %s regardless of insertion order',
    (key) => {
      const upper = key.toUpperCase();
      const lower = key.toLowerCase();
      for (const snapshot of [
        { [lower]: 'D:\\TEST\\one', [upper]: 'D:\\TEST\\two' },
        { [upper]: 'D:\\TEST\\two', [lower]: 'D:\\TEST\\one' },
      ])
        expectReason(
          () => captureGlobalEnvironment(snapshot),
          'CONFIG_UNSUPPORTED',
        );
    },
  );
  it.each(GLOBAL_ENVIRONMENT_KEYS)(
    'rejects invalid %s rather than silently dropping it',
    (key) => {
      for (const value of [
        '',
        'relative',
        'D:relative',
        '\\rooted',
        '\\\\host\\share',
        '\\\\?\\D:\\TEST',
        'D:\\TEST\0',
        'D:\\TEST\r',
        'D:\\TEST\n',
        'D:\\TEST\t',
        '${HOME}/prefix',
      ]) {
        expectReason(
          () => captureGlobalEnvironment({ [key]: value }),
          'CONFIG_UNSUPPORTED',
        );
      }
    },
  );
  it('ignores undefined overrides without mutating input', () => {
    expect(
      captureGlobalEnvironment(Object.freeze({ npm_config_prefix: undefined })),
    ).toEqual({});
  });
  it('retains captured paths separately when M6 strips npm config', () => {
    const snapshot = Object.freeze({
      npm_config_prefix: 'D:\\TEST\\prefix',
      npm_config_cache: 'D:\\TEST\\cache',
    });
    const tool: IRunnerTool = {
      manager: 'npm',
      version: '11.0.0',
      file: 'D:\\TEST\\node.exe',
      entry: null,
      packageDir: 'D:\\TEST\\npm',
      identities: [],
    };
    const captured = captureGlobalEnvironment(snapshot);
    const stripped = buildRunnerEnvironment(
      snapshot,
      tool,
      'npm',
      'uninstall_one',
    );
    expect(stripped.npm_config_prefix).toBeUndefined();
    expect(captured.npm_config_prefix).toBe('D:\\TEST\\prefix');
    expect(captured.npm_config_cache).toBe('D:\\TEST\\cache');
  });
});

describe('bounded inert npmrc policy parser', () => {
  it('parses comments, CRLF, public registry and scoped key presence', () => {
    expect(
      parseGlobalNpmrc(
        '# TEST không phải yêu cầu nghiệp vụ\r\n; comment\r\nregistry = https://registry.npmjs.org\r\n@test:registry=https://private.invalid/\r\n',
      ),
    ).toEqual({
      defaultRegistry: 'public',
      scopedRegistries: ['@test'],
      publicAuthPresent: false,
      provenanceKnown: true,
    });
  });
  it('records public authentication presence without retaining any values', () => {
    const result = parseGlobalNpmrc(
      '//registry.npmjs.org/:_authToken=TEST-not-a-token\n//registry.npmjs.org/:username=TEST-user\n',
    );
    expect(result).toEqual({
      defaultRegistry: null,
      scopedRegistries: [],
      publicAuthPresent: true,
      provenanceKnown: true,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /TEST-not-a-token|TEST-user|_authToken/,
    );
  });
  it.each([
    'registry=${TEST_REGISTRY}',
    'prefix=${HOME}',
    'include=other.npmrc',
    'onload-script=TEST.js',
    'pnpmfile=TEST.cjs',
    'global-pnpmfile=TEST.cjs',
    'registry=$(TEST)',
    'registry=`TEST`',
    'registry=https://one.invalid\nREGISTRY=https://two.invalid',
    'not an assignment',
    'registry=https://registry.npmjs.org/\0',
  ])('marks unsupported syntax/provenance without execution: %s', (text) => {
    expect(parseGlobalNpmrc(text).provenanceKnown).toBe(false);
  });
  it('ignores interpolation inside public auth values; presence alone is inspected', () => {
    const result = parseGlobalNpmrc(
      '//registry.npmjs.org/:_authToken=${TEST_TOKEN}',
    );
    expect(result.provenanceKnown).toBe(true);
    expect(result.publicAuthPresent).toBe(true);
    expect(JSON.stringify(result)).not.toContain('TEST_TOKEN');
  });
  it('accepts inspected absolute location settings as inert data', () => {
    expect(
      parseGlobalNpmrc('prefix=D:\\TEST\\prefix\ncache=D:\\TEST\\cache\n')
        .provenanceKnown,
    ).toBe(true);
  });
  it('bounds by UTF-8 bytes, not JavaScript character count', () => {
    expect(() =>
      parseGlobalNpmrc('#' + 'a'.repeat(GLOBAL_CONFIG_FILE_LIMIT - 1)),
    ).not.toThrow();
    expectReason(
      () => parseGlobalNpmrc('#' + 'a'.repeat(GLOBAL_CONFIG_FILE_LIMIT)),
      'LIMIT_EXCEEDED',
    );
    expectReason(
      () => parseGlobalNpmrc('#' + 'é'.repeat(GLOBAL_CONFIG_FILE_LIMIT / 2)),
      'LIMIT_EXCEEDED',
    );
  });
});

describe('registry change policy (remove remains offline-capable)', () => {
  it.each(['https://registry.npmjs.org', 'https://registry.npmjs.org/'])(
    'allows public registry %s with public auth',
    (registry) => {
      expect(
        assessGlobalRegistryPolicy(
          registryInput({
            configs: [
              `registry=${registry}\n//registry.npmjs.org/:_authToken=TEST-not-a-token`,
            ],
          }),
        ),
      ).toEqual({ changeAllowed: true, reason: null, publicAuthPresent: true });
    },
  );
  it('defaults to public npm when every provenance source is known', () => {
    expect(assessGlobalRegistryPolicy(registryInput())).toEqual({
      changeAllowed: true,
      reason: null,
      publicAuthPresent: false,
    });
  });
  it.each([
    { configs: ['registry=https://mirror.invalid/'] },
    { configs: ['registry=http://registry.npmjs.org/'] },
    { configs: ['registry=https://registry.npmjs.org/private'] },
    { configs: ['registry=https://TEST-user:TEST-pass@registry.npmjs.org/'] },
    { configs: ['@test:registry=https://registry.npmjs.org/'] },
    { configs: ['registry=${TEST_REGISTRY}'] },
    { configs: ['include=TEST.npmrc'] },
    { provenanceKnown: false },
    { environment: { NPM_CONFIG_REGISTRY: 'https://private.invalid/' } },
    { environment: { npm_config_registry: '${TEST_REGISTRY}' } },
    {
      environment: {
        npm_config_registry: 'https://registry.npmjs.org/',
        NPM_CONFIG_REGISTRY: 'https://private.invalid/',
      },
    },
    { environment: { npm_config_user_agent: '${TEST_AGENT}' } },
  ] satisfies Partial<IGlobalRegistryInput>[])(
    'disables change on registry mismatch or unknown provenance: %p',
    (patch) => {
      const decision = assessGlobalRegistryPolicy(registryInput(patch));
      expect(decision.changeAllowed).toBe(false);
      expect(decision.reason).toBe('REGISTRY_CONFIG_UNSUPPORTED');
      expect(
        assessGlobalRegistryPolicy(
          registryInput({ ...patch, action: 'remove' }),
        ).reason,
      ).toBeNull();
    },
  );
  it('does not let a later public setting hide earlier unsupported config', () => {
    expect(
      assessGlobalRegistryPolicy(
        registryInput({
          configs: [
            'registry=https://private.invalid/',
            'registry=https://registry.npmjs.org/',
          ],
        }),
      ).changeAllowed,
    ).toBe(false);
  });
  it('never exposes secret-bearing custom registry values in its decision', () => {
    const configs = [
      'registry=https://TEST-user:TEST-not-a-token@private.invalid/',
    ];
    const decision = assessGlobalRegistryPolicy(registryInput({ configs }));
    expect(decision.changeAllowed).toBe(false);
    expect(JSON.stringify(decision)).not.toMatch(
      /TEST-user|TEST-not-a-token|private\.invalid/,
    );
  });
  it('allows unrelated scoped registries without a private package lookup', () => {
    expect(
      assessGlobalRegistryPolicy(
        registryInput({
          configs: ['@other:registry=https://private.invalid/'],
        }),
      ).changeAllowed,
    ).toBe(true);
    expect(
      assessGlobalRegistryPolicy(
        registryInput({
          packageName: 'tool',
          configs: ['@test:registry=https://private.invalid/'],
        }),
      ).changeAllowed,
    ).toBe(true);
  });
  it('inspects registry env before M6 stripping, without keeping credentials', () => {
    const environment = Object.freeze({
      NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/',
      NPM_TOKEN: 'TEST-not-a-token',
    });
    const decision = assessGlobalRegistryPolicy(registryInput({ environment }));
    expect(decision.changeAllowed).toBe(true);
    expect(JSON.stringify(decision)).not.toContain('TEST-not-a-token');
  });
  it('bounds the combined config payload even for remove', () => {
    const configs = Array<string>(
      GLOBAL_CONFIG_TOTAL_LIMIT / GLOBAL_CONFIG_FILE_LIMIT + 1,
    ).fill('#' + 'a'.repeat(GLOBAL_CONFIG_FILE_LIMIT - 1));
    expectReason(
      () => assessGlobalRegistryPolicy(registryInput({ configs })),
      'LIMIT_EXCEEDED',
    );
    expectReason(
      () =>
        assessGlobalRegistryPolicy(
          registryInput({ configs, action: 'remove' }),
        ),
      'LIMIT_EXCEEDED',
    );
  });
});

describe('configuration identity comparison', () => {
  // No real filesystem: identities are opaque, caller-owned adapter results.
  const files: IGlobalConfigIdentity[] = [
    {
      file: {
        path: 'D:\\TEST\\user.npmrc',
        stat: {
          size: 10,
          mtimeMs: 1,
          isFile: () => true,
          isDirectory: () => false,
          isSymbolicLink: () => false,
        } as IGlobalConfigIdentity['file']['stat'],
      },
      sha256: 'a'.repeat(64),
    },
  ];
  it('accepts identical facts without changing either list', () => {
    const before = JSON.stringify(files);
    expect(() => assertGlobalConfigUnchanged(files, [...files])).not.toThrow();
    expect(JSON.stringify(files)).toBe(before);
  });
  it('rejects content replacement, missing config and changed canonical path', () => {
    for (const actual of [
      [],
      [{ ...files[0], sha256: 'b'.repeat(64) }],
      [
        {
          ...files[0],
          file: { ...files[0].file, path: 'D:\\TEST\\replacement.npmrc' },
        },
      ],
      [
        {
          ...files[0],
          file: {
            ...files[0].file,
            stat: { ...files[0].file.stat, mtimeMs: 2 },
          },
        },
      ],
    ])
      expectReason(
        () => assertGlobalConfigUnchanged(files, actual),
        'PREVIEW_CHANGED',
      );
  });
  it('compares config identities without treating discovery order as a change', () => {
    const globalFile: IGlobalConfigIdentity = {
      ...files[0],
      file: { ...files[0].file, path: 'D:\\TEST\\global.npmrc' },
    };
    expect(() =>
      assertGlobalConfigUnchanged(
        [files[0], globalFile],
        [globalFile, files[0]],
      ),
    ).not.toThrow();
    expectReason(
      () => assertGlobalConfigUnchanged(files, [files[0], globalFile]),
      'PREVIEW_CHANGED',
    );
  });
});
