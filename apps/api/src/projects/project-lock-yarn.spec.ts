import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readYarnLock } from '@/projects/project-lock-yarn';
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
  packageManager: 'yarn@1.22.22',
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
const text = () => fixture('yarn-v1/yarn.lock');
const read = (
  value: string,
  input = manifest(),
  signal = new AbortController().signal,
) => readYarnLock(value, input, signal);

describe('readYarnLock', () => {
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
  it('deduplicates merged descriptors and includes entries unused by the manifest', async () => {
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
  it('accepts matching merged headings and does not invent a descriptor from semver satisfaction', async () => {
    const input = manifest();
    input.dependencies[0].declarations[0].spec = '~1.2.0';
    expect((await read(text(), input)).direct.get('alpha')).toEqual(['1.2.0']);
    input.dependencies[0].declarations[0].spec = '>=1.0.0';
    expect(await read(text(), input)).toMatchObject({
      coverage: 'unavailable',
      failureCode: 'LOCKFILE_MISMATCH',
    });
  });
  it.each(['dependencies', 'devDependencies', 'optionalDependencies'] as const)(
    'checks declarations in %s',
    async (group) => {
      const input = manifest();
      input.dependencies[0].declarations = [{ group, spec: '^9.0.0' }];
      expect(await read(text(), input)).toMatchObject({
        coverage: 'unavailable',
        failureCode: 'LOCKFILE_MISMATCH',
      });
    },
  );
  it('does not require a lock descriptor for an unlocked peer-only declaration', async () => {
    const input = manifest();
    input.dependencies[0].declarations = [
      { group: 'peerDependencies', spec: '>=16' },
    ];
    const result = await read('# yarn lockfile v1\n', input);
    expect(result).toMatchObject({
      coverage: 'complete',
      warningCodes: [],
      failureCode: null,
    });
    expect(result.direct.size).toBe(0);
  });
  it('keeps the dev version when a different peer descriptor is absent', async () => {
    const input = manifest();
    input.dependencies = [
      {
        name: 'react',
        declarations: [
          { group: 'peerDependencies', spec: '>=16' },
          { group: 'devDependencies', spec: '^18.2.0' },
        ],
      },
    ];
    const value =
      '# yarn lockfile v1\nreact@^18.2.0:\n  version "18.2.0"\n  resolved "https://registry.yarnpkg.com/react/-/react-18.2.0.tgz"\n';
    const result = await read(value, input);
    expect(result.coverage).toBe('complete');
    expect(result.direct.get('react')).toEqual(['18.2.0']);
  });
  it('still checks a peer descriptor when it is present', async () => {
    const input = manifest();
    input.dependencies[0].declarations = [
      { group: 'peerDependencies', spec: '^1.0.0' },
    ];
    expect(
      await read(text().replace('version "1.2.0"', 'version "9.0.0"'), input),
    ).toMatchObject({ failureCode: 'LOCKFILE_MISMATCH' });
  });
  it('does not mark an undeclared top-level descriptor direct', async () => {
    const input = manifest();
    input.dependencies = [];
    const result = await read(text(), input);
    expect(result.coverage).toBe('complete');
    expect(result.direct.size).toBe(0);
    expect(result.packages.every((entry) => !entry.direct)).toBe(true);
  });
  it.each(['workspace:*', 'link:../TEST'])(
    'skips local descriptors and direct spec %s without requiring a lock entry',
    async (spec) => {
      const input = manifest();
      input.dependencies.push({
        name: 'local',
        declarations: [{ group: 'dependencies', spec }],
      });
      const without = await read(text(), input);
      const withLocal = await read(
        `${text()}\n"local@${spec}":\n  version "1.0.0"\n  resolved "${spec}"\n`,
        input,
      );
      expect(without.coverage).toBe('complete');
      expect(withLocal.coverage).toBe('complete');
      expect(withLocal.warningCodes).toEqual([]);
      expect(withLocal.packages).toEqual(without.packages);
      expect(withLocal.direct.has('local')).toBe(false);
    },
  );
  it('keeps all duplicate declaration descriptors rather than overwriting groups', async () => {
    const input = manifest();
    input.dependencies[0].declarations.push({
      group: 'devDependencies',
      spec: '~1.1.0',
    });
    expect((await read(text(), input)).direct.get('alpha')).toEqual([
      '1.1.0',
      '1.2.0',
    ]);
  });
  it('uses scoped alias identity, never the alias name for audit', async () => {
    const input = manifest();
    input.dependencies = [
      {
        name: 'alias',
        declarations: [
          { group: 'dependencies', spec: 'npm:@scope/real@^3.0.0' },
        ],
      },
    ];
    const value =
      '# yarn lockfile v1\n"alias@npm:@scope/real@^3.0.0":\n  version "3.1.0"\n  resolved "https://registry.npmjs.org/@scope/real/-/real-3.1.0.tgz"\n';
    const result = await read(value, input);
    expect(result.direct.get('alias')).toEqual(['3.1.0']);
    expect(result.packages).toEqual([
      { name: '@scope/real', version: '3.1.0', direct: true },
    ]);
  });
  it.each([
    'file:../TEST',
    'git+https://TEST.invalid/repo',
    'https://TEST.invalid/private.tgz',
    'https://registry.yarnpkg.com.TEST.invalid/fake.tgz',
  ])(
    'skips nonregistry sources without losing known good entries: %s',
    async (source) => {
      const result = await read(
        `${text()}\nbad@^1.0.0:\n  version "1.0.0"\n  resolved "${source}"\n`,
      );
      expect(result.coverage).toBe('partial');
      expect(result.packages).toHaveLength(3);
      expect(result.warningCodes.length).toBeGreaterThan(0);
    },
  );
  it('marks missing source/invalid exact version partial', async () => {
    const result = await read(`${text()}\nbad@^1:\n  version "latest"\n`);
    expect(result.coverage).toBe('partial');
    expect(result.packages).toHaveLength(3);
  });
  it('does not accept a locked version inconsistent with its direct descriptor', async () => {
    expect(
      await read(text().replace('version "1.2.0"', 'version "9.0.0"')),
    ).toMatchObject({
      coverage: 'unavailable',
      failureCode: 'LOCKFILE_MISMATCH',
    });
  });
  it('rejects Berry metadata explicitly', async () => {
    expect(await read(fixture('unsupported/yarn-berry.lock'))).toMatchObject({
      coverage: 'unavailable',
      failureCode: 'UNSUPPORTED_LOCKFILE',
    });
  });
  it('rejects conflict parser state', async () => {
    expect(await read(fixture('hostile/yarn-conflict.lock'))).toMatchObject({
      coverage: 'unavailable',
      failureCode: 'INVALID_LOCKFILE',
    });
  });
  it('rejects conflict input before the parser can rebuild an unsafe trailer', async () => {
    expect(
      await read('<<<<<<< a\n"open\n=======\nx >>>>>>> z\n# "\n'),
    ).toMatchObject({
      coverage: 'unavailable',
      failureCode: 'INVALID_LOCKFILE',
    });
  });
  it('rejects an unterminated quote without a final newline', async () => {
    expect(await read('alpha@^1.0.0:\n  version "unterminated')).toMatchObject({
      coverage: 'unavailable',
      failureCode: 'INVALID_LOCKFILE',
    });
  });
  it('reads the same valid packages without a final newline', async () => {
    const withNewline = await read(text());
    const withoutNewline = await read(text().trimEnd());
    expect(withoutNewline.coverage).toBe('complete');
    expect(withoutNewline.packages).toEqual(withNewline.packages);
    expect(withoutNewline.direct).toEqual(withNewline.direct);
  });
  it('rejects malformed Classic input', async () => {
    expect(
      await read('alpha@^1.0.0:\n  version "unterminated\n'),
    ).toMatchObject({
      coverage: 'unavailable',
      failureCode: 'INVALID_LOCKFILE',
    });
  });
  it('rejects nested structures over depth 100', async () => {
    const value =
      text() +
      '\n' +
      Array.from(
        { length: 101 },
        (_, index) => `${'  '.repeat(index)}nested:`,
      ).join('\n');
    expect(await read(value)).toMatchObject({
      coverage: 'unavailable',
      failureCode: 'INVALID_LOCKFILE',
    });
  });
  it.each(['# yarn lockfile v1\n', '# yarn lockfile v1'])(
    'returns complete empty coverage for an empty v1 lock and manifest: %j',
    async (value) => {
      const input = manifest();
      input.dependencies = [];
      expect(await read(value, input)).toMatchObject({
        coverage: 'complete',
        packages: [],
        failureCode: null,
      });
    },
  );
  it('reports record-limit coverage instead of successful empty audit', async () => {
    const value =
      text() +
      '\n' +
      Array.from(
        { length: 50_001 },
        (_, index) =>
          `p${index}@1.0.0:\n  version "1.0.0"\n  resolved "https://registry.npmjs.org/p${index}/-/p${index}-1.0.0.tgz"\n`,
      ).join('\n');
    const result = await read(value);
    expect(result.coverage).not.toBe('complete');
    expect(result.warningCodes).toContain('LIMIT_EXCEEDED');
  });
  it('rejects text over 32 MiB', async () => {
    const result = await read(' '.repeat(32 * 1024 * 1024 + 1));
    expect(result.coverage).toBe('unavailable');
    expect(result.warningCodes).toContain('LIMIT_EXCEEDED');
  });
  it('honors pre-abort and yields record batches for cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      read(text(), manifest(), controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    const next = new AbortController();
    const value =
      text() +
      '\n' +
      Array.from(
        { length: 1024 },
        (_, index) =>
          `p${index}@1.0.0:\n  version "1.0.0"\n  resolved "https://registry.npmjs.org/p${index}/-/p${index}-1.0.0.tgz"\n`,
      ).join('\n');
    const assertion = expect(
      read(value, manifest(), next.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    next.abort();
    await assertion;
  });
});
