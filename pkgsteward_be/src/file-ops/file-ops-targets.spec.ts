import { pathApi, type PathPlatform } from '@/common/utils/path.util';
import type {
  IGuardedPath,
  PathCheckFailureCode,
  PathCheckResult,
} from '@/core/path-guard/interfaces/path-guard.types';
import {
  BUILD_CACHE_DIR_NAMES,
  classifyTargets,
  matchBuildCacheName,
  methodForKind,
} from '@/file-ops/file-ops-targets';
import type {
  FileOpsKind,
  FileOpsMethod,
  IFileOpsStat,
  TargetFailureCode,
} from '@/file-ops/interfaces/file-ops.types';
import type {
  IScanProjectMetadata,
  IStoredScanResult,
} from '@/scanner/interfaces/scanner.types';

const errno = (code: string) =>
  Object.assign(new Error('private fs detail'), { code });
type EntryKind = 'file' | 'directory' | 'link' | 'special';
const stat = (kind: EntryKind = 'directory'): IFileOpsStat => ({
  dev: 9007199254740993n,
  ino: 12345678901234567890n,
  size: 0n,
  isFile: () => kind === 'file',
  isDirectory: () => kind === 'directory',
  isSymbolicLink: () => kind === 'link',
});
const allowed = (
  inputPath: string,
  overrides: Partial<IGuardedPath> = {},
): PathCheckResult => ({
  allowed: true,
  path: {
    inputPath,
    resolvedPath: inputPath,
    realPath: inputPath,
    isSymbolicLink: false,
    ...overrides,
  },
});

const fixture = (platform: PathPlatform = 'win32') => {
  const api = pathApi(platform);
  const key = (p: string) =>
    platform === 'win32' ? api.resolve(p).toLowerCase() : api.resolve(p);
  const nodes = new Map<string, IFileOpsStat | Error>();
  const scan: Pick<IStoredScanResult, 'projects' | 'orphanNodeModules'> = {
    projects: [],
    orphanNodeModules: [],
  };
  const put = (p: string, value: IFileOpsStat | Error = stat()) =>
    nodes.set(key(p), value);
  const project = (
    p: string,
    name: string | null = api.basename(p),
  ): IScanProjectMetadata => {
    const value: IScanProjectMetadata = {
      path: p,
      name,
      packageManager: null,
      hasLockfile: false,
      lastActivityAt: '2026-10-01T00:00:00.000Z',
      nodeModules: {
        path: api.join(p, 'node_modules'),
        exists: false,
        sizeBytes: null,
      },
    };
    scan.projects.push(value);
    put(p);
    put(api.join(p, 'package.json'), stat('file'));
    return value;
  };
  const orphan = (p: string) => {
    scan.orphanNodeModules.push({
      path: p,
      sizeBytes: null,
      mtime: '2026-10-01T00:00:00.000Z',
    });
    put(p);
  };
  const lstat = jest.fn((p: string): Promise<IFileOpsStat> => {
    const value = nodes.get(key(p)) ?? errno('ENOENT');
    return value instanceof Error
      ? Promise.reject(value)
      : Promise.resolve(value);
  });
  const run = (
    paths: readonly string[],
    checks = paths.map((p) => allowed(p)),
  ) => classifyTargets(paths, checks, scan, { platform, fs: { lstat } });
  return { scan, put, project, orphan, lstat, run };
};

