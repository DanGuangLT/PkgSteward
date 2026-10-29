import type { Dirent } from 'node:fs';
import type { PathPlatform } from '@/common/utils/path.util';
import type { IRisk, RiskCode } from '@/core/risk/interfaces/risk.types';
import { assessRisk } from '@/core/risk/risk';
import {
  assessSelectionRisk,
  assessTargetRisk,
  changedRiskPaths,
  processStates,
  readOrphanActivity,
  readOwnerActivity,
  selectionConfirmText,
  targetRiskCodes,
  type ITargetRiskFacts,
} from '@/file-ops/file-ops-risk';
import type {
  FileOpsKind,
  GitStatusResult,
} from '@/file-ops/interfaces/file-ops.types';
import type { IScanFs } from '@/scanner/interfaces/scanner.types';

const now = new Date('2026-10-29T00:00:00.000Z');
const facts = (
  overrides: Partial<ITargetRiskFacts> = {},
): ITargetRiskFacts => ({
  kind: 'node_modules',
  activity: { hasLockfile: true, lastActivityAt: null, incomplete: false },
  git: { state: 'clean' },
  trackedCheck: null,
  frameworkVerified: null,
  process: 'none',
  ...overrides,
});
const kinds: FileOpsKind[] = [
  'node_modules',
  'orphan_node_modules',
  'build_cache',
  'project',
  'project_content',
];
const riskCodes = (risk: IRisk) => risk.reasons.map(({ code }) => code);

describe('targetRiskCodes', () => {
  it.each<[FileOpsKind, RiskCode[]]>([
    ['node_modules', []],
    ['orphan_node_modules', ['ORPHAN_NODE_MODULES']],
    ['build_cache', []],
    ['project', ['DELETE_WHOLE_PROJECT']],
    ['project_content', ['DELETE_PROJECT_CONTENT']],
  ])('adds only the inherent codes for %s', (kind, expected) => {
    expect(
      targetRiskCodes(facts({ kind, frameworkVerified: true }), now),
    ).toEqual(expected);
  });

  describe.each(kinds)('%s lockfile policy', (kind) => {
    it.each([true, false, null])('hasLockfile=%s', (hasLockfile) => {
      const codes = targetRiskCodes(
        facts({
          kind,
          activity: { hasLockfile, lastActivityAt: null, incomplete: false },
        }),
        now,
      );
      expect(codes.includes('NO_LOCKFILE')).toBe(
        kind === 'node_modules' && hasLockfile === false,
      );
    });
  });

  describe.each(kinds)('%s Git policy', (kind) => {
    it.each<[GitStatusResult | null, boolean, boolean]>([
      [{ state: 'clean' }, false, false],
      [{ state: 'dirty', changedCount: 2 }, true, false],
      [{ state: 'not_repo' }, false, false],
      [{ state: 'unknown', reason: 'unsafe_config' }, false, true],
      [null, false, false],
    ])('git=%j', (git, dirty, incomplete) => {
      const codes = targetRiskCodes(facts({ kind, git }), now);
      expect(codes.includes('UNCOMMITTED_GIT_CHANGES')).toBe(
        dirty && kind !== 'orphan_node_modules',
      );
      expect(codes.includes('RISK_CHECK_INCOMPLETE')).toBe(
        incomplete && kind !== 'orphan_node_modules',
      );
    });
  });

  it.each<[string | null, boolean]>([
    ['2026-10-22T00:00:00.000Z', true],
    ['2026-10-21T23:59:59.999Z', false],
    ['2026-10-28T12:00:00.000Z', true],
    [null, false],
  ])('uses the seven-day boundary for %s', (lastActivityAt, expected) => {
    const codes = targetRiskCodes(
      facts({
        activity: { hasLockfile: true, lastActivityAt, incomplete: false },
      }),
      now,
    );
    expect(codes.includes('RECENTLY_ACTIVE')).toBe(expected);
  });

  describe.each(kinds)('%s framework policy', (kind) => {
    it.each([true, false, null])(
      'frameworkVerified=%s',
      (frameworkVerified) => {
        expect(
          targetRiskCodes(facts({ kind, frameworkVerified }), now).includes(
            'UNVERIFIED_CLEANUP_TARGET',
          ),
        ).toBe(kind === 'build_cache' && frameworkVerified !== true);
      },
    );
  });

  it.each<Partial<ITargetRiskFacts>>([
    { activity: { hasLockfile: null, lastActivityAt: null, incomplete: true } },
    { git: { state: 'unknown', reason: 'timeout' } },
    { process: 'unknown' },
    { trackedCheck: 'unknown' },
  ])('marks each independently incomplete check: %j', (override) => {
    expect(targetRiskCodes(facts(override), now)).toContain(
      'RISK_CHECK_INCOMPLETE',
    );
  });

  it.each(['clean', 'not_repo', null] as const)(
    'does not mark trackedCheck=%s incomplete',
    (trackedCheck) => {
      expect(targetRiskCodes(facts({ trackedCheck }), now)).not.toContain(
        'RISK_CHECK_INCOMPLETE',
      );
    },
  );

  it('deduplicates incomplete reasons and preserves independent risks', () => {
    const codes = targetRiskCodes(
      facts({
        kind: 'build_cache',
        activity: {
          hasLockfile: null,
          lastActivityAt: now.toISOString(),
          incomplete: true,
        },
        git: { state: 'unknown', reason: 'git_missing' },
        trackedCheck: 'unknown',
        process: 'unknown',
      }),
      now,
    );
    expect(codes.slice().sort()).toEqual([
      'RECENTLY_ACTIVE',
      'RISK_CHECK_INCOMPLETE',
      'UNVERIFIED_CLEANUP_TARGET',
    ]);
  });

  it.each(['none', 'running', 'unknown'] as const)('process=%s', (process) => {
    expect(
      targetRiskCodes(facts({ process }), now).includes('DEV_PROCESS_RUNNING'),
    ).toBe(process === 'running');
  });

  it('assesses target reasons with the shared catalog and severity order', () => {
    const result = assessTargetRisk(
      facts({
        kind: 'orphan_node_modules',
        process: 'running',
        activity: {
          hasLockfile: null,
          lastActivityAt: now.toISOString(),
          incomplete: false,
        },
      }),
      now,
    );
    expect(result).toEqual({
      level: 'high',
      reasons: [
        {
          code: 'DEV_PROCESS_RUNNING',
          level: 'high',
          message: 'A running process appears to use this location',
        },
        {
          code: 'RECENTLY_ACTIVE',
          level: 'medium',
          message: 'Project was active within the last 7 days',
        },
        {
          code: 'ORPHAN_NODE_MODULES',
          level: 'low',
          message: 'node_modules folder whose parent has no package.json',
        },
      ],
    });
  });
});

