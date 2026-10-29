import {
  pathApi,
  toComparable,
  type PathPlatform,
} from '@/common/utils/path.util';
import type { PathCheckResult } from '@/core/path-guard/interfaces/path-guard.types';
import type { RiskCode } from '@/core/risk/interfaces/risk.types';
import type { ICleanupCandidate } from '@/file-ops/cleanup-discovery';
import {
  assessTargets,
  type IAssessDeps,
} from '@/file-ops/file-ops-assessment';
import * as risk from '@/file-ops/file-ops-risk';
import type {
  GitTrackedResult,
  IFileOpsFs,
  IFileOpsStat,
  IGitProbe,
} from '@/file-ops/interfaces/file-ops.types';
import type { IProcessSnapshot } from '@/platform/interfaces/process-snapshot.interface';
import type {
  IScanFs,
  IStoredScanResult,
} from '@/scanner/interfaces/scanner.types';

// TEST fixtures only; not business requirements.
const NOW = new Date('2026-10-29T05:00:00.000Z');
const OLD = '2026-09-01T00:00:00.000Z';
const activity: risk.IOwnerActivity = {
  hasLockfile: true,
  lastActivityAt: OLD,
  incomplete: false,
};
const stat = (file = false): IFileOpsStat => ({
  dev: 7n,
  ino: 9007199254740993n,
  size: 0n,
  isFile: () => file,
  isDirectory: () => !file,
  isSymbolicLink: () => false,
});

function fixture(platform: PathPlatform = 'win32') {
  const api = pathApi(platform);
  const root = platform === 'win32' ? 'D:\\TEST-app' : '/TEST-app';
  const nodes = new Map<string, IFileOpsStat>();
  const put = (path: string, file = false) =>
    nodes.set(toComparable(path, platform), stat(file));
  const scan: Pick<IStoredScanResult, 'projects' | 'orphanNodeModules'> = {
    projects: [
      {
        path: root,
        name: 'TEST-app',
        packageManager: 'pnpm',
        hasLockfile: false,
        lastActivityAt: '2020-01-01T00:00:00.000Z',
        nodeModules: {
          exists: true,
          path: api.join(root, 'node_modules'),
          sizeBytes: null,
        },
      },
    ],
    orphanNodeModules: [],
  };
  put(root);
  put(api.join(root, 'package.json'), true);
  const fileLstat = jest.fn((path: string) => {
    const value = nodes.get(toComparable(path, platform));
    return value
      ? Promise.resolve(value)
      : Promise.reject(
          Object.assign(new Error('TEST missing'), { code: 'ENOENT' }),
        );
  });
  const fileRead = jest
    .fn<
      ReturnType<IFileOpsFs['readFile']>,
      Parameters<IFileOpsFs['readFile']>
    >()
    .mockResolvedValue(
      JSON.stringify({ devDependencies: { next: '1', turbo: '1' } }),
    );
  const files: jest.Mocked<IFileOpsFs> = {
    lstat: fileLstat,
    readdir: jest.fn().mockResolvedValue([]),
    readFile: fileRead,
  };
  const scanFs: jest.Mocked<IScanFs> = {
    readdir: jest.fn().mockRejectedValue(new Error('Unexpected scan I/O')),
    lstat: jest.fn().mockRejectedValue(new Error('Unexpected scan I/O')),
    realpath: jest.fn().mockRejectedValue(new Error('Unexpected scan I/O')),
    readFile: jest.fn().mockRejectedValue(new Error('Unexpected scan I/O')),
  };
  const gitStatus = jest
    .fn<ReturnType<IGitProbe['status']>, Parameters<IGitProbe['status']>>()
    .mockResolvedValue({ state: 'clean' });
  const trackedNames = jest
    .fn<
      ReturnType<IGitProbe['trackedNames']>,
      Parameters<IGitProbe['trackedNames']>
    >()
    .mockResolvedValue({ state: 'ok', tracked: [] });
  const git: jest.Mocked<IGitProbe> = { status: gitStatus, trackedNames };
  const capture = jest
    .fn<
      ReturnType<IProcessSnapshot['capture']>,
      Parameters<IProcessSnapshot['capture']>
    >()
    .mockResolvedValue({ status: 'ok', processes: [] });
  const processes: jest.Mocked<IProcessSnapshot> = {
    capture,
  };
  const checkMany = jest.fn(
    (paths: readonly string[]): Promise<PathCheckResult[]> =>
      Promise.resolve(
        paths.map((path) => ({
          allowed: true,
          path: {
            inputPath: path,
            resolvedPath: path,
            realPath: path,
            isSymbolicLink: false,
          },
        })),
      ),
  );
  const controller = new AbortController();
  const deps: IAssessDeps = {
    platform,
    fs: { files, scan: scanFs },
    checkMany,
    git,
    processes,
    selfPid: 123,
    now: NOW,
    signal: controller.signal,
  };
  const ownerActivity = jest
    .spyOn(risk, 'readOwnerActivity')
    .mockResolvedValue({ ...activity });
  const orphanActivity = jest
    .spyOn(risk, 'readOrphanActivity')
    .mockResolvedValue({ ...activity, hasLockfile: null });
  const states = jest.spyOn(risk, 'processStates');
  const facts = jest.spyOn(risk, 'assessTargetRisk');
  const add = (name: string) => {
    const path = api.join(root, name);
    put(path);
    return path;
  };
  const run = (
    paths: readonly string[],
    cleanupFacts?: ReadonlyMap<
      string,
      Pick<ICleanupCandidate, 'trackedCheck' | 'frameworkVerified'>
    >,
  ) => assessTargets(paths, scan, deps, cleanupFacts);
  return {
    root,
    api,
    scan,
    files,
    scanFs,
    git,
    processes,
    checkMany,
    controller,
    deps,
    ownerActivity,
    orphanActivity,
    states,
    facts,
    put,
    add,
    run,
    fileLstat,
    fileRead,
    gitStatus,
    trackedNames,
    capture,
  };
}

