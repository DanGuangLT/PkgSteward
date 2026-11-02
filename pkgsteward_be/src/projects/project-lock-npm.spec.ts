import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as npmAdapter from './project-lock-npm';
import type { IManifestInput } from './interfaces/projects.types';

jest.mock('node:fs/promises', () => ({
  readFile: jest.fn(),
  lstat: jest.fn(),
  realpath: jest.fn(),
}));
jest.mock('execa', () => ({ execa: jest.fn() }));

const manifest = (): IManifestInput => ({
  name: 'TEST-root',
  version: '1.0.0',
  packageManager: null,
  scripts: [],
  dependencies: [
    {
      name: 'alpha',
      declarations: [{ group: 'dependencies', spec: '^1.0.0' }],
    },
  ],
});
const fixture = (name: string) =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8');
const read = (
  text: string,
  input = manifest(),
  signal = new AbortController().signal,
) => npmAdapter.readNpmLock(text, input, signal);
const lock = (
  packages: Record<string, unknown>,
  root: unknown = { dependencies: { alpha: '^1.0.0' } },
) =>
  JSON.stringify({ lockfileVersion: 3, packages: { '': root, ...packages } });
const alpha = {
  version: '1.2.0',
  resolved: 'https://registry.npmjs.org/alpha/-/alpha-1.2.0.tgz',
};