describe('selection risk and confirmation', () => {
  it('returns low risk for an empty selection', () => {
    expect(assessSelectionRisk([])).toEqual({ level: 'low', reasons: [] });
  });

  it.each([
    [19, false],
    [20, true],
  ] as const)('count=%i', (count, expected) => {
    const result = assessSelectionRisk(
      Array.from({ length: count }, () => ({
        risk: assessRisk([]),
        sizeBytes: 0,
      })),
    );
    expect(riskCodes(result)).toEqual(expected ? ['LARGE_BATCH'] : []);
    expect(result.level).toBe(expected ? 'medium' : 'low');
  });

  it.each([
    [4_999_999_999, false],
    [5_000_000_000, true],
  ] as const)('bytes=%i', (total, expected) => {
    const result = assessSelectionRisk([
      { risk: assessRisk([]), sizeBytes: 2_000_000_000 },
      { risk: assessRisk([]), sizeBytes: total - 2_000_000_000 },
    ]);
    expect(riskCodes(result)).toEqual(expected ? ['LARGE_BATCH'] : []);
  });

  it('combines and deduplicates target risks while retaining high severity', () => {
    const result = assessSelectionRisk([
      {
        risk: assessRisk(['NO_LOCKFILE', 'DEV_PROCESS_RUNNING']),
        sizeBytes: 3_000_000_000,
      },
      { risk: assessRisk(['NO_LOCKFILE']), sizeBytes: 2_000_000_000 },
    ]);
    expect(result.level).toBe('high');
    expect(riskCodes(result)).toEqual([
      'DEV_PROCESS_RUNNING',
      'NO_LOCKFILE',
      'LARGE_BATCH',
    ]);
  });

  it.each<[PathPlatform, string, string]>([
    ['win32', 'D:\\Dự án\\Ứng dụng 🚀', 'Ứng dụng 🚀'],
    ['posix', '/work/Ứng dụng 🚀', 'Ứng dụng 🚀'],
  ])('uses the project basename on %s', (platform, path, expected) => {
    expect(
      selectionConfirmText(
        [{ kind: 'project', path }],
        assessRisk(['DELETE_WHOLE_PROJECT']),
        platform,
      ),
    ).toBe(expected);
  });

  it.each<FileOpsKind>([
    'project_content',
    'node_modules',
    'orphan_node_modules',
    'build_cache',
  ])('counts a single high-risk %s', (kind) => {
    expect(
      selectionConfirmText(
        [{ kind, path: 'D:\\app\\src' }],
        assessRisk(['DEV_PROCESS_RUNNING']),
        'win32',
      ),
    ).toBe('DELETE 1');
  });

  it('counts multiple projects', () => {
    expect(
      selectionConfirmText(
        [
          { kind: 'project', path: 'D:\\one' },
          { kind: 'project', path: 'D:\\two' },
        ],
        assessRisk(['DELETE_WHOLE_PROJECT']),
        'win32',
      ),
    ).toBe('DELETE 2');
  });

  it.each<IRisk>([assessRisk([]), assessRisk(['NO_LOCKFILE'])])(
    'needs no text at $level severity',
    (risk) => {
      expect(
        selectionConfirmText(
          [{ kind: 'project', path: 'D:\\app' }],
          risk,
          'win32',
        ),
      ).toBeNull();
    },
  );
});

