import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readPnpmLock } from '@/projects/project-lock-pnpm';
import type { IManifestInput } from '@/projects/interfaces/projects.types';

jest.mock('node:fs/promises', () => ({
  readFile: jest.fn(),
  lstat: jest.fn(),
  realpath: jest.fn(),
}));
jest.mock('execa', () => ({ execa: jest.fn() }));

const manifest = (): IManifestInput => ({
  name: 'TEST-root',
  version: null,
  packageManager: 'pnpm@11.0.0',
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
) => readPnpmLock(text, input, signal);
const text = () => fixture('pnpm-v9/pnpm-lock.yaml');

describe('readPnpmLock', () => {
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
  it('includes every package key, including unused importers, and ignores snapshots', async () => {
    const result = await read(text());
    expect(result).toMatchObject({
      coverage: 'complete',
      warningCodes: [],
      failureCode: null,
    });
    expect(result.direct).toEqual(new Map([['alpha', ['1.2.0']]]));
    expect(result.packages).toEqual([
      { name: '@scope/extra', version: '2.0.0', direct: false },
      { name: 'alpha', version: '1.1.0', direct: true },
      { name: 'alpha', version: '1.2.0', direct: true },
    ]);
  });
  it('does not traverse even invalid snapshot dependency relations', async () => {
    const base = text().split('snapshots:')[0];
    expect(
      (
        await read(
          `${base}snapshots:\n  ignored: {dependencies: {bad: 'file:../../TEST'}}\n`,
        )
      ).packages,
    ).toEqual((await read(base)).packages);
  });
  it.each(['dependencies', 'devDependencies', 'optionalDependencies'] as const)(
    'compares root %s specifiers, not another importer',
    async (group) => {
      const input = manifest();
      input.dependencies[0].declarations[0].group = group;
      const value = `lockfileVersion: '9.0'\nimporters:\n  .:\n    ${group}:\n      alpha: {specifier: '~1.2.0', version: 1.2.0}\npackages: {}\n`;
      expect(await read(value, input)).toMatchObject({
        coverage: 'unavailable',
        failureCode: 'LOCKFILE_MISMATCH',
      });
    },
  );
  it('marks a missing root importer or removed direct spec mismatched', async () => {
    for (const value of [
      text().replace('  .:', '  another:'),
      text().replace('specifier: ^1.0.0', 'specifier: ^9.0.0'),
    ]) {
      expect(await read(value)).toMatchObject({
        coverage: 'unavailable',
        failureCode: 'LOCKFILE_MISMATCH',
      });
    }
  });
  it.each([true, false])(
    'accepts a peer-only lock with autoInstallPeers=%s',
    async (autoInstallPeers) => {
      const input = manifest();
      input.dependencies = [
        {
          name: 'is-odd',
          declarations: [{ group: 'peerDependencies', spec: '^3.0.0' }],
        },
      ];
      const importer = autoInstallPeers
        ? 'dependencies:\n      is-odd: {specifier: ^3.0.0, version: 3.0.1}'
        : '{}';
      const packages = autoInstallPeers
        ? '\n  is-odd@3.0.1: {resolution: {integrity: sha512-TEST}}\n'
        : ' {}\n';
      const result = await read(
        `lockfileVersion: '9.0'\nsettings: {autoInstallPeers: ${autoInstallPeers}}\nimporters:\n  .:\n    ${importer}\npackages:${packages}`,
        input,
      );
      expect(result).toMatchObject({
        coverage: 'complete',
        warningCodes: [],
        failureCode: null,
      });
      expect(result.direct.get('is-odd') ?? []).toEqual(
        autoInstallPeers ? ['3.0.1'] : [],
      );
    },
  );
  it('accepts a peer plus dev declaration recorded only as dev', async () => {
    const input = manifest();
    input.dependencies = [
      {
        name: 'is-odd',
        declarations: [
          { group: 'peerDependencies', spec: '>=2' },
          { group: 'devDependencies', spec: '3.0.1' },
        ],
      },
    ];
    const result = await read(
      "lockfileVersion: '9.0'\nimporters:\n  .:\n    devDependencies:\n      is-odd: {specifier: 3.0.1, version: 3.0.1}\npackages:\n  is-odd@3.0.1: {resolution: {integrity: sha512-TEST}}\n",
      input,
    );
    expect(result.coverage).toBe('complete');
    expect(result.direct.get('is-odd')).toEqual(['3.0.1']);
  });
  it.each([
    ['extra', '^3.0.0'],
    ['is-odd', '^2.0.0'],
  ])('rejects an extra dependency %s with specifier %s', async (name, spec) => {
    const input = manifest();
    input.dependencies = [
      {
        name: 'is-odd',
        declarations: [{ group: 'peerDependencies', spec: '^3.0.0' }],
      },
    ];
    expect(
      await read(
        `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      ${name}: {specifier: ${spec}, version: 3.0.1}\npackages: {}\n`,
        input,
      ),
    ).toMatchObject({
      coverage: 'unavailable',
      failureCode: 'LOCKFILE_MISMATCH',
    });
  });
  it('rejects a direct version reference inconsistent with its root specifier', async () => {
    expect(
      await read(text().replace('version: 1.2.0', 'version: 9.0.0')),
    ).toMatchObject({
      coverage: 'unavailable',
      failureCode: 'LOCKFILE_MISMATCH',
    });
  });
  it('returns complete empty inventory for an empty root importer and packages', async () => {
    const input = manifest();
    input.dependencies = [];
    expect(
      await read(
        "lockfileVersion: '9.0'\nimporters: {.: {}}\npackages: {}\n",
        input,
      ),
    ).toMatchObject({
      coverage: 'complete',
      packages: [],
      failureCode: null,
    });
  });
  it('uses a scoped package version reference without peer-context traversal', async () => {
    const input = manifest();
    input.dependencies = [
      {
        name: '@scope/pkg',
        declarations: [{ group: 'dependencies', spec: '^2.0.0' }],
      },
    ];
    const value = `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      '@scope/pkg': {specifier: '^2.0.0', version: '2.1.0(peer@1.0.0)'}\npackages:\n  '@scope/pkg@2.1.0':\n    resolution: {integrity: sha512-TEST}\n`;
    const result = await read(value, input);
    expect(result.direct).toEqual(new Map([['@scope/pkg', ['2.1.0']]]));
    expect(result.packages).toEqual([
      { name: '@scope/pkg', version: '2.1.0', direct: true },
    ]);
  });
  it('handles npm aliases by actual name or explicitly marks incomplete coverage', async () => {
    const input = manifest();
    input.dependencies = [
      {
        name: 'alias',
        declarations: [
          { group: 'dependencies', spec: 'npm:@scope/pkg@^2.0.0' },
        ],
      },
    ];
    const value = `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      alias: {specifier: 'npm:@scope/pkg@^2.0.0', version: '@scope/pkg@2.1.0'}\npackages:\n  '@scope/pkg@2.1.0':\n    resolution: {integrity: sha512-TEST}\n`;
    const result = await read(value, input);
    expect(result.packages).toEqual([
      { name: '@scope/pkg', version: '2.1.0', direct: true },
    ]);
    expect(result.packages.some((entry) => entry.name === 'alias')).toBe(false);
    expect(result.direct.get('alias')).toEqual(['2.1.0']);
  });
  it.each(['file:../TEST', 'git+https://TEST.invalid/repo', 'unknown-ref'])(
    'keeps unsupported direct resolution unknown and partial: %s',
    async (reference) => {
      const result = await read(
        text().replace('version: 1.2.0', `version: '${reference}'`),
      );
      expect(result.coverage).toBe('partial');
      expect(result.direct.get('alpha') ?? []).toEqual([]);
      expect(
        result.packages.some((entry) => entry.name === '@scope/extra'),
      ).toBe(true);
    },
  );
  it.each([
    "  'file:../TEST': {resolution: {directory: ../TEST}}\n",
    "  'bad@latest': {resolution: {integrity: sha512-TEST}}\n",
    "  'bad@1.0.0': {resolution: {tarball: 'https://TEST.invalid/private.tgz'}}\n",
    "  'bad@1.0.0': {resolution: {tarball: 'git+https://TEST.invalid/repo'}}\n",
  ])(
    'skips nonregistry/invalid entries and makes coverage partial: %s',
    async (entry) => {
      const value = text().split('snapshots:')[0] + entry;
      const result = await read(value);
      expect(result.coverage).toBe('partial');
      expect(result.packages).toHaveLength(3);
      expect(result.warningCodes.length).toBeGreaterThan(0);
    },
  );
  it.each(['link:../TEST', 'workspace:*'])(
    'skips local package entries and direct references %s without losing coverage',
    async (reference) => {
      const value =
        text()
          .replace('version: 1.2.0', `version: '${reference}'`)
          .split('snapshots:')[0] +
        `  '${reference}': {resolution: {directory: ../TEST}}\n`;
      const result = await read(value);
      expect(result.coverage).toBe('complete');
      expect(result.warningCodes).toEqual([]);
      expect(result.direct.get('alpha') ?? []).toEqual([]);
      expect(result.packages).toHaveLength(3);
    },
  );
  it.each(['workspace:*', 'link:../TEST'])(
    'skips direct local declaration %s without a coverage warning',
    async (spec) => {
      const input = manifest();
      input.dependencies[0].declarations[0].spec = spec;
      const result = await read(
        text().replace('specifier: ^1.0.0', `specifier: '${spec}'`),
        input,
      );
      expect(result.coverage).toBe('complete');
      expect(result.warningCodes).toEqual([]);
      expect(result.direct.size).toBe(0);
    },
  );
  it.each([
    'local@workspace:*',
    'local@link:../TEST',
    '@scope/local@link:../TEST',
  ])(
    'ignores local package-key reference %s without a coverage gap',
    async (key) => {
      const result = await read(
        text().split('snapshots:')[0] +
          `  '${key}': {resolution: {directory: ../TEST}}\n`,
      );
      expect(result.coverage).toBe('complete');
      expect(result.warningCodes).toEqual([]);
    },
  );
  it('keeps file specs partial when the importer reference happens to be a link', async () => {
    const input = manifest();
    input.dependencies[0].declarations[0].spec = 'file:../TEST';
    const result = await read(
      text()
        .replace('specifier: ^1.0.0', "specifier: 'file:../TEST'")
        .replace('version: 1.2.0', "version: 'link:../TEST'"),
      input,
    );
    expect(result.coverage).toBe('partial');
  });
  it.each(['8.0', '10.0', 'TEST'])(
    'reports unsupported lockfileVersion %s',
    async (version) => {
      expect(await read(text().replace("'9.0'", `'${version}'`))).toMatchObject(
        { coverage: 'unavailable', failureCode: 'UNSUPPORTED_LOCKFILE' },
      );
    },
  );
  it.each(['hostile/pnpm-alias.yaml', 'hostile/pnpm-tag.yaml'])(
    'rejects YAML aliases and custom tags: %s',
    async (name) => {
      expect(await read(fixture(name))).toMatchObject({
        coverage: 'unavailable',
        failureCode: 'INVALID_LOCKFILE',
      });
    },
  );
  it.each([
    "lockfileVersion: '9.0'\nlockfileVersion: '9.0'\n",
    "lockfileVersion: '9.0'\nimporters: []\npackages: []\n",
    "lockfileVersion: '9.0'\nimporters: {.: {}}\npackages: {__proto__: {polluted: true}}\n",
    "lockfileVersion: '9.0'\nimporters: {.: {}}\npackages: {constructor: {prototype: {polluted: true}}}\n",
    "lockfileVersion: '9.0'\nimporters: {.: {}}\npackages: {<<: {alpha: 1}}\n",
  ])('rejects unsafe/schema-invalid YAML: %s', async (value) => {
    expect(await read(value)).toMatchObject({
      coverage: 'unavailable',
      failureCode: 'INVALID_LOCKFILE',
    });
  });
  it('rejects nested YAML beyond depth 100 before record iteration', async () => {
    const value = `${text()}hostile: ${'['.repeat(101)}0${']'.repeat(101)}\n`;
    expect(await read(value)).toMatchObject({
      coverage: 'unavailable',
      failureCode: 'INVALID_LOCKFILE',
    });
  });
  it('never labels a >50,000-record inventory complete', async () => {
    const value =
      text().split('packages:')[0] +
      'packages:\n' +
      Array.from(
        { length: 50_001 },
        (_, index) =>
          `  p${index}@1.0.0: {resolution: {integrity: sha512-TEST}}`,
      ).join('\n');
    const result = await read(value);
    expect(result.coverage).not.toBe('complete');
    expect(result.warningCodes).toContain('LIMIT_EXCEEDED');
  });
  it('rejects oversized lock text explicitly', async () => {
    const result = await read(' '.repeat(32 * 1024 * 1024 + 1));
    expect(result.coverage).toBe('unavailable');
    expect(result.warningCodes).toContain('LIMIT_EXCEEDED');
  });
  it('honors pre-abort and abort during yielded record batches', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      read(text(), manifest(), controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    const next = new AbortController();
    const value =
      text().split('packages:')[0] +
      'packages:\n' +
      Array.from(
        { length: 1024 },
        (_, index) =>
          `  p${index}@1.0.0: {resolution: {integrity: sha512-TEST}}`,
      ).join('\n');
    const assertion = expect(
      read(value, manifest(), next.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    next.abort();
    await assertion;
  });
});