afterEach(() => jest.restoreAllMocks());

describe('assessTargets nested repositories in delete previews', () => {
  describe.each<GitTrackedResult>([
    { state: 'ok', tracked: [] },
    { state: 'not_repo' },
    { state: 'unknown', reason: 'timeout' },
  ])('with owner tracked lookup $state', (tracked) => {
    it.each(['directory', 'file', 'link'] as const)(
      'recycles a cache whose root .git is a %s',
      async (kind) => {
        const f = fixture();
        const path = f.add('.next');
        const marker = f.api.join(path, '.git');
        f.trackedNames.mockResolvedValue(tracked);
        const original = f.fileLstat.getMockImplementation()!;
        f.fileLstat.mockImplementation((candidate) =>
          candidate === marker
            ? Promise.resolve({
                ...stat(kind === 'file'),
                isDirectory: () => kind === 'directory',
                isSymbolicLink: () => kind === 'link',
              })
            : original(candidate),
        );
        const [target] = await f.run([path]);
        expect(target).toMatchObject({
          kind: 'project_content',
          method: 'recycle',
          valid: true,
          defaultSelected: false,
        });
        expect(target.risk.reasons.map(({ code }) => code)).toEqual([
          'DELETE_PROJECT_CONTENT',
        ]);
        expect(f.facts.mock.calls[0][0]).toMatchObject({
          trackedCheck: null,
          frameworkVerified: null,
        });
        expect(f.fileLstat).toHaveBeenCalledWith(marker);
      },
    );

    it('marks denied .git lstat as incomplete before assessing delete risk', async () => {
      const f = fixture();
      const path = f.add('.next');
      const marker = f.api.join(path, '.git');
      f.trackedNames.mockResolvedValue(tracked);
      const original = f.fileLstat.getMockImplementation()!;
      f.fileLstat.mockImplementation((candidate) =>
        candidate === marker
          ? Promise.reject(
              Object.assign(new Error('TEST private nested repo'), {
                code: 'EACCES',
              }),
            )
          : original(candidate),
      );
      const [target] = await f.run([path]);
      expect(target).toMatchObject({
        kind: 'build_cache',
        method: 'permanent',
        risk: { level: 'medium' },
      });
      expect(target.risk.reasons.map(({ code }) => code)).toEqual([
        'RISK_CHECK_INCOMPLETE',
      ]);
      expect(f.facts.mock.calls[0][0].trackedCheck).toBe('unknown');
      expect(f.fileLstat).toHaveBeenCalledWith(marker);
      expect(JSON.stringify(target)).not.toContain('TEST private');
    });

    it.each(['ENOENT', 'ENOTDIR'])(
      'preserves owner tracked evidence when .git is absent with %s',
      async (code) => {
        const f = fixture();
        const path = f.add('.next');
        const marker = f.api.join(path, '.git');
        f.trackedNames.mockResolvedValue(tracked);
        const original = f.fileLstat.getMockImplementation()!;
        f.fileLstat.mockImplementation((candidate) =>
          candidate === marker
            ? Promise.reject(Object.assign(new Error('TEST absent'), { code }))
            : original(candidate),
        );
        const [target] = await f.run([path]);
        expect(target).toMatchObject({
          kind: 'build_cache',
          method: 'permanent',
        });
        expect(f.facts.mock.calls[0][0].trackedCheck).toBe(
          tracked.state === 'ok' ? 'clean' : tracked.state,
        );
        expect(target.risk.reasons.map(({ code }) => code)).toEqual(
          tracked.state === 'unknown' ? ['RISK_CHECK_INCOMPLETE'] : [],
        );
        expect(f.fileLstat).toHaveBeenCalledWith(marker);
      },
    );
  });

  it.each([false, true])(
    'preserves cancellation during .git lstat (reject=%s)',
    async (reject) => {
      const f = fixture();
      const path = f.add('.next');
      const marker = f.api.join(path, '.git');
      const reason = new Error('TEST cancelled nested-repository check');
      const original = f.fileLstat.getMockImplementation()!;
      f.fileLstat.mockImplementation((candidate) => {
        if (candidate !== marker) return original(candidate);
        f.controller.abort(reason);
        return reject
          ? Promise.reject(
              Object.assign(new Error('TEST denied'), { code: 'EACCES' }),
            )
          : Promise.resolve(stat(true));
      });
      await expect(f.run([path])).rejects.toBe(reason);
      expect(f.facts).not.toHaveBeenCalled();
    },
  );
});