describe('changedRiskPaths', () => {
  it('returns increases and new paths in after order, ignoring decreases, unchanged and removed paths', () => {
    const low = assessRisk([]);
    const medium = assessRisk(['NO_LOCKFILE']);
    const high = assessRisk(['DEV_PROCESS_RUNNING']);
    const before = new Map([
      ['increased', low],
      ['new-code', medium],
      ['decreased', high],
      ['unchanged', medium],
      ['removed', high],
    ]);
    const after = new Map([
      ['new-code', assessRisk(['NO_LOCKFILE', 'RECENTLY_ACTIVE'])],
      ['decreased', low],
      ['new-path', low],
      ['increased', high],
      ['unchanged', medium],
    ]);
    expect(changedRiskPaths(before, after)).toEqual([
      'new-code',
      'new-path',
      'increased',
    ]);
  });

  it('detects a new reason even if overall severity falls', () => {
    expect(
      changedRiskPaths(
        new Map([['app', assessRisk(['DEV_PROCESS_RUNNING'])]]),
        new Map([['app', assessRisk(['NO_LOCKFILE'])]]),
      ),
    ).toEqual(['app']);
  });

  it('returns no changes for empty maps', () => {
    expect(changedRiskPaths(new Map(), new Map())).toEqual([]);
  });
});

const activityFixture = () => {
  const root = 'D:\\Dự án';
  const controller = new AbortController();
  const stats = new Map<string, Awaited<ReturnType<IScanFs['lstat']>>>();
  const entry = (name: string) =>
    ({
      name,
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false,
    }) as Dirent;
  const stat = (mtime: string) => ({
    mtimeMs: Date.parse(mtime),
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
  });
  stats.set(`${root}\\package.json`, stat('2026-10-01T00:00:00.000Z'));
  stats.set(`${root}\\pnpm-lock.yaml`, stat('2026-10-28T00:00:00.000Z'));
  const fs = {
    readdir: jest.fn<Promise<Dirent[]>, [string]>(),
    lstat: jest.fn((path: string) => {
      const value = stats.get(path);
      return value
        ? Promise.resolve(value)
        : Promise.reject(
            Object.assign(new Error('missing'), { code: 'ENOENT' }),
          );
    }),
    realpath: jest.fn((path: string) => Promise.resolve(path)),
    readFile: jest.fn(() => Promise.resolve('{"name":"app"}')),
  } satisfies IScanFs;
  fs.readdir.mockResolvedValue([
    entry('package.json'),
    entry('pnpm-lock.yaml'),
  ]);
  const run = () =>
    readOwnerActivity(root, {
      platform: 'win32',
      fs,
      signal: controller.signal,
    });
  return { root, controller, stats, fs, entry, run };
};