describe('file-ops target policy', () => {
  it('keeps the approved cache names and their discovery order', () => {
    expect(BUILD_CACHE_DIR_NAMES).toEqual([
      '.next',
      '.nuxt',
      '.svelte-kit',
      '.turbo',
      '.parcel-cache',
      '.angular',
      'coverage',
      '.nyc_output',
    ]);
  });

  it.each<[FileOpsKind, FileOpsMethod]>([
    ['project', 'recycle'],
    ['project_content', 'recycle'],
    ['node_modules', 'permanent'],
    ['orphan_node_modules', 'permanent'],
    ['build_cache', 'permanent'],
  ])('%s uses %s', (kind, method) => {
    expect(methodForKind(kind)).toBe(method);
  });

  it.each<[string, PathPlatform, string | null]>([
    ['.NEXT', 'win32', '.next'],
    ['.NEXT', 'posix', null],
    ['.next', 'posix', '.next'],
    ['.nextjs', 'win32', null],
    ['dist', 'win32', null],
    ['build', 'posix', null],
    ['.nuxt', 'posix', '.nuxt'],
    ['.svelte-kit', 'posix', '.svelte-kit'],
    ['.turbo', 'posix', '.turbo'],
    ['.parcel-cache', 'posix', '.parcel-cache'],
    ['.angular', 'posix', '.angular'],
    ['coverage', 'posix', 'coverage'],
    ['.nyc_output', 'posix', '.nyc_output'],
  ])('matches cache %s on %s as %s', (name, platform, expected) => {
    expect(matchBuildCacheName(name, platform)).toBe(expected);
  });
});