describe('assessTargets', () => {
  it('shares owner activity, git status and tracked-name lookup within a batch', async () => {
    const f = fixture();
    const paths = [f.add('.next'), f.add('.turbo')];
    const targets = await f.run(paths);
    expect(targets.map((target) => target.path)).toEqual(paths);
    expect(targets.map((target) => target.risk)).toEqual([
      { level: 'low', reasons: [] },
      { level: 'low', reasons: [] },
    ]);
    expect(f.checkMany).toHaveBeenCalledWith(paths);
    expect(f.checkMany).toHaveBeenCalledTimes(1);
    expect(f.ownerActivity).toHaveBeenCalledTimes(1);
    expect(f.ownerActivity).toHaveBeenCalledWith(f.root, {
      platform: 'win32',
      fs: f.scanFs,
      signal: f.controller.signal,
    });
    expect(f.gitStatus).toHaveBeenCalledTimes(1);
    expect(f.gitStatus).toHaveBeenCalledWith(f.root, f.controller.signal);
    expect(f.trackedNames).toHaveBeenCalledTimes(1);
    expect(f.trackedNames).toHaveBeenCalledWith(
      f.root,
      ['.next', '.turbo'],
      f.controller.signal,
    );
    expect(f.fileRead).toHaveBeenCalledTimes(1);
    expect(f.capture).toHaveBeenCalledTimes(1);
    expect(f.states).toHaveBeenCalledWith(
      { status: 'ok', processes: [] },
      [f.root],
      'win32',
      123,
    );
    expect(targets.every((target) => !target.defaultSelected)).toBe(true);
  });

  it('refreshes facts on subsequent calls rather than reusing a previous assessment', async () => {
    const f = fixture();
    const path = f.add('node_modules');
    expect((await f.run([path]))[0].defaultSelected).toBe(true);
    f.ownerActivity.mockResolvedValue({ ...activity, hasLockfile: false });
    const [second] = await f.run([path]);
    expect(second.hasLockfile).toBe(false);
    expect(second.defaultSelected).toBe(false);
    expect(second.risk.reasons.map(({ code }) => code)).toEqual([
      'NO_LOCKFILE',
    ]);
    expect(f.ownerActivity).toHaveBeenCalledTimes(2);
    expect(f.gitStatus).toHaveBeenCalledTimes(2);
    expect(f.capture).toHaveBeenCalledTimes(2);
  });

  it('does not share owner-specific facts across different projects', async () => {
    const f = fixture();
    const other = 'D:\\TEST-other';
    f.scan.projects.push({
      path: other,
      name: 'TEST-other',
      packageManager: 'npm',
      hasLockfile: true,
      lastActivityAt: OLD,
      nodeModules: {
        path: `${other}\\node_modules`,
        exists: true,
        sizeBytes: null,
      },
    });
    f.put(`${other}\\package.json`, true);
    f.put(`${other}\\node_modules`);
    f.ownerActivity.mockImplementation((owner) =>
      Promise.resolve({
        ...activity,
        hasLockfile: owner === f.root,
      }),
    );
    f.gitStatus.mockImplementation((owner) =>
      Promise.resolve(
        owner === f.root
          ? { state: 'clean' }
          : { state: 'dirty', changedCount: 1 },
      ),
    );
    const result = await f.run([
      f.add('node_modules'),
      `${other}\\node_modules`,
    ]);
    expect(result[0]).toMatchObject({
      defaultSelected: true,
      risk: { level: 'low' },
    });
    expect(result[1]).toMatchObject({
      defaultSelected: false,
      hasLockfile: false,
    });
    expect(result[1].risk.reasons.map(({ code }) => code)).toEqual([
      'UNCOMMITTED_GIT_CHANGES',
      'NO_LOCKFILE',
    ]);
    expect(f.ownerActivity).toHaveBeenCalledTimes(2);
    expect(f.gitStatus).toHaveBeenCalledTimes(2);
    expect(f.capture).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    'uses the orphan parent for process matching, even with owner=%s',
    async (withOwner) => {
      const f = fixture();
      const parent = withOwner ? f.api.join(f.root, 'loose') : 'D:\\TEST-loose';
      const path = f.api.join(parent, 'node_modules');
      f.scan.orphanNodeModules.push({ path, sizeBytes: null, mtime: OLD });
      f.put(path);
      f.capture.mockResolvedValue({
        status: 'ok',
        processes: [
          {
            pid: 456,
            name: 'node.exe',
            executablePath: null,
            commandLine: `node "${parent}\\dev.js"`,
          },
        ],
      });
      const [target] = await f.run([path]);
      expect(target).toMatchObject({
        kind: 'orphan_node_modules',
        hasLockfile: null,
        lastActivityAt: OLD,
        defaultSelected: false,
      });
      expect(target.risk.reasons.map(({ code }) => code)).toEqual(
        expect.arrayContaining(['ORPHAN_NODE_MODULES', 'DEV_PROCESS_RUNNING']),
      );
      expect(f.states.mock.calls[0][1]).toEqual([parent]);
      expect(f.orphanActivity).toHaveBeenCalledWith(
        path,
        expect.objectContaining({ fs: f.scanFs }),
      );
      expect(f.ownerActivity).not.toHaveBeenCalled();
      expect(f.gitStatus).not.toHaveBeenCalled();
      expect(f.trackedNames).not.toHaveBeenCalled();
      expect(f.facts.mock.calls[0][0].git).toBeNull();
    },
  );

  it('downgrades a tracked cache to recyclable content before risk assessment', async () => {
    const f = fixture();
    const path = f.add('.next');
    f.trackedNames.mockResolvedValue({ state: 'ok', tracked: ['.next'] });
    const [target] = await f.run([path]);
    expect(target).toMatchObject({
      kind: 'project_content',
      method: 'recycle',
      valid: true,
      defaultSelected: false,
    });
    expect(target.risk.reasons.map(({ code }) => code)).toEqual([
      'DELETE_PROJECT_CONTENT',
    ]);
    expect(f.facts.mock.calls[0][0]).toMatchObject({
      trackedCheck: null,
      frameworkVerified: null,
    });
  });

  it.each<[GitTrackedResult, RiskCode[]]>([
    [{ state: 'not_repo' }, []],
    [{ state: 'unknown', reason: 'timeout' }, ['RISK_CHECK_INCOMPLETE']],
  ])(
    'retains cache classification for tracked lookup %j',
    async (tracked, codes) => {
      const f = fixture();
      f.trackedNames.mockResolvedValue(tracked);
      const [target] = await f.run([f.add('.next')]);
      expect(target).toMatchObject({
        kind: 'build_cache',
        method: 'permanent',
      });
      expect(target.risk.reasons.map(({ code }) => code)).toEqual(codes);
    },
  );

  it.each([
    ['{"dependencies":{"next":"1"}}', []],
    ['{"devDependencies":{"next":"1"}}', []],
    ['\uFEFF{"devDependencies":{"next":"1"}}', []],
    ['{"scripts":{"next":"next build"}}', ['UNVERIFIED_CLEANUP_TARGET']],
    ['{invalid', ['UNVERIFIED_CLEANUP_TARGET']],
    ['[]', ['UNVERIFIED_CLEANUP_TARGET']],
  ] as [string, RiskCode[]][])(
    'verifies delete cache frameworks from manifest %s',
    async (manifest, codes) => {
      const f = fixture();
      f.fileRead.mockResolvedValue(manifest);
      const [target] = await f.run([f.add('.next')]);
      expect(target.risk.reasons.map(({ code }) => code)).toEqual(codes);
    },
  );

  it('shares the wildcard framework policy for coverage', async () => {
    const f = fixture();
    f.fileRead.mockResolvedValue(
      '{"devDependencies":{"@vitest/coverage-v8":"1"}}',
    );
    const [target] = await f.run([f.add('coverage')]);
    expect(target.risk).toEqual({ level: 'low', reasons: [] });
  });

  it('treats an unreadable framework manifest as unverified', async () => {
    const f = fixture();
    f.fileRead.mockRejectedValue(new Error('TEST private fs error'));
    const [target] = await f.run([f.add('.next')]);
    expect(target.risk.reasons.map(({ code }) => code)).toEqual([
      'UNVERIFIED_CLEANUP_TARGET',
    ]);
  });

  it.each<PathPlatform>(['win32', 'posix'])(
    'uses cleanup facts with %s comparison rules and no tracked lookup',
    async (platform) => {
      const f = fixture(platform);
      const path = f.add('.next');
      const cleanupFacts = new Map<
        string,
        Pick<ICleanupCandidate, 'trackedCheck' | 'frameworkVerified'>
      >([
        [
          path.toUpperCase(),
          { trackedCheck: 'unknown', frameworkVerified: true },
        ],
      ]);
      if (platform === 'posix')
        cleanupFacts.set(path, {
          trackedCheck: 'clean',
          frameworkVerified: true,
        });
      const [target] = await f.run([path], cleanupFacts);
      expect(target.risk.reasons.map(({ code }) => code)).toEqual(
        platform === 'win32' ? ['RISK_CHECK_INCOMPLETE'] : [],
      );
      expect(f.trackedNames).not.toHaveBeenCalled();
      expect(f.fileRead).not.toHaveBeenCalled();
      expect(f.facts.mock.calls[0][0]).toMatchObject({
        trackedCheck: platform === 'win32' ? 'unknown' : 'clean',
        frameworkVerified: true,
      });
    },
  );

  it('does not apply cleanup cache facts to node_modules', async () => {
    const f = fixture();
    const path = f.add('node_modules');
    const [target] = await f.run(
      [path],
      new Map([[path, { trackedCheck: 'unknown', frameworkVerified: false }]]),
    );
    expect(target.risk).toEqual({ level: 'low', reasons: [] });
    expect(f.facts.mock.calls[0][0]).toMatchObject({
      trackedCheck: null,
      frameworkVerified: null,
    });
  });

  it.each<[boolean | null, boolean]>([
    [true, true],
    [false, false],
    [null, false],
  ])(
    'selects node_modules only with a proven lockfile (%s)',
    async (hasLockfile, selected) => {
      const f = fixture();
      f.ownerActivity.mockResolvedValue({
        ...activity,
        hasLockfile,
        incomplete: hasLockfile === null,
      });
      const [target] = await f.run([f.add('node_modules')]);
      expect(target).toMatchObject({
        hasLockfile,
        defaultSelected: selected,
        lastActivityAt: OLD,
      });
    },
  );

  it('never selects a high-risk node_modules target', async () => {
    const f = fixture();
    f.capture.mockResolvedValue({
      status: 'ok',
      processes: [
        {
          pid: 456,
          name: 'node.exe',
          executablePath: null,
          commandLine: `node "${f.root}\\dev.js"`,
        },
      ],
    });
    const [target] = await f.run([f.add('node_modules')]);
    expect(target).toMatchObject({
      hasLockfile: true,
      defaultSelected: false,
      risk: { level: 'high' },
    });
  });

  it('excludes its own process from running-process risk', async () => {
    const f = fixture();
    f.capture.mockResolvedValue({
      status: 'ok',
      processes: [
        {
          pid: 123,
          name: 'node.exe',
          executablePath: null,
          commandLine: `node "${f.root}\\dev.js"`,
        },
      ],
    });
    const [target] = await f.run([f.add('node_modules')]);
    expect(target.risk).toEqual({ level: 'low', reasons: [] });
    expect(target.defaultSelected).toBe(true);
  });

  it('marks incomplete process and git probes without leaking their details', async () => {
    const f = fixture();
    f.capture.mockResolvedValue({
      status: 'unknown',
      reason: 'TEST private process error',
    });
    f.gitStatus.mockResolvedValue({
      state: 'unknown',
      reason: 'unsafe_config',
    });
    const [target] = await f.run([f.add('node_modules')]);
    expect(target.risk.reasons.map(({ code }) => code)).toEqual([
      'RISK_CHECK_INCOMPLETE',
    ]);
    expect(JSON.stringify(target)).not.toContain('TEST private');
  });

  it('preserves classification order, deduplication and identity', async () => {
    const f = fixture();
    const a = f.add('src');
    const b = f.add('node_modules');
    const child = f.add('src\\child');
    const targets = await f.run([child, b, a, b]);
    expect(targets.map(({ path }) => path)).toEqual([b, a]);
    expect(targets[0].identity).toEqual({
      dev: '7',
      ino: '9007199254740993',
      type: 'directory',
    });
  });

  it('does not perform further I/O for an invalid target', async () => {
    const f = fixture();
    f.checkMany.mockResolvedValue([
      {
        allowed: false,
        code: 'DENYLISTED',
        message: 'TEST private guard detail',
      },
    ]);
    const targets = await f.run(['D:\\TEST-denied']);
    expect(targets).toEqual([
      {
        inputPath: 'D:\\TEST-denied',
        path: 'D:\\TEST-denied',
        kind: null,
        method: null,
        valid: false,
        failureCode: 'DENYLISTED',
        owner: null,
        identity: null,
        nestedProjects: [],
        hasLockfile: null,
        lastActivityAt: null,
        risk: { level: 'low', reasons: [] },
        defaultSelected: false,
      },
    ]);
    expect(f.fileLstat).not.toHaveBeenCalled();
    expect(f.fileRead).not.toHaveBeenCalled();
    expect(f.gitStatus).not.toHaveBeenCalled();
    expect(f.trackedNames).not.toHaveBeenCalled();
    expect(f.ownerActivity).not.toHaveBeenCalled();
    expect(f.orphanActivity).not.toHaveBeenCalled();
    expect(f.capture).not.toHaveBeenCalled();
  });

  it.each([
    'before',
    'guard',
    'classification',
    'tracked',
    'framework',
    'activity',
    'git',
    'process',
  ] as const)('rejects cancellation at the %s boundary', async (stage) => {
    const f = fixture();
    const path = f.add('.next');
    const reason = new Error('TEST aborted');
    const abort = () => f.controller.abort(reason);
    if (stage === 'before') abort();
    if (stage === 'guard')
      f.checkMany.mockImplementation((paths) => {
        abort();
        return Promise.resolve(
          paths.map((p) => ({
            allowed: true,
            path: {
              inputPath: p,
              resolvedPath: p,
              realPath: p,
              isSymbolicLink: false,
            },
          })),
        );
      });
    if (stage === 'classification')
      f.fileLstat.mockImplementation((p) => {
        abort();
        return Promise.resolve(stat(p.endsWith('package.json')));
      });
    if (stage === 'tracked')
      f.trackedNames.mockImplementation(() => {
        abort();
        return Promise.resolve({ state: 'ok', tracked: [] });
      });
    if (stage === 'framework')
      f.fileRead.mockImplementation(() => {
        abort();
        return Promise.resolve('{}');
      });
    if (stage === 'activity')
      f.ownerActivity.mockImplementation(() => {
        abort();
        return Promise.resolve(activity);
      });
    if (stage === 'git')
      f.gitStatus.mockImplementation(() => {
        abort();
        return Promise.resolve({ state: 'clean' });
      });
    if (stage === 'process')
      f.capture.mockImplementation(() => {
        abort();
        return Promise.resolve({ status: 'ok', processes: [] });
      });
    await expect(f.run([path])).rejects.toBe(reason);
    expect(f.facts).not.toHaveBeenCalled();
    if (stage !== 'process') expect(f.capture).not.toHaveBeenCalled();
    if (stage === 'before') expect(f.checkMany).not.toHaveBeenCalled();
  });
});