describe('activity readers', () => {
  const incomplete = {
    hasLockfile: null,
    lastActivityAt: null,
    incomplete: true,
  };

  it('recomputes owner activity using the newer lockfile', async () => {
    const f = activityFixture();
    await expect(f.run()).resolves.toEqual({
      hasLockfile: true,
      lastActivityAt: '2026-10-28T00:00:00.000Z',
      incomplete: false,
    });
    expect(f.fs.readdir).toHaveBeenCalledWith(f.root);
  });

  it('reports a project without a lockfile', async () => {
    const f = activityFixture();
    f.fs.readdir.mockResolvedValue([f.entry('package.json')]);
    await expect(f.run()).resolves.toEqual({
      hasLockfile: false,
      lastActivityAt: '2026-10-01T00:00:00.000Z',
      incomplete: false,
    });
  });

  it('reports an incomplete check when the project no longer exists', async () => {
    const f = activityFixture();
    f.fs.readdir.mockResolvedValue([]);
    await expect(f.run()).resolves.toEqual(incomplete);
  });

  it.each(['readdir', 'lstat', 'readFile'] as const)(
    'converts %s errors to incomplete',
    async (method) => {
      const f = activityFixture();
      f.fs[method].mockRejectedValue(
        Object.assign(new Error('private detail'), { code: 'EACCES' }),
      );
      await expect(f.run()).resolves.toEqual(incomplete);
    },
  );

  it.each(['readdir', 'lstat', 'readFile'] as const)(
    'propagates cancellation during %s',
    async (method) => {
      const f = activityFixture();
      const reason = new Error('cancel activity');
      f.fs[method].mockImplementation(() => {
        f.controller.abort(reason);
        return Promise.reject(reason);
      });
      await expect(f.run()).rejects.toBe(reason);
    },
  );

  it('rejects if readdir finishes empty after cancellation', async () => {
    const f = activityFixture();
    const reason = new Error('cancel empty directory');
    f.fs.readdir.mockImplementation(() => {
      f.controller.abort(reason);
      return Promise.resolve([]);
    });
    await expect(f.run()).rejects.toBe(reason);
  });

  it('reads orphan directory mtime without a lockfile decision', async () => {
    const lstat = jest.fn(() =>
      Promise.resolve({
        mtimeMs: Date.parse('2026-10-20T01:02:03.000Z'),
        isFile: () => false,
        isDirectory: () => true,
        isSymbolicLink: () => false,
      }),
    );
    await expect(
      readOrphanActivity('D:\\orphan\\node_modules', { fs: { lstat } }),
    ).resolves.toEqual({
      hasLockfile: null,
      lastActivityAt: '2026-10-20T01:02:03.000Z',
      incomplete: false,
    });
    expect(lstat).toHaveBeenCalledWith('D:\\orphan\\node_modules');
  });

  it('marks an unreadable orphan incomplete', async () => {
    const lstat = jest.fn(() => Promise.reject(new Error('private detail')));
    await expect(
      readOrphanActivity('D:\\orphan\\node_modules', { fs: { lstat } }),
    ).resolves.toEqual(incomplete);
  });
});

describe('processStates', () => {
  it('preserves root spelling and excludes the current process and name prefixes', () => {
    const result = processStates(
      {
        status: 'ok',
        processes: [
          {
            pid: 42,
            name: 'node',
            executablePath: null,
            commandLine: 'node D:\\Self\\app.js',
          },
          {
            pid: 43,
            name: 'node',
            executablePath: 'd:/dự án/node.exe',
            commandLine: null,
          },
          {
            pid: 44,
            name: 'node',
            executablePath: null,
            commandLine: 'node D:\\Prefix-other\\app.js',
          },
          {
            pid: 45,
            name: 'node',
            executablePath: null,
            commandLine: 'node "D:\\Second\\app.js"',
          },
        ],
      },
      ['D:\\Dự án', 'D:\\Self', 'D:\\Prefix', 'D:\\Second', 'D:\\Idle'],
      'win32',
      42,
    );
    expect([...result]).toEqual([
      ['D:\\Dự án', 'running'],
      ['D:\\Self', 'none'],
      ['D:\\Prefix', 'none'],
      ['D:\\Second', 'running'],
      ['D:\\Idle', 'none'],
    ]);
  });

  it('returns unknown for every root on an unavailable snapshot', () => {
    expect([
      ...processStates(
        { status: 'unknown', reason: 'denied' },
        ['D:\\A', 'D:\\b'],
        'win32',
        1,
      ),
    ]).toEqual([
      ['D:\\A', 'unknown'],
      ['D:\\b', 'unknown'],
    ]);
  });

  it('returns none for an empty successful snapshot', () => {
    expect([
      ...processStates({ status: 'ok', processes: [] }, ['/app'], 'linux', 1),
    ]).toEqual([['/app', 'none']]);
  });

  it('keeps POSIX root matching case-sensitive', () => {
    expect([
      ...processStates(
        {
          status: 'ok',
          processes: [
            {
              pid: 2,
              name: 'node',
              executablePath: '/App/node',
              commandLine: null,
            },
          ],
        },
        ['/App', '/app'],
        'linux',
        1,
      ),
    ]).toEqual([
      ['/App', 'running'],
      ['/app', 'none'],
    ]);
  });
});
