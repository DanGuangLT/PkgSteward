import { execa } from 'execa';
import { analyzeProject } from '@/projects/project-analysis';
import type {
  IProjectAnalysisDeps,
  IProjectAnalysisUpdate,
  IRegistryPackageMetadata,
  RegistryAdvisories,
} from '@/projects/interfaces/projects.runtime';
import type {
  ILockInventory,
  IProjectInput,
} from '@/projects/interfaces/projects.types';

jest.mock('execa', () => ({ execa: jest.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

function input(spec = '^1.0.0', name = 'pkg'): IProjectInput {
  return {
    path: 'D:\\projects\\app',
    requestPath: 'D:\\projects\\app',
    scanId: 'scan-1',
    inputHash: 'hash-1',
    readAt: '2026-11-02T10:00:00.000Z',
    manifest: {
      name: 'app',
      version: '1.0.0',
      packageManager: 'npm@11.0.0',
      dependencies: [{ name, declarations: [{ group: 'dependencies', spec }] }],
      scripts: [],
    },
    manager: 'npm',
    lock: { name: 'package-lock.json', text: '{}' },
    registryPolicy: null,
    warningCodes: [],
  };
}

function inventory(): ILockInventory {
  return {
    coverage: 'complete',
    direct: new Map([['pkg', ['1.0.0']]]),
    packages: [{ name: 'pkg', version: '1.0.0', direct: true }],
    warningCodes: [],
    failureCode: null,
  };
}

function metadata(): IRegistryPackageMetadata {
  return {
    versions: ['1.0.0', '1.5.0', '2.0.0', '3.0.0-beta.1'],
    distTags: { latest: '2.0.0', next: '3.0.0-beta.1' },
  };
}

function advisory(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 7,
    title: 'Known issue',
    url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
    severity: 'high',
    vulnerable_versions: '<2.0.0',
    ...overrides,
  };
}

function fixture(lock = inventory()) {
  const getPackageMetadata = jest
    .fn<Promise<IRegistryPackageMetadata>, [string, AbortSignal]>()
    .mockResolvedValue(metadata());
  const getBulkAdvisories = jest
    .fn<Promise<RegistryAdvisories>, [Record<string, string[]>, AbortSignal]>()
    .mockResolvedValue({});
  const buildInventory = jest
    .fn<Promise<ILockInventory>, [IProjectInput, AbortSignal]>()
    .mockResolvedValue(lock);
  const snapshots: IProjectAnalysisUpdate[] = [];
  let time = Date.parse('2026-11-02T10:00:00Z');
  const onSnapshot = jest.fn((snapshot: IProjectAnalysisUpdate) => {
    snapshots.push(structuredClone(snapshot));
  });
  const deps: IProjectAnalysisDeps = {
    registry: { getPackageMetadata, getBulkAdvisories },
    buildInventory,
    now: () => new Date(time),
    onSnapshot,
  };
  return {
    deps,
    getPackageMetadata,
    getBulkAdvisories,
    buildInventory,
    snapshots,
    onSnapshot,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe('analyzeProject public-registry analysis', () => {
  let controller: AbortController;
  let network: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AbortController();
    network = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('unexpected real fetch'));
  });

  afterEach(() => {
    expect(execa).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it('compares wanted and latest independently against locked versions', async () => {
    const f = fixture();
    const result = await analyzeProject(input(), controller.signal, f.deps);
    expect(result.outdated).toMatchObject({
      state: 'complete',
      items: [
        {
          name: 'pkg',
          registryName: 'pkg',
          lockedVersions: ['1.0.0'],
          wanted: '1.5.0',
          latest: '2.0.0',
          behindWanted: true,
          behindLatest: true,
          warning: null,
        },
      ],
    });
    expect(result.audit.state).toBe('complete');
    expect(result.partial).toBe(false);
  });

  it.each([
    ['1.0.0', '1.0.0'],
    ['next', '3.0.0-beta.1'],
    ['^3.0.0-beta.1', '3.0.0-beta.1'],
    ['^1.0.0', '1.5.0'],
  ])(
    'resolves declared %s to wanted %s using normal semver/tag rules',
    async (spec, wanted) => {
      const f = fixture();
      const result = await analyzeProject(
        input(spec),
        controller.signal,
        f.deps,
      );
      expect(result.outdated.items[0].wanted).toBe(wanted);
    },
  );

  it('keeps missing locked state null while still returning wanted/latest', async () => {
    const lock = inventory();
    lock.direct.clear();
    const f = fixture(lock);
    const result = await analyzeProject(input(), controller.signal, f.deps);
    expect(result.outdated.items[0]).toMatchObject({
      lockedVersions: [],
      wanted: '1.5.0',
      latest: '2.0.0',
      behindWanted: null,
      behindLatest: null,
    });
  });

  it('uses alias actual registry identity without overwriting the displayed name', async () => {
    const lock = inventory();
    lock.direct = new Map([['alias', ['1.0.0']]]);
    const f = fixture(lock);
    const result = await analyzeProject(
      input('npm:pkg@^1.0.0', 'alias'),
      controller.signal,
      f.deps,
    );
    expect(f.getPackageMetadata).toHaveBeenCalledWith('pkg', controller.signal);
    expect(result.outdated.items[0]).toMatchObject({
      name: 'alias',
      registryName: 'pkg',
      wanted: '1.5.0',
    });
  });

  it('retains duplicate declarations without fetching the same package repeatedly', async () => {
    const source = input();
    source.manifest.dependencies[0].declarations.push({
      group: 'peerDependencies',
      spec: '^2.0.0',
    });
    const f = fixture();
    const result = await analyzeProject(source, controller.signal, f.deps);
    expect(f.getPackageMetadata).toHaveBeenCalledTimes(1);
    expect(result.outdated.items.map((row) => row.wanted).sort()).toEqual([
      '1.5.0',
      '2.0.0',
    ]);
    expect(source.manifest.dependencies[0].declarations).toHaveLength(2);
  });

  it('leaves nonregistry specs visible with a warning and no metadata fetch', async () => {
    const f = fixture();
    const result = await analyzeProject(
      input('file:../local'),
      controller.signal,
      f.deps,
    );
    expect(result.outdated.state).toBe('partial');
    expect(result.outdated.items[0]).toMatchObject({
      wanted: null,
      latest: null,
      warning: 'UNSUPPORTED_SPEC',
    });
    expect(f.getPackageMetadata).not.toHaveBeenCalled();
  });

  it.each<IRegistryPackageMetadata>([
    { versions: ['1.0.0'], distTags: {} },
    { versions: ['1.0.0'], distTags: { latest: 'nonsense' } },
    { versions: ['1.0.0'], distTags: { latest: '9.9.9' } },
  ])(
    'treats missing/invalid/unpublished latest as a warning',
    async (value) => {
      const f = fixture();
      f.getPackageMetadata.mockResolvedValue(value);
      const result = await analyzeProject(input(), controller.signal, f.deps);
      expect(result.outdated.state).toBe('partial');
      expect(result.outdated.items[0].warning).not.toBeNull();
      expect(result.outdated.items[0].latest).toBeNull();
    },
  );

  it('warns for a tag with no target rather than inventing wanted', async () => {
    const f = fixture();
    const result = await analyzeProject(
      input('missing-tag'),
      controller.signal,
      f.deps,
    );
    expect(result.outdated.items[0]).toMatchObject({ wanted: null });
    expect(result.outdated.items[0].warning).not.toBeNull();
    expect(result.partial).toBe(true);
  });

  it('keeps deprecated locked versions visible with an explicit row warning', async () => {
    const f = fixture();
    f.getPackageMetadata.mockResolvedValue({
      ...metadata(),
      deprecatedVersions: ['1.0.0'],
    });
    const result = await analyzeProject(input(), controller.signal, f.deps);
    expect(result.outdated.items[0]).toMatchObject({
      lockedVersions: ['1.0.0'],
      wanted: '1.5.0',
      latest: '2.0.0',
      warning: 'DEPRECATED_VERSION',
    });
    expect(result.outdated.state).toBe('partial');
    expect(result.partial).toBe(true);
  });

  it('warns when a locked version is no longer published instead of treating it as current', async () => {
    const f = fixture();
    f.getPackageMetadata.mockResolvedValue({
      versions: ['1.5.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
    });
    const result = await analyzeProject(input(), controller.signal, f.deps);
    expect(result.outdated.items[0].warning).not.toBeNull();
    expect(result.outdated.state).toBe('partial');
  });

  it('submits every flat lock entry, deduplicates exact versions, and preserves root direct flags', async () => {
    const lock = inventory();
    lock.packages.push(
      { name: 'pkg', version: '1.5.0', direct: true },
      { name: 'unused-workspace', version: '4.0.0', direct: false },
      { name: 'pkg', version: '1.0.0', direct: true },
    );
    const f = fixture(lock);
    f.getBulkAdvisories.mockResolvedValue({
      pkg: [advisory(), advisory()],
      'unused-workspace': [
        advisory({ id: 'workspace', vulnerable_versions: '*' }),
      ],
      unrequested: [advisory()],
    });
    const result = await analyzeProject(input(), controller.signal, f.deps);
    expect(f.getBulkAdvisories).toHaveBeenCalledWith(
      {
        pkg: ['1.0.0', '1.5.0'],
        'unused-workspace': ['4.0.0'],
      },
      controller.signal,
    );
    expect(result.audit.items).toHaveLength(2);
    expect(result.audit.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: '7',
          name: 'pkg',
          direct: true,
          affectedVersions: ['1.0.0', '1.5.0'],
        }),
        expect.objectContaining({
          id: 'workspace',
          name: 'unused-workspace',
          direct: false,
        }),
      ]),
    );
  });

  it('ignores an advisory whose range does not match any submitted version', async () => {
    const f = fixture();
    f.getBulkAdvisories.mockResolvedValue({
      pkg: [advisory({ vulnerable_versions: '>=9' })],
    });
    const result = await analyzeProject(input(), controller.signal, f.deps);
    expect(result.audit).toMatchObject({ state: 'complete', items: [] });
  });

  it('normalizes unknown severity and refuses invalid advisory ranges as partial', async () => {
    const f = fixture();
    f.getBulkAdvisories.mockResolvedValue({
      pkg: [
        advisory({ severity: 'future-level' }),
        advisory({ id: 8, vulnerable_versions: 'not-a-range' }),
        null,
      ],
    });
    const result = await analyzeProject(input(), controller.signal, f.deps);
    expect(result.audit.state).toBe('partial');
    expect(result.audit.items).toEqual([
      expect.objectContaining({ severity: 'unknown' }),
    ]);
    expect(result.partial).toBe(true);
  });

  it.each([
    ['https://github.com/advisories/GHSA-abcd-efgh-ijkl', true],
    ['https://www.npmjs.com/advisories/123', true],
    ['https://evil.test/advisories/123', false],
    ['https://github.com.evil.test/advisories/123', false],
    ['https://user:pass@github.com/advisories/123', false],
    ['http://github.com/advisories/123', false],
    ['javascript:alert(1)', false],
  ])('normalizes advisory URL %s (clickable=%s)', async (url, allowed) => {
    const f = fixture();
    f.getBulkAdvisories.mockResolvedValue({ pkg: [advisory({ url })] });
    const result = await analyzeProject(input(), controller.signal, f.deps);
    expect(result.audit.items[0].url).toBe(allowed ? url : null);
  });

  it('batches at 500 names and never retries a failed batch or discards prior findings', async () => {
    const lock = inventory();
    lock.packages = Array.from({ length: 501 }, (_, i) => ({
      name: `pkg-${String(i).padStart(4, '0')}`,
      version: '1.0.0',
      direct: false,
    }));
    const f = fixture(lock);
    f.getBulkAdvisories
      .mockResolvedValueOnce({ 'pkg-0000': [advisory()] })
      .mockRejectedValueOnce(
        Object.assign(new Error('safe'), {
          code: 'REGISTRY_UNAVAILABLE',
          stopScheduling: true,
        }),
      );
    const source = input();
    source.manifest.dependencies = [];
    const result = await analyzeProject(source, controller.signal, f.deps);
    expect(f.getBulkAdvisories).toHaveBeenCalledTimes(2);
    expect(
      f.getBulkAdvisories.mock.calls.map(([body]) => Object.keys(body).length),
    ).toEqual([500, 1]);
    expect(result.audit.state).toBe('partial');
    expect(result.audit.items).toHaveLength(1);
    expect(result.partial).toBe(true);
  });

  it('splits a single large name/version payload so each advisory request stays within 1 MiB', async () => {
    const lock = inventory();
    lock.packages = Array.from({ length: 10_000 }, (_, i) => ({
      name: 'pkg',
      version: `1.0.0-v${i}${'x'.repeat(180)}`,
      direct: false,
    }));
    const f = fixture(lock);
    const source = input();
    source.manifest.dependencies = [];
    const result = await analyzeProject(source, controller.signal, f.deps);
    expect(result.audit.state).toBe('complete');
    expect(f.getBulkAdvisories.mock.calls.length).toBeGreaterThan(1);
    for (const [body] of f.getBulkAdvisories.mock.calls) {
      expect(Object.keys(body).length).toBeLessThanOrEqual(500);
      expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(
        1024 * 1024,
      );
    }
    const submitted = f.getBulkAdvisories.mock.calls.flatMap(
      ([body]) => body.pkg ?? [],
    );
    expect(submitted.sort()).toEqual(
      lock.packages.map((row) => row.version).sort(),
    );
  });

  it('completes empty full-coverage audit without POST', async () => {
    const lock = inventory();
    lock.packages = [];
    lock.direct.clear();
    const f = fixture(lock);
    const source = input();
    source.manifest.dependencies = [];
    const result = await analyzeProject(source, controller.signal, f.deps);
    expect(result.audit).toMatchObject({
      state: 'complete',
      items: [],
      checkedCount: 0,
    });
    expect(result.partial).toBe(false);
    expect(f.getBulkAdvisories).not.toHaveBeenCalled();
    expect(f.getPackageMetadata).not.toHaveBeenCalled();
  });

  it.each([
    'NO_LOCKFILE',
    'UNSUPPORTED_LOCKFILE',
    'LOCKFILE_MISMATCH',
  ] as const)(
    'still computes outdated while audit is unavailable: %s',
    async (code) => {
      const lock = inventory();
      lock.coverage = 'unavailable';
      lock.failureCode = code;
      lock.warningCodes = [code];
      lock.packages = [];
      lock.direct.clear();
      const f = fixture(lock);
      const result = await analyzeProject(input(), controller.signal, f.deps);
      expect(result.outdated.items[0].latest).toBe('2.0.0');
      expect(result.audit).toMatchObject({
        state: 'unavailable',
        failureCode: code,
      });
      expect(result.partial).toBe(true);
      expect(f.getBulkAdvisories).not.toHaveBeenCalled();
    },
  );

  it('never turns partial lock coverage into a clean empty audit', async () => {
    const lock = inventory();
    lock.coverage = 'partial';
    lock.warningCodes = ['UNSUPPORTED_SPEC'];
    const f = fixture(lock);
    const result = await analyzeProject(input(), controller.signal, f.deps);
    expect(result.audit).toMatchObject({
      state: 'partial',
      items: [],
      warningCodes: ['UNSUPPORTED_SPEC'],
    });
    expect(result.partial).toBe(true);
  });

  it('blocks all registry calls for unsupported config without leaking input bytes', async () => {
    const source = input();
    source.registryPolicy = 'REGISTRY_CONFIG_UNSUPPORTED';
    const f = fixture();
    const result = await analyzeProject(source, controller.signal, f.deps);
    expect(result.outdated.state).toBe('unavailable');
    expect(result.audit.state).toBe('unavailable');
    expect(result.warningCodes).toContain('REGISTRY_CONFIG_UNSUPPORTED');
    expect(result.partial).toBe(true);
    expect(f.getPackageMetadata).not.toHaveBeenCalled();
    expect(f.getBulkAdvisories).not.toHaveBeenCalled();
  });

  it.each(['REGISTRY_UNAVAILABLE', 'REGISTRY_RATE_LIMITED'] as const)(
    'stops scheduling after registry-wide %s rather than trying all names',
    async (code) => {
      const source = input();
      source.manifest.dependencies = Array.from({ length: 20 }, (_, i) => ({
        name: `pkg-${i}`,
        declarations: [{ group: 'dependencies', spec: '^1' }],
      }));
      const f = fixture();
      f.getPackageMetadata.mockRejectedValue(
        Object.assign(new Error('safe'), { code, stopScheduling: true }),
      );
      const result = await analyzeProject(source, controller.signal, f.deps);
      expect(f.getPackageMetadata.mock.calls.length).toBeLessThanOrEqual(4);
      expect(f.getBulkAdvisories).not.toHaveBeenCalled();
      expect(result.partial).toBe(true);
      expect(result.audit.state).toBe('unavailable');
    },
  );

  it('a per-package 404 does not prevent other metadata or advisory requests', async () => {
    const source = input();
    source.manifest.dependencies.push({
      name: 'other',
      declarations: [{ group: 'dependencies', spec: '^1' }],
    });
    const f = fixture();
    f.getPackageMetadata.mockImplementation((name) =>
      name === 'pkg'
        ? Promise.reject(
            Object.assign(new Error('safe'), {
              code: 'PACKAGE_NOT_FOUND',
              stopScheduling: false,
            }),
          )
        : Promise.resolve(metadata()),
    );
    const result = await analyzeProject(source, controller.signal, f.deps);
    expect(f.getPackageMetadata).toHaveBeenCalledTimes(2);
    expect(f.getBulkAdvisories).toHaveBeenCalledTimes(1);
    expect(
      result.outdated.items.find((row) => row.name === 'pkg')?.warning,
    ).toBe('PACKAGE_NOT_FOUND');
    expect(
      result.outdated.items.find((row) => row.name === 'other')?.latest,
    ).toBe('2.0.0');
  });

  it('caps displayed advisories deterministically while preserving the total and partial flag', async () => {
    const f = fixture();
    f.getBulkAdvisories.mockResolvedValue({
      pkg: Array.from({ length: 2001 }, (_, i) =>
        advisory({
          id: String(i).padStart(5, '0'),
          severity: i === 2000 ? 'critical' : 'low',
        }),
      ),
    });
    const result = await analyzeProject(input(), controller.signal, f.deps);
    expect(result.audit.items).toHaveLength(2000);
    expect(result.audit.items[0].severity).toBe('critical');
    expect(result.audit.totalCount).toBe(2001);
    expect(result.audit.warningCodes).toContain('LIMIT_EXCEEDED');
    expect(result.partial).toBe(true);
  });

  it('caps direct displayed rows to the lexical first 2000 with an explicit limit warning', async () => {
    const source = input();
    source.manifest.dependencies = Array.from({ length: 2001 }, (_, i) => ({
      name: `pkg-${String(2000 - i).padStart(4, '0')}`,
      declarations: [{ group: 'dependencies', spec: '^1' }],
    }));
    const f = fixture();
    const result = await analyzeProject(source, controller.signal, f.deps);
    expect(result.outdated.items).toHaveLength(2000);
    expect(result.outdated.items[0].name).toBe('pkg-0000');
    expect(result.outdated.items[1999].name).toBe('pkg-1999');
    expect(result.outdated.totalCount).toBe(2001);
    expect(result.outdated.warningCodes).toContain('LIMIT_EXCEEDED');
    expect(result.partial).toBe(true);
  });

  it('publishes progressive defensive copies at most every 250ms plus terminal', async () => {
    const source = input();
    source.manifest.dependencies = Array.from({ length: 6 }, (_, i) => ({
      name: `pkg-${i}`,
      declarations: [{ group: 'dependencies', spec: '^1' }],
    }));
    const f = fixture();
    const times: number[] = [];
    f.onSnapshot.mockImplementation((snapshot) => {
      times.push(f.deps.now().getTime());
      f.snapshots.push(structuredClone(snapshot));
      snapshot.outdated.items.length = 0;
      snapshot.warningCodes.push('INTERNAL_SERVER_ERROR');
    });
    f.getPackageMetadata.mockImplementation(() => {
      f.advance(100);
      return Promise.resolve(metadata());
    });
    const result = await analyzeProject(source, controller.signal, f.deps);
    expect(f.snapshots.length).toBeGreaterThan(1);
    for (let i = 1; i < times.length - 1; i++)
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(250);
    expect(result.outdated.items).toHaveLength(6);
    expect(result.warningCodes).not.toContain('INTERNAL_SERVER_ERROR');
    expect(f.snapshots.at(-1)?.outdated.items).toHaveLength(6);
  });

  it('does not publish late results or start audit after cancellation', async () => {
    const pending = deferred<IRegistryPackageMetadata>();
    const f = fixture();
    f.getPackageMetadata.mockReturnValue(pending.promise);
    const task = analyzeProject(input(), controller.signal, f.deps).catch(
      (e: unknown) => e,
    );
    await flush();
    controller.abort();
    const published = f.onSnapshot.mock.calls.length;
    pending.resolve(metadata());
    const result: unknown = await task;
    expect(result).toMatchObject({ name: 'AbortError' });
    expect(f.onSnapshot).toHaveBeenCalledTimes(published);
    expect(f.getBulkAdvisories).not.toHaveBeenCalled();
  });

  it('rejects a pre-aborted job before inventory, network or publication', async () => {
    const f = fixture();
    controller.abort();
    await expect(
      analyzeProject(input(), controller.signal, f.deps),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.buildInventory).not.toHaveBeenCalled();
    expect(f.onSnapshot).not.toHaveBeenCalled();
    expect(f.getPackageMetadata).not.toHaveBeenCalled();
  });
});
