import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildProjectInventory,
  getProjectOutdatedTargets,
} from '@/projects/project-inventory';
import type {
  IManifestInput,
  IProjectInput,
  ProjectLockName,
  ProjectManager,
} from '@/projects/interfaces/projects.types';

jest.mock('execa', () => ({ execa: jest.fn() }));
const fixtureText = (name: string) =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8');
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
const input = (
  name: ProjectLockName | null = 'package-lock.json',
  text = fixtureText('npm-v3/package-lock.json'),
): IProjectInput => ({
  path: 'D:\\TEST\\project',
  requestPath: 'D:\\TEST\\project',
  scanId: '00000000-0000-4000-8000-000000000001',
  inputHash: 'a'.repeat(64),
  readAt: '2026-11-02T10:30:00.000Z',
  manifest: manifest(),
  manager: 'npm',
  lock: name === null ? null : { name, text },
  registryPolicy: null,
  warningCodes: [],
});
const build = (value: IProjectInput, signal = new AbortController().signal) =>
  buildProjectInventory(value, signal);
const lockText = (count: number) =>
  JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': { dependencies: { alpha: '^1.0.0' } },
      'node_modules/alpha': {
        version: '1.2.0',
        resolved: 'https://registry.npmjs.org/alpha/-/alpha-1.2.0.tgz',
      },
      ...Object.fromEntries(
        Array.from({ length: count }, (_, index) => [
          `node_modules/p${String(index).padStart(5, '0')}`,
          {
            version: '1.0.0',
            resolved: `https://registry.npmjs.org/p${String(index).padStart(5, '0')}/-/p-1.0.0.tgz`,
          },
        ]),
      ),
    },
  });