describe('classifyTargets', () => {
  it.each<[string, FileOpsKind, FileOpsMethod, EntryKind]>([
    ['D:\\p', 'project', 'recycle', 'directory'],
    ['D:\\p\\node_modules', 'node_modules', 'permanent', 'directory'],
    ['D:\\p\\.next', 'build_cache', 'permanent', 'directory'],
    ['D:\\p\\src', 'project_content', 'recycle', 'directory'],
    ['D:\\p\\README.md', 'project_content', 'recycle', 'file'],
  ])(
    'classifies %s as %s with fresh identity',
    async (p, kind, method, type) => {
      const f = fixture();
      f.project('D:\\p', 'package-name');
      f.put(p, stat(type));
      expect(await f.run([p])).toEqual([
        {
          inputPath: p,
          path: p,
          kind,
          method,
          valid: true,
          failureCode: null,
          owner: { path: 'D:\\p', name: 'package-name' },
          nestedProjects: [],
          identity: {
            dev: '9007199254740993',
            ino: '12345678901234567890',
            type,
          },
        },
      ]);
    },
  );

  it('classifies an orphan without an owner', async () => {
    const f = fixture();
    f.orphan('D:\\loose\\node_modules');
    expect(await f.run(['D:\\loose\\node_modules'])).toEqual([
      expect.objectContaining({
        valid: true,
        kind: 'orphan_node_modules',
        method: 'permanent',
        owner: null,
        failureCode: null,
        nestedProjects: [],
        identity: {
          dev: '9007199254740993',
          ino: '12345678901234567890',
          type: 'directory',
        },
      }),
    ]);
  });

  it.each<PathCheckFailureCode>([
    'INVALID_PATH',
    'NOT_FOUND',
    'DENYLISTED',
    'OUTSIDE_ALLOWLIST',
  ])('preserves guard failure %s without filesystem access', async (code) => {
    const f = fixture();
    expect(
      await f.run(
        ['raw-input'],
        [{ allowed: false, code, message: 'private guard detail' }],
      ),
    ).toEqual([
      {
        inputPath: 'raw-input',
        path: 'raw-input',
        valid: false,
        kind: null,
        method: null,
        failureCode: code,
        owner: null,
        nestedProjects: [],
        identity: null,
      },
    ]);
    expect(f.lstat).not.toHaveBeenCalled();
  });

  it('rejects a guarded link at resolvedPath without inspecting its realPath', async () => {
    const f = fixture();
    const input = 'D:\\alias';
    expect(
      await f.run(
        [input],
        [
          allowed(input, {
            isSymbolicLink: true,
            resolvedPath: 'D:\\Alias',
            realPath: 'D:\\p',
          }),
        ],
      ),
    ).toEqual([
      expect.objectContaining({
        path: 'D:\\Alias',
        valid: false,
        failureCode: 'IS_LINK',
        kind: null,
        method: null,
        identity: null,
      }),
    ]);
    expect(f.lstat).not.toHaveBeenCalled();
  });

  it.each<[string, TargetFailureCode]>([
    ['ENOENT', 'NOT_FOUND'],
    ['ENOTDIR', 'NOT_FOUND'],
    ['EACCES', 'STAT_FAILED'],
  ])('maps target lstat %s to %s at realPath', async (code, failureCode) => {
    const f = fixture();
    f.put('D:\\real', errno(code));
    const result = await f.run(
      ['D:\\alias'],
      [allowed('D:\\alias', { realPath: 'D:\\real' })],
    );
    expect(result).toEqual([
      expect.objectContaining({
        path: 'D:\\real',
        valid: false,
        failureCode,
        kind: null,
        method: null,
        identity: null,
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain('private fs detail');
  });

  it.each<[EntryKind, TargetFailureCode]>([
    ['link', 'IS_LINK'],
    ['special', 'UNSUPPORTED_TYPE'],
  ])('rejects a target that is now %s', async (kind, failureCode) => {
    const f = fixture();
    f.put('D:\\changed', stat(kind));
    expect(await f.run(['D:\\changed'])).toEqual([
      expect.objectContaining({
        valid: false,
        failureCode,
        kind: null,
        method: null,
        identity: null,
      }),
    ]);
  });

  it('uses realPath after resolving a junction in an ancestor', async () => {
    const f = fixture();
    f.project('D:\\real');
    f.put('D:\\real\\node_modules');
    expect(
      await f.run(
        ['D:\\alias\\node_modules'],
        [
          allowed('D:\\alias\\node_modules', {
            realPath: 'D:\\real\\node_modules',
          }),
        ],
      ),
    ).toEqual([
      expect.objectContaining({
        inputPath: 'D:\\alias\\node_modules',
        path: 'D:\\real\\node_modules',
        valid: true,
        kind: 'node_modules',
        owner: { path: 'D:\\real', name: 'real' },
      }),
    ]);
    expect(f.lstat).not.toHaveBeenCalledWith('D:\\alias\\node_modules');
  });

  it('picks the longest owner even when the parent appears first in the scan', async () => {
    const f = fixture();
    f.project('D:\\mono', 'mono');
    f.project('D:\\mono\\packages\\a', 'a');
    f.put('D:\\mono\\packages\\a\\src');
    expect(await f.run(['D:\\mono\\packages\\a\\src'])).toEqual([
      expect.objectContaining({
        valid: true,
        kind: 'project_content',
        owner: { path: 'D:\\mono\\packages\\a', name: 'a' },
      }),
    ]);
  });

  it('reports strictly nested projects in scan order for content and project targets', async () => {
    const f = fixture();
    f.project('D:\\mono', 'mono');
    f.project('D:\\mono\\packages\\b', 'b');
    f.project('D:\\mono\\packages\\a', 'a');
    f.project('D:\\mono\\packages-other', 'other');
    f.put('D:\\mono\\packages');
    expect(await f.run(['D:\\mono\\packages'])).toEqual([
      expect.objectContaining({
        kind: 'project_content',
        owner: { path: 'D:\\mono', name: 'mono' },
        nestedProjects: ['D:\\mono\\packages\\b', 'D:\\mono\\packages\\a'],
      }),
    ]);
    expect(await f.run(['D:\\mono'])).toEqual([
      expect.objectContaining({
        kind: 'project',
        nestedProjects: [
          'D:\\mono\\packages\\b',
          'D:\\mono\\packages\\a',
          'D:\\mono\\packages-other',
        ],
      }),
    ]);
  });

  it('does not treat a sibling with a shared prefix as contained', async () => {
    const f = fixture();
    f.project('D:\\a');
    f.put('D:\\ab\\x');
    expect(await f.run(['D:\\ab\\x'])).toEqual([
      expect.objectContaining({
        valid: false,
        failureCode: 'OUTSIDE_SCANNED_PROJECT',
        kind: null,
        method: null,
        identity: null,
      }),
    ]);
  });

  it.each<[string, FileOpsKind]>([
    ['D:\\p\\node_modules', 'node_modules'],
    ['D:\\loose\\node_modules', 'orphan_node_modules'],
  ])(
    'reports nested scanned projects inside %s cleanup targets',
    async (p, kind) => {
      const f = fixture();
      f.project('D:\\p');
      if (kind === 'orphan_node_modules') f.orphan(p);
      else f.put(p);
      const child = `${p}\\nested`;
      f.project(child);
      expect(await f.run([p])).toEqual([
        expect.objectContaining({
          valid: true,
          kind,
          nestedProjects: [child],
        }),
      ]);
    },
  );

  it.each(['D:\\p\\coverage', 'D:\\p\\.next'])(
    'recycles cache %s when it holds a scanned project, never deleting it permanently',
    async (p) => {
      const f = fixture();
      f.project('D:\\p');
      f.put(p);
      const child = `${p}\\tool`;
      f.project(child);
      expect(await f.run([p])).toEqual([
        expect.objectContaining({
          valid: true,
          kind: 'project_content',
          method: 'recycle',
          nestedProjects: [child],
        }),
      ]);
    },
  );

  it('classifies a direct uppercase cache directory on Windows', async () => {
    const f = fixture();
    f.project('D:\\p');
    f.put('d:\\P\\.NEXT');
    expect(await f.run(['d:\\P\\.NEXT'])).toEqual([
      expect.objectContaining({
        valid: true,
        kind: 'build_cache',
        method: 'permanent',
        path: 'd:\\P\\.NEXT',
      }),
    ]);
  });

  it('compares Windows paths without case while preserving scan owner and target spelling', async () => {
    const f = fixture();
    f.project('D:\\proj', null);
    f.put('D:\\proj\\node_modules');
    expect(await f.run(['d:\\PROJ\\node_modules'])).toEqual([
      expect.objectContaining({
        valid: true,
        kind: 'node_modules',
        path: 'd:\\PROJ\\node_modules',
        owner: { path: 'D:\\proj', name: null },
      }),
    ]);
  });

  it('keeps POSIX owner comparisons case sensitive', async () => {
    const f = fixture('posix');
    f.project('/proj');
    f.put('/PROJ/node_modules');
    expect(await f.run(['/PROJ/node_modules'])).toEqual([
      expect.objectContaining({
        valid: false,
        failureCode: 'OUTSIDE_SCANNED_PROJECT',
      }),
    ]);
  });

  it.each<[string, EntryKind]>([
    ['D:\\p\\node_modules', 'file'],
    ['D:\\p\\coverage', 'file'],
    ['D:\\p\\src\\coverage', 'directory'],
    ['D:\\p\\dist', 'directory'],
  ])('keeps %s (%s) as recyclable project content', async (p, type) => {
    const f = fixture();
    f.project('D:\\p');
    f.put(p, stat(type));
    expect(await f.run([p])).toEqual([
      expect.objectContaining({
        valid: true,
        kind: 'project_content',
        method: 'recycle',
      }),
    ]);
  });

  it('uses the scanned nodeModules path even when exists was false', async () => {
    const f = fixture();
    const p = f.project('D:\\p');
    p.nodeModules.path = 'D:\\p\\deps';
    f.put(p.nodeModules.path);
    expect(await f.run([p.nodeModules.path])).toEqual([
      expect.objectContaining({ valid: true, kind: 'node_modules' }),
    ]);
  });

  it('gives exact project identity precedence over node_modules and orphan matches', async () => {
    const f = fixture();
    f.project('D:\\p');
    f.project('D:\\p\\node_modules', 'nested');
    f.orphan('D:\\p\\node_modules');
    expect(await f.run(['D:\\p\\node_modules'])).toEqual([
      expect.objectContaining({
        valid: true,
        kind: 'project',
        method: 'recycle',
        owner: { path: 'D:\\p\\node_modules', name: 'nested' },
      }),
    ]);
  });

  it('keeps a nested orphan kind and nearest owner without applying owner D12', async () => {
    const f = fixture();
    f.project('D:\\p');
    f.project('D:\\p\\nested', 'nested');
    f.orphan('D:\\p\\nested\\loose\\node_modules');
    f.put('D:\\p\\nested\\package.json', errno('ENOENT'));
    expect(await f.run(['D:\\p\\nested\\loose\\node_modules'])).toEqual([
      expect.objectContaining({
        valid: true,
        kind: 'orphan_node_modules',
        owner: { path: 'D:\\p\\nested', name: 'nested' },
      }),
    ]);
    expect(f.lstat).not.toHaveBeenCalledWith('D:\\p\\nested\\package.json');
  });

  it.each<EntryKind>(['file', 'directory', 'link', 'special'])(
    'rejects an orphan when its parent package.json is a %s entry',
    async (type) => {
      const f = fixture();
      f.orphan('D:\\loose\\node_modules');
      f.put('D:\\loose\\package.json', stat(type));
      expect(await f.run(['D:\\loose\\node_modules'])).toEqual([
        expect.objectContaining({
          valid: false,
          failureCode: 'NOT_ORPHAN',
          kind: null,
          method: null,
          identity: null,
        }),
      ]);
    },
  );

  it.each<[string, TargetFailureCode | null]>([
    ['ENOENT', null],
    ['ENOTDIR', null],
    ['EACCES', 'STAT_FAILED'],
  ])('handles orphan package.json lstat %s', async (code, failureCode) => {
    const f = fixture();
    f.orphan('D:\\loose\\node_modules');
    f.put('D:\\loose\\package.json', errno(code));
    expect(await f.run(['D:\\loose\\node_modules'])).toEqual([
      expect.objectContaining({
        valid: failureCode === null,
        failureCode,
      }),
    ]);
  });

  it.each<[boolean, TargetFailureCode]>([
    [false, 'PROJECT_CHANGED'],
    [true, 'NOT_ORPHAN'],
  ])(
    'rejects a scanned directory replaced with a file (orphan=%s)',
    async (isOrphan, failureCode) => {
      const f = fixture();
      const p = 'D:\\p';
      if (isOrphan) f.orphan(p);
      else f.project(p);
      f.put(p, stat('file'));
      expect(await f.run([p])).toEqual([
        expect.objectContaining({ valid: false, failureCode, identity: null }),
      ]);
    },
  );

  it.each<[IFileOpsStat | Error, TargetFailureCode]>([
    [errno('ENOENT'), 'PROJECT_CHANGED'],
    [stat('link'), 'PROJECT_CHANGED'],
    [stat('directory'), 'PROJECT_CHANGED'],
    [stat('special'), 'PROJECT_CHANGED'],
    [errno('EACCES'), 'STAT_FAILED'],
    [errno('ENOTDIR'), 'STAT_FAILED'],
  ])(
    'revalidates owner package.json for project and content: %#',
    async (entry, failureCode) => {
      const f = fixture();
      f.project('D:\\p');
      f.put('D:\\p\\src');
      f.put('D:\\p\\package.json', entry);
      for (const p of ['D:\\p', 'D:\\p\\src']) {
        expect(await f.run([p])).toEqual([
          expect.objectContaining({
            valid: false,
            failureCode,
            kind: null,
            method: null,
            identity: null,
          }),
        ]);
      }
    },
  );

  it('checks each owner only once per invocation, including a failed check', async () => {
    const f = fixture();
    f.project('D:\\p');
    const paths = ['D:\\p\\a', 'D:\\p\\b', 'D:\\p\\c'];
    paths.forEach((p) => f.put(p));
    const first = await f.run(paths);
    expect(first.map((target) => target.valid)).toEqual([true, true, true]);
    expect(
      f.lstat.mock.calls.filter(([p]) => p === 'D:\\p\\package.json'),
    ).toHaveLength(1);
    f.lstat.mockClear();
    f.put('D:\\p\\package.json', errno('ENOENT'));
    const second = await f.run(paths);
    expect(second.map((target) => target.failureCode)).toEqual([
      'PROJECT_CHANGED',
      'PROJECT_CHANGED',
      'PROJECT_CHANGED',
    ]);
    expect(
      f.lstat.mock.calls.filter(([p]) => p === 'D:\\p\\package.json'),
    ).toHaveLength(1);
  });

  it('deduplicates valid canonical paths and retains the first input position', async () => {
    const f = fixture();
    f.project('D:\\p');
    f.put('D:\\p\\a');
    f.put('D:\\p\\b');
    const paths = ['d:\\P\\a', 'D:\\p\\b', 'D:\\p\\a'];
    expect((await f.run(paths)).map((target) => target.inputPath)).toEqual(
      paths.slice(0, 2),
    );
  });

  it('deduplicates invalid inputs by exact input spelling only', async () => {
    const f = fixture();
    const paths = ['D:\\bad', 'd:\\BAD', 'D:\\bad'];
    const checks: PathCheckResult[] = paths.map(() => ({
      allowed: false,
      code: 'DENYLISTED',
      message: 'denied',
    }));
    expect(
      (await f.run(paths, checks)).map((target) => target.inputPath),
    ).toEqual(['D:\\bad', 'd:\\BAD']);
  });

  it.each([true, false])(
    'drops valid descendants regardless of ancestor input order (parentFirst=%s)',
    async (parentFirst) => {
      const f = fixture();
      f.project('D:\\p');
      f.put('D:\\p\\src');
      f.put('D:\\p\\src\\child');
      f.put('D:\\p\\src-other');
      const paths = parentFirst
        ? ['D:\\p\\src', 'D:\\p\\src\\child', 'D:\\p\\src-other']
        : ['D:\\p\\src\\child', 'D:\\p\\src', 'D:\\p\\src-other'];
      expect((await f.run(paths)).map((target) => target.path)).toEqual([
        'D:\\p\\src',
        'D:\\p\\src-other',
      ]);
    },
  );

  it('does not let invalid ancestors hide valid children or discard invalid descendants', async () => {
    const f = fixture();
    f.project('D:\\p');
    f.put('D:\\p\\a');
    f.put('D:\\p\\a\\child');
    const denied: PathCheckResult = {
      allowed: false,
      code: 'DENYLISTED',
      message: 'denied',
    };
    const paths = ['D:\\p\\a', 'D:\\p\\a\\child'];
    expect(
      (await f.run(paths, [denied, allowed(paths[1])])).map((t) => [
        t.path,
        t.valid,
      ]),
    ).toEqual([
      ['D:\\p\\a', false],
      ['D:\\p\\a\\child', true],
    ]);
    expect(
      (await f.run(paths, [allowed(paths[0]), denied])).map((t) => [
        t.path,
        t.valid,
      ]),
    ).toEqual([
      ['D:\\p\\a', true],
      ['D:\\p\\a\\child', false],
    ]);
  });

  it('returns no targets and performs no I/O for empty input', async () => {
    const f = fixture();
    expect(await f.run([])).toEqual([]);
    expect(f.lstat).not.toHaveBeenCalled();
  });

  it('rejects a check count mismatch as a programming error', async () => {
    const f = fixture();
    // A generic Error is the contract; the phase-one stub also satisfies this negative case.
    await expect(f.run(['D:\\p'], [])).rejects.toBeInstanceOf(Error);
    expect(f.lstat).not.toHaveBeenCalled();
  });
});