describe('readNpmLock', () => {
  beforeEach(() => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('TEST network forbidden'));
  });
  afterEach(() => {
    expect(globalThis.fetch).not.toHaveBeenCalled();
    const fs =
      jest.requireMock<Record<'readFile' | 'lstat' | 'realpath', jest.Mock>>(
        'node:fs/promises',
      );
    for (const method of Object.values(fs))
      expect(method).not.toHaveBeenCalled();
    const execa = jest.requireMock<{ execa: jest.Mock }>('execa');
    expect(execa.execa).not.toHaveBeenCalled();
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });
  it.each([2, 3])(
    'reads npm v%s as a flat lock-root inventory with root-spec direct flags',
    async (version) => {
      const result = await read(fixture(`npm-v${version}/package-lock.json`));
      expect(result).toMatchObject({
        coverage: 'complete',
        failureCode: null,
        warningCodes: [],
      });
      expect(result.direct).toEqual(new Map([['alpha', ['1.2.0']]]));
      expect(result.packages).toEqual([
        { name: '@scope/extra', version: '2.0.0', direct: false },
        { name: 'alpha', version: '1.1.0', direct: true },
        { name: 'alpha', version: '1.2.0', direct: true },
      ]);
      expect(
        result.packages.some((entry) => entry.name === 'TEST-lock-root'),
      ).toBe(false);
      expect(
        result.packages.some((entry) => entry.name === 'ignored-legacy-tree'),
      ).toBe(false);
    },
  );

  it.each([
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ] as const)(
    'compares %s specs exactly instead of accepting a merely satisfying version',
    async (group) => {
      const input = manifest();
      input.dependencies[0].declarations = [{ group, spec: '^1.0.0' }];
      const result = await read(
        lock({ 'node_modules/alpha': alpha }, { [group]: { alpha: '~1.2.0' } }),
        input,
      );
      expect(result).toMatchObject({
        coverage: 'unavailable',
        failureCode: 'LOCKFILE_MISMATCH',
        packages: [],
      });
    },
  );

  it('rejects removed/extra root declarations and missing root metadata', async () => {
    for (const root of [
      {},
      { dependencies: { alpha: '^1.0.0', extra: '*' } },
      null,
    ]) {
      expect(
        await read(lock({ 'node_modules/alpha': alpha }, root)),
      ).toMatchObject({
        coverage: 'unavailable',
        failureCode: 'LOCKFILE_MISMATCH',
      });
    }
  });

  it('does not resolve a missing top-level direct from a nested installation', async () => {
    const result = await read(
      lock({ 'node_modules/outer/node_modules/alpha': alpha }),
    );
    expect(result.direct.get('alpha') ?? []).toEqual([]);
    expect(result.coverage).toBe('partial');
  });
  it('rejects a top-level locked version inconsistent with its root range', async () => {
    expect(
      await read(
        lock({
          'node_modules/alpha': {
            version: '9.0.0',
            resolved: 'https://registry.npmjs.org/alpha/-/alpha-9.0.0.tgz',
          },
        }),
      ),
    ).toMatchObject({
      coverage: 'unavailable',
      failureCode: 'LOCKFILE_MISMATCH',
    });
  });

  it('uses actual package identity for a root npm alias', async () => {
    const input = manifest();
    input.dependencies = [
      {
        name: 'alias',
        declarations: [
          { group: 'dependencies', spec: 'npm:@scope/real@^3.0.0' },
        ],
      },
    ];
    const result = await read(
      lock(
        {
          'node_modules/alias': {
            name: '@scope/real',
            version: '3.1.0',
            resolved: 'https://registry.npmjs.org/@scope/real/-/real-3.1.0.tgz',
          },
        },
        { dependencies: { alias: 'npm:@scope/real@^3.0.0' } },
      ),
      input,
    );
    expect(result.direct).toEqual(new Map([['alias', ['3.1.0']]]));
    expect(result.packages).toEqual([
      { name: '@scope/real', version: '3.1.0', direct: true },
    ]);
  });

  it.each([
    { version: '1.0.0', resolved: 'file:../outside' },
    { version: '1.0.0', resolved: 'git+https://TEST.invalid/repo' },
    { version: '1.0.0', resolved: 'https://TEST.invalid/private.tgz' },
    {
      version: '1.0.0',
      resolved: 'https://registry.npmjs.org.TEST.invalid/fake.tgz',
    },
    {
      version: '1.0.0',
      resolved: 'https://user:TEST@registry.npmjs.org/fake.tgz',
    },
    { version: '1.0.0' },
    { version: 'latest', resolved: 'https://registry.npmjs.org/bad/-/bad.tgz' },
    {
      name: '../escape',
      version: '1.0.0',
      resolved: 'https://registry.npmjs.org/bad/-/bad.tgz',
    },
  ])(
    'skips unsafe/unknown source or identity without discarding good packages: %j',
    async (entry) => {
      const result = await read(
        lock({ 'node_modules/alpha': alpha, 'node_modules/bad': entry }),
      );
      expect(result.coverage).toBe('partial');
      expect(result.warningCodes.length).toBeGreaterThan(0);
      expect(result.packages).toEqual([
        { name: 'alpha', version: '1.2.0', direct: true },
      ]);
    },
  );

  it('ignores local non-node_modules keys without reading them or losing coverage', async () => {
    const result = await read(
      lock({ 'node_modules/alpha': alpha, '../../TEST-secret': alpha }),
    );
    expect(result.coverage).toBe('complete');
    expect(result.packages).toEqual([
      { name: 'alpha', version: '1.2.0', direct: true },
    ]);
  });

  it('returns complete empty coverage for an empty v3 lock', async () => {
    const input = manifest();
    input.dependencies = [];
    expect(await read(lock({}, {}), input)).toMatchObject({
      coverage: 'complete',
      packages: [],
      failureCode: null,
    });
  });
  it('exports only the npm reader after common helper extraction', () => {
    expect(Object.keys(npmAdapter)).toEqual(['readNpmLock']);
  });
  it('skips workspace metadata and link records without a coverage warning', async () => {
    const result = await read(
      lock({
        'node_modules/alpha': alpha,
        'packages/local': { name: 'local', version: '1.0.0' },
        'node_modules/local': { link: true, resolved: 'packages/local' },
      }),
    );
    expect(result.coverage).toBe('complete');
    expect(result.warningCodes).toEqual([]);
    expect(result.packages).toEqual([
      { name: 'alpha', version: '1.2.0', direct: true },
    ]);
  });
  it.each(['workspace:*', 'link:../TEST'])(
    'skips a local direct declaration %s without a coverage warning',
    async (spec) => {
      const input = manifest();
      input.dependencies.push({
        name: 'local',
        declarations: [{ group: 'dependencies', spec }],
      });
      const result = await read(
        lock(
          { 'node_modules/alpha': alpha },
          {
            dependencies: { alpha: '^1.0.0', local: spec },
          },
        ),
        input,
      );
      expect(result.coverage).toBe('complete');
      expect(result.warningCodes).toEqual([]);
      expect(result.direct.has('local')).toBe(false);
    },
  );
  it('skips a direct link record even when its manifest spec is a registry range', async () => {
    const result = await read(
      lock({
        'node_modules/alpha': { link: true, resolved: 'packages/alpha' },
      }),
    );
    expect(result).toMatchObject({
      coverage: 'complete',
      packages: [],
      warningCodes: [],
    });
    expect(result.direct.size).toBe(0);
  });
  it('keeps file declarations partial even if npm represents the target as a link', async () => {
    const input = manifest();
    input.dependencies[0].declarations[0].spec = 'file:../TEST';
    const result = await read(
      lock(
        { 'node_modules/alpha': { link: true, resolved: '../TEST' } },
        {
          dependencies: { alpha: 'file:../TEST' },
        },
      ),
      input,
    );
    expect(result.coverage).toBe('partial');
  });
  it('audits bundled entries by location identity without requiring resolved', async () => {
    const result = await read(
      lock({
        'node_modules/alpha': { version: '1.2.0', inBundle: true },
        'node_modules/alpha/node_modules/@scope/bundled': {
          version: '2.0.0',
          inBundle: true,
        },
      }),
    );
    expect(result.coverage).toBe('complete');
    expect(result.warningCodes).toEqual([]);
    expect(result.packages).toEqual([
      { name: '@scope/bundled', version: '2.0.0', direct: false },
      { name: 'alpha', version: '1.2.0', direct: true },
    ]);
    expect(result.direct.get('alpha')).toEqual(['1.2.0']);
  });

  it('marks v1 unsupported', async () => {
    expect(await read(fixture('unsupported/npm-v1.json'))).toMatchObject({
      coverage: 'unavailable',
      failureCode: 'UNSUPPORTED_LOCKFILE',
    });
  });
  it.each([
    '{',
    'null',
    '[]',
    '{"lockfileVersion":3}',
    '{"lockfileVersion":3,"packages":[]}',
  ])('normalizes malformed/schema-invalid JSON: %s', async (text) => {
    expect(await read(text)).toMatchObject({
      coverage: 'unavailable',
      failureCode: 'INVALID_LOCKFILE',
    });
  });
  it('never calls a truncated >50,000-record lock complete', async () => {
    const packages = Object.fromEntries(
      Array.from({ length: 50_001 }, (_, index) => [
        `node_modules/p${index}`,
        {
          version: '1.0.0',
          resolved: `https://registry.npmjs.org/p${index}/-/p${index}-1.0.0.tgz`,
        },
      ]),
    );
    const result = await read(lock(packages));
    expect(result.coverage).not.toBe('complete');
    expect(result.warningCodes).toContain('LIMIT_EXCEEDED');
  });
  it('rejects input exceeding the 32 MiB text bound', async () => {
    const result = await read(' '.repeat(32 * 1024 * 1024 + 1));
    expect(result.coverage).toBe('unavailable');
    expect(result.warningCodes).toContain('LIMIT_EXCEEDED');
  });
  it('rejects JSON nesting over depth 100', async () => {
    const value = lock({ 'node_modules/alpha': alpha });
    const hostile =
      value.slice(0, -1) +
      ',"TEST":' +
      '['.repeat(101) +
      '0' +
      ']'.repeat(101) +
      '}';
    expect(await read(hostile)).toMatchObject({
      coverage: 'unavailable',
      failureCode: 'INVALID_LOCKFILE',
    });
  });
  it('honors a pre-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      read(fixture('npm-v3/package-lock.json'), manifest(), controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('yields during batches so cancellation prevents a completed inventory', async () => {
    const packages = Object.fromEntries(
      Array.from({ length: 1024 }, (_, index) => [
        `node_modules/p${index}`,
        {
          version: '1.0.0',
          resolved: `https://registry.npmjs.org/p${index}/-/p${index}-1.0.0.tgz`,
        },
      ]),
    );
    const controller = new AbortController();
    const pending = read(lock(packages), manifest(), controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    });
    controller.abort();
    await assertion;
  });
});