describe('buildProjectInventory', () => {
  beforeEach(() => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('TEST network forbidden'));
  });
  afterEach(() => {
    expect(globalThis.fetch).not.toHaveBeenCalled();
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });
  it.each([
    ['npm', 'package-lock.json', 'npm-v2/package-lock.json'],
    ['npm', 'package-lock.json', 'npm-v3/package-lock.json'],
    ['npm', 'npm-shrinkwrap.json', 'npm-v3/package-lock.json'],
    ['pnpm', 'pnpm-lock.yaml', 'pnpm-v9/pnpm-lock.yaml'],
    ['yarn', 'yarn.lock', 'yarn-v1/yarn.lock'],
  ] as const)(
    'dispatches %s %s using static data from %s',
    async (manager, name, fixture) => {
      const value = input(name, fixtureText(fixture));
      value.manager = manager;
      const result = await build(value);
      expect(result).toMatchObject({
        coverage: 'complete',
        warningCodes: [],
        failureCode: null,
      });
      expect(result.packages).toEqual([
        { name: '@scope/extra', version: '2.0.0', direct: false },
        { name: 'alpha', version: '1.1.0', direct: true },
        { name: 'alpha', version: '1.2.0', direct: true },
      ]);
      expect(result.direct).toEqual(new Map([['alpha', ['1.2.0']]]));
      const execa = jest.requireMock<{ execa: jest.Mock }>('execa');
      expect(execa.execa).not.toHaveBeenCalled();
    },
  );
  it('retains missing-lock outdated targets without claiming audit coverage', async () => {
    const value = input(null);
    const result = await build(value);
    expect(result).toMatchObject({
      coverage: 'unavailable',
      packages: [],
      failureCode: 'NO_LOCKFILE',
    });
    expect(result.direct.size).toBe(0);
    expect(getProjectOutdatedTargets(value.manifest)).toEqual([
      {
        name: 'alpha',
        registryName: 'alpha',
        spec: '^1.0.0',
        kind: 'range',
        warning: null,
      },
    ]);
  });
  it.each(['unknown', 'ambiguous'] as const)(
    'does not guess an audit source for %s manager',
    async (manager) => {
      const value = input(null);
      value.manager = manager;
      if (manager === 'ambiguous') value.warningCodes = ['LOCKFILE_MISMATCH'];
      const result = await build(value);
      expect(result.coverage).toBe('unavailable');
      expect(result.failureCode).toBe(
        manager === 'ambiguous' ? 'LOCKFILE_MISMATCH' : 'NO_LOCKFILE',
      );
    },
  );
  it('retains explicit pin/lock mismatch when no selected lock exists', async () => {
    const value = input(null);
    value.manager = 'pnpm';
    value.warningCodes = ['LOCKFILE_MISMATCH'];
    expect(await build(value)).toMatchObject({
      coverage: 'unavailable',
      failureCode: 'LOCKFILE_MISMATCH',
    });
  });
  it.each(['pnpm', 'yarn'] as ProjectManager[])(
    'never silently dispatches npm data for %s manager',
    async (manager) => {
      const value = input();
      value.manager = manager;
      expect(await build(value)).toMatchObject({
        coverage: 'unavailable',
        failureCode: 'LOCKFILE_MISMATCH',
      });
    },
  );
  it.each([
    ['npm', 'package-lock.json', 'unsupported/npm-v1.json'],
    ['yarn', 'yarn.lock', 'unsupported/yarn-berry.lock'],
  ] as const)(
    'keeps outdated targets when %s lock %s is unsupported',
    async (manager, name, fixture) => {
      const value = input(name, fixtureText(fixture));
      value.manager = manager;
      expect(await build(value)).toMatchObject({
        coverage: 'unavailable',
        failureCode: 'UNSUPPORTED_LOCKFILE',
      });
      expect(getProjectOutdatedTargets(value.manifest)).toHaveLength(1);
    },
  );
  it('propagates root manifest/lock mismatch without manufacturing locked versions', async () => {
    const value = input();
    value.manifest.dependencies[0].declarations[0].spec = '^9.0.0';
    const result = await build(value);
    expect(result).toMatchObject({
      coverage: 'unavailable',
      packages: [],
      failureCode: 'LOCKFILE_MISMATCH',
    });
    expect(result.direct.size).toBe(0);
  });
  it('leaves config-blocked inventory local and preserves registry-policy warning', async () => {
    const value = input();
    value.registryPolicy = 'REGISTRY_CONFIG_UNSUPPORTED';
    value.warningCodes = ['REGISTRY_CONFIG_UNSUPPORTED'];
    const result = await build(value);
    expect(result.packages).toHaveLength(3);
    expect(result.warningCodes).toContain('REGISTRY_CONFIG_UNSUPPORTED');
  });
  it('returns complete empty inventory only for a supported empty lock', async () => {
    const value = input(
      'package-lock.json',
      '{"lockfileVersion":3,"packages":{"":{}}}',
    );
    value.manifest.dependencies = [];
    expect(await build(value)).toMatchObject({
      coverage: 'complete',
      packages: [],
      warningCodes: [],
      failureCode: null,
    });
  });
  it('is deterministic and does not mutate its captured manifest/lock', async () => {
    const value = input();
    const before = JSON.stringify(value);
    const first = await build(value);
    const second = await build(value);
    expect(first).toEqual(second);
    expect(JSON.stringify(value)).toBe(before);
    first.packages.length = 0;
    first.direct.clear();
    expect((await build(value)).packages).toHaveLength(3);
  });
  it('accepts exactly 10,000 distinct name/version pairs', async () => {
    const result = await build(input('package-lock.json', lockText(9999)));
    expect(result.coverage).toBe('complete');
    expect(result.packages).toHaveLength(10_000);
  });
  it('caps 10,001 audit pairs deterministically and suppresses complete coverage', async () => {
    const result = await build(input('package-lock.json', lockText(10_000)));
    expect(result.coverage).toBe('partial');
    expect(result.packages).toHaveLength(10_000);
    expect(result.warningCodes).toContain('LIMIT_EXCEEDED');
    expect(result.packages[0]).toEqual({
      name: 'alpha',
      version: '1.2.0',
      direct: true,
    });
    expect(result.packages[result.packages.length - 1].name).toBe('p09998');
  });
  it('deduplicates identical pairs before applying the 10,000 cap', async () => {
    const packages = Object.fromEntries(
      Array.from({ length: 10_001 }, (_, index) => [
        `node_modules/p${index}/node_modules/alpha`,
        {
          version: '1.2.0',
          resolved: 'https://registry.npmjs.org/alpha/-/alpha-1.2.0.tgz',
        },
      ]),
    );
    const value = input(
      'package-lock.json',
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { dependencies: { alpha: '^1.0.0' } },
          'node_modules/alpha': {
            version: '1.2.0',
            resolved: 'https://registry.npmjs.org/alpha/-/alpha-1.2.0.tgz',
          },
          ...packages,
        },
      }),
    );
    const result = await build(value);
    expect(result.coverage).toBe('complete');
    expect(result.packages).toHaveLength(1);
  });
  it('honors cancellation before and during inventory construction', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(build(input(), controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    const next = new AbortController();
    const assertion = expect(
      build(input('package-lock.json', lockText(1024)), next.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    next.abort();
    await assertion;
  });
});

describe('getProjectOutdatedTargets', () => {
  it.each(['^1.0.0', '~1.2.0', '1.2.3', '>=1 <3', '*', '^2.0.0-beta.1'])(
    'keeps semver/range/prerelease spec %s for later metadata comparison',
    (spec) => {
      const value = manifest();
      value.dependencies[0].declarations[0].spec = spec;
      expect(getProjectOutdatedTargets(value)).toEqual([
        {
          name: 'alpha',
          registryName: 'alpha',
          spec,
          kind: 'range',
          warning: null,
        },
      ]);
    },
  );
  it.each(['latest', 'next', 'beta'])(
    'keeps registry tag %s distinct from semver ranges',
    (spec) => {
      const value = manifest();
      value.dependencies[0].declarations[0].spec = spec;
      expect(getProjectOutdatedTargets(value)).toEqual([
        {
          name: 'alpha',
          registryName: 'alpha',
          spec,
          kind: 'tag',
          warning: null,
        },
      ]);
    },
  );
  it.each([
    ['npm:actual@^3.0.0', 'actual', '^3.0.0', 'range'],
    ['npm:@scope/real@~2.0.0', '@scope/real', '~2.0.0', 'range'],
    ['npm:@scope/real@next', '@scope/real', 'next', 'tag'],
  ] as const)(
    'normalizes alias %s to actual identity without tool execution',
    (spec, registryName, normalized, kind) => {
      const value = manifest();
      value.dependencies[0].declarations[0].spec = spec;
      expect(getProjectOutdatedTargets(value)).toEqual([
        { name: 'alpha', registryName, spec: normalized, kind, warning: null },
      ]);
    },
  );
  it.each([
    'file:../TEST',
    'link:../TEST',
    'workspace:*',
    'git+https://TEST.invalid/repo',
    'https://TEST.invalid/private.tgz',
    'github:TEST/repo',
    'npm:../bad@^1',
    'npm:@scope/bad',
    '>=not-semver',
  ])(
    'retains unsupported declaration %s with no public-registry target',
    (spec) => {
      const value = manifest();
      value.dependencies[0].declarations[0].spec = spec;
      expect(getProjectOutdatedTargets(value)).toEqual([
        {
          name: 'alpha',
          registryName: null,
          spec,
          kind: 'unsupported',
          warning: 'UNSUPPORTED_SPEC',
        },
      ]);
    },
  );
  it('preserves distinct group specs, deduplicates identical queries and sorts targets', () => {
    const value = manifest();
    value.dependencies[0].declarations.push(
      { group: 'devDependencies', spec: '~1.2.0' },
      { group: 'optionalDependencies', spec: '^1.0.0' },
    );
    value.dependencies.unshift({
      name: 'zeta',
      declarations: [{ group: 'peerDependencies', spec: 'next' }],
    });
    const before = JSON.stringify(value);
    const targets = getProjectOutdatedTargets(value);
    expect(targets.map((target) => [target.name, target.spec])).toEqual([
      ['alpha', '^1.0.0'],
      ['alpha', '~1.2.0'],
      ['zeta', 'next'],
    ]);
    expect(JSON.stringify(value)).toBe(before);
  });
  it('retains all internal targets beyond the 2,000 display cap', () => {
    const value = manifest();
    value.dependencies = Array.from({ length: 2001 }, (_, index) => ({
      name: `p${String(index).padStart(4, '0')}`,
      declarations: [{ group: 'dependencies', spec: '^1.0.0' }],
    }));
    expect(getProjectOutdatedTargets(value)).toHaveLength(2001);
  });
  it('returns no fabricated target for empty declarations', () => {
    const value = manifest();
    value.dependencies = [];
    expect(getProjectOutdatedTargets(value)).toEqual([]);
  });
});
