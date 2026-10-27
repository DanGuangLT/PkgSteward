import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { BigIntStats, Dirent } from 'node:fs';
import * as nodeFs from 'node:fs/promises';
import {
  AppException,
  ForbiddenException,
  NotFoundException,
  ValidationException,
} from '@/common/exceptions/app.exception';
import * as pathUtil from '@/common/utils/path.util';
import type { IGuardedPath } from '@/core/path-guard/interfaces/path-guard.types';
import { PathGuardService } from '@/core/path-guard/path-guard.service';
import { DiskUsageCache } from '@/disk-usage/disk-usage-cache';
import { DiskUsageService } from '@/disk-usage/disk-usage.service';
import {
  createDiskFs,
  DISK_FS,
  DISK_WALKER,
} from '@/disk-usage/disk-usage-walker';
import type {
  DiskWalker,
  IDiskFs,
  IDiskUsageJob,
  IDiskWalkDeps,
} from '@/disk-usage/interfaces/disk-usage.types';

jest.mock('node:fs/promises', () => ({
  lstat: jest.fn(),
  realpath: jest.fn(),
  opendir: jest.fn(),
}));

// TEST fixtures only; all filesystem operations and path authorization are fake.
const root = 'D:\\TEST\\node_modules';
const now = '2026-10-27T03:00:00.000Z';
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const tick = async () => {
  for (let i = 0; i < 24; i++) await Promise.resolve();
};
const directory = (mtimeNs = 10n) =>
  ({ mtimeNs, isDirectory: () => true }) as BigIntStats;
const done = (initial: IDiskUsageJob): IDiskUsageJob => ({
  ...structuredClone(initial),
  status: 'completed',
  phase: 'measuring',
  partial: false,
  stopReason: null,
  sizeBytes: 42,
  fileCount: 1,
  children: [
    {
      path: `${initial.path}\\pkg`,
      name: 'pkg',
      kind: 'directory',
      canonicalPath: `${initial.path}\\pkg`,
      aliases: ['pkg'],
      state: 'complete',
      sizeBytes: 42,
      fileCount: 1,
      reason: null,
    },
  ],
  progress: {
    visitedDirs: 2,
    visitedEntries: 2,
    skippedCount: 0,
    skippedLinks: 0,
  },
  finishedAt: now,
  measuredAt: now,
  failureCode: null,
});

const fixture = () => {
  const matcher = jest.fn<boolean, [string]>(() => false);
  const guard = {
    assertAllowed: jest.fn((path: string): Promise<IGuardedPath> =>
      Promise.resolve({
        inputPath: path,
        resolvedPath: path,
        realPath: root,
        isSymbolicLink: false,
      }),
    ),
    createProtectedTreeMatcher: jest.fn(() => Promise.resolve(matcher)),
  };
  const fs = {
    lstat: jest.fn<Promise<BigIntStats>, [string, AbortSignal?]>(() =>
      Promise.resolve(directory()),
    ),
    realpath: jest.fn<Promise<string>, [string, AbortSignal?]>((path) =>
      Promise.resolve(path),
    ),
    entries: jest.fn<AsyncIterable<Dirent>, [string, AbortSignal]>(() => ({
      [Symbol.asyncIterator]() {
        return {
          next: () =>
            Promise.resolve<IteratorResult<Dirent>>({
              done: true,
              value: undefined,
            }),
        };
      },
    })),
  } satisfies IDiskFs;
  const walks: {
    initial: IDiskUsageJob;
    signal: AbortSignal;
    deps: IDiskWalkDeps;
    task: ReturnType<typeof deferred<IDiskUsageJob>>;
  }[] = [];
  const walker: jest.MockedFunction<DiskWalker> = jest.fn(
    (initial, signal, deps) => {
      const task = deferred<IDiskUsageJob>();
      walks.push({ initial: structuredClone(initial), signal, deps, task });
      return task.promise;
    },
  );
  const cache = new DiskUsageCache();
  const getCached = jest.spyOn(cache, 'get');
  const putCached = jest.spyOn(cache, 'put');
  const clearCached = jest.spyOn(cache, 'clear');
  const peekCached = jest.spyOn(cache, 'peekCompletedSize');
  const service = new DiskUsageService(
    guard as unknown as PathGuardService,
    walker,
    fs,
    cache,
  );
  return {
    guard,
    matcher,
    fs,
    walker,
    walks,
    cache,
    getCached,
    putCached,
    clearCached,
    peekCached,
    service,
  };
};

describe('DiskUsageService', () => {
  let errors: jest.SpyInstance;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(now));
    jest.spyOn(pathUtil, 'toPathPlatform').mockReturnValue('win32');
    errors = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('injects the walker and filesystem tokens without using real IO', async () => {
    const f = fixture();
    const module = await Test.createTestingModule({
      providers: [
        DiskUsageService,
        { provide: PathGuardService, useValue: f.guard },
        { provide: DISK_WALKER, useValue: f.walker },
        { provide: DISK_FS, useValue: f.fs },
        { provide: DiskUsageCache, useValue: f.cache },
      ],
    }).compile();
    try {
      const service = module.get(DiskUsageService);
      const start = await service.start({ path: root });
      await tick();
      expect(f.walks).toHaveLength(1);
      expect(f.walks[0].deps.fs).toBe(f.fs);
      service.cancel(start.jobId);
    } finally {
      await module.close();
    }
  });

  it('guards before any cache lookup, root stat or walk, then uses the guarded realPath', async () => {
    const f = fixture();
    const allowed = deferred<IGuardedPath>();
    f.guard.assertAllowed.mockReturnValueOnce(allowed.promise);
    const started = f.service.start({ path: 'D:\\TEST\\alias' });
    // Keep an early rejection observed even if an ordering assertion fails first.
    // Awaiting the original promise below still reports that rejection.
    void started.catch(() => undefined);
    expect(f.guard.assertAllowed).toHaveBeenCalledWith('D:\\TEST\\alias');
    expect(f.fs.lstat).not.toHaveBeenCalled();
    expect(f.getCached).not.toHaveBeenCalled();
    expect(f.walker).not.toHaveBeenCalled();
    allowed.resolve({
      inputPath: 'D:\\TEST\\alias',
      resolvedPath: 'D:\\TEST\\alias',
      realPath: root,
      isSymbolicLink: true,
    });
    const start = await started;
    await tick();
    expect(f.fs.lstat.mock.calls[0][0]).toBe(root);
    expect(f.getCached).toHaveBeenCalledWith(root, 'directory', 10n);
    expect(f.walks[0].initial.path).toBe(root);
    expect(f.service.get(start.jobId).path).toBe(root);
  });

  it.each([new ForbiddenException(), new NotFoundException('Disk path')])(
    'preserves guard AppException and fails closed: $code',
    async (error) => {
      const f = fixture();
      f.guard.assertAllowed.mockRejectedValueOnce(error);
      await expect(f.service.start({ path: root, force: true })).rejects.toBe(
        error,
      );
      expect(f.fs.lstat).not.toHaveBeenCalled();
      expect(f.getCached).not.toHaveBeenCalled();
      expect(f.clearCached).not.toHaveBeenCalled();
      expect(f.guard.createProtectedTreeMatcher).not.toHaveBeenCalled();
      expect(f.walker).not.toHaveBeenCalled();
    },
  );

  it('validates the lexical packages basename after guarding but before IO', async () => {
    const f = fixture();
    await expect(
      f.service.start({ path: 'D:\\TEST\\alias', view: 'packages' }),
    ).rejects.toBeInstanceOf(ValidationException);
    expect(f.guard.assertAllowed).toHaveBeenCalledWith('D:\\TEST\\alias');
    expect(f.fs.lstat).not.toHaveBeenCalled();
    expect(f.getCached).not.toHaveBeenCalled();
    expect(f.walker).not.toHaveBeenCalled();
  });

  it('accepts a case-insensitive Windows node_modules lexical basename with a trailing separator', async () => {
    const f = fixture();
    const input = 'd:/TEST/NODE_MODULES/';
    const start = await f.service.start({ path: input, view: 'packages' });
    await tick();
    expect(f.guard.assertAllowed).toHaveBeenCalledWith(input);
    expect(f.service.get(start.jobId).view).toBe('packages');
    expect(f.walks[0].initial.path).toBe(root);
  });

  it('accepts a lexical node_modules alias whose canonical basename differs', async () => {
    const f = fixture();
    f.guard.assertAllowed.mockResolvedValueOnce({
      inputPath: root,
      resolvedPath: root,
      realPath: 'D:\\TEST\\store',
      isSymbolicLink: true,
    });
    const start = await f.service.start({ path: root, view: 'packages' });
    await tick();
    expect(f.service.get(start.jobId).path).toBe('D:\\TEST\\store');
    expect(f.walks[0].initial.view).toBe('packages');
  });

  it('rejects a guarded root that is not a directory before cache or walk', async () => {
    const f = fixture();
    f.fs.lstat.mockResolvedValueOnce({
      ...directory(),
      isDirectory: () => false,
    });
    await expect(f.service.start({ path: root })).rejects.toBeInstanceOf(
      ValidationException,
    );
    expect(f.getCached).not.toHaveBeenCalled();
    expect(f.walker).not.toHaveBeenCalled();
  });

  it('wraps a raw root stat failure in an AppException before exposing it', async () => {
    const f = fixture();
    f.fs.lstat.mockRejectedValueOnce(
      Object.assign(new Error('private fs detail'), { code: 'ENOENT' }),
    );
    await expect(f.service.start({ path: root })).rejects.toBeInstanceOf(
      AppException,
    );
    expect(f.getCached).not.toHaveBeenCalled();
    expect(f.walker).not.toHaveBeenCalled();
  });

  it('returns a new UUID and a detached initial snapshot without awaiting the walker', async () => {
    const f = fixture();
    const start = await f.service.start({ path: root });
    await tick();
    expect(start.status).toBe('running');
    expect(start.jobId).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
    );
    expect(f.service.get(start.jobId)).toMatchObject({
      ...start,
      path: root,
      view: 'directory',
      metric: 'unique-apparent',
      phase: 'listing',
      partial: true,
      stopReason: null,
      sizeBytes: null,
      fileCount: null,
      children: [],
      startedAt: now,
      measuredAt: null,
      cacheHit: false,
      failureCode: null,
    });
    expect(f.walks[0].signal.aborted).toBe(false);
  });

  it('coalesces concurrent starts by canonical path and view only after guarding each request', async () => {
    const f = fixture();
    const [first, second] = await Promise.all([
      f.service.start({ path: root }),
      f.service.start({ path: 'D:\\TEST\\alias' }),
    ]);
    await tick();
    expect(second).toEqual(first);
    expect(f.guard.assertAllowed).toHaveBeenCalledTimes(2);
    expect(f.fs.lstat).toHaveBeenCalledTimes(2);
    expect(f.walker).toHaveBeenCalledTimes(1);
  });

  it('compares running canonical paths case-insensitively on Windows, including force requests', async () => {
    const f = fixture();
    const first = await f.service.start({ path: root });
    f.guard.assertAllowed.mockResolvedValueOnce({
      inputPath: root,
      resolvedPath: root,
      realPath: 'd:/test/NODE_MODULES/',
      isSymbolicLink: false,
    });
    expect(await f.service.start({ path: root, force: true })).toEqual(first);
    await tick();
    expect(f.walker).toHaveBeenCalledTimes(1);
    expect(f.clearCached).not.toHaveBeenCalled();
  });

  it.each(['path', 'view'] as const)(
    'returns 409 with the running jobId and canonical path for a different %s',
    async (difference) => {
      const f = fixture();
      const first = await f.service.start({ path: root });
      if (difference === 'path') {
        f.guard.assertAllowed.mockResolvedValueOnce({
          inputPath: 'D:\\TEST\\other',
          resolvedPath: 'D:\\TEST\\other',
          realPath: 'D:\\TEST\\other',
          isSymbolicLink: false,
        });
      }
      await expect(
        f.service.start({
          path: difference === 'path' ? 'D:\\TEST\\other' : root,
          view: difference === 'view' ? 'packages' : 'directory',
          force: true,
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'CONFLICT',
        message: 'A disk usage measurement is already running',
        details: { jobId: first.jobId, path: root },
      });
      expect(f.clearCached).not.toHaveBeenCalled();
      expect(f.service.get(first.jobId).status).toBe('running');
    },
  );

  it('does not bypass authorization when an identical job is already running', async () => {
    const f = fixture();
    const first = await f.service.start({ path: root });
    const error = new ForbiddenException();
    f.guard.assertAllowed.mockRejectedValueOnce(error);
    await expect(f.service.start({ path: root })).rejects.toBe(error);
    expect(f.service.get(first.jobId).status).toBe('running');
  });

  it('creates one protected-tree matcher per job and passes it to the walker', async () => {
    const f = fixture();
    const first = await f.service.start({ path: root });
    await tick();
    expect(f.guard.createProtectedTreeMatcher).toHaveBeenCalledTimes(1);
    expect(f.walks[0].deps.isProtected).toBe(f.matcher);
    expect(f.walks[0].deps.platform).toBe('win32');
    expect(f.walks[0].deps.fs).toBe(f.fs);
    f.service.cancel(first.jobId);
    await f.service.start({ path: root });
    await tick();
    expect(f.guard.createProtectedTreeMatcher).toHaveBeenCalledTimes(2);
  });

  it('fails closed and logs when matcher creation fails in the background', async () => {
    const f = fixture();
    f.guard.createProtectedTreeMatcher.mockRejectedValueOnce(
      new Error('private matcher detail'),
    );
    const start = await f.service.start({ path: root });
    await tick();
    expect(f.service.get(start.jobId)).toMatchObject({
      status: 'failed',
      partial: true,
      failureCode: 'INTERNAL_SERVER_ERROR',
      finishedAt: now,
    });
    expect(f.walker).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalled();
    expect(JSON.stringify(f.service.get(start.jobId))).not.toContain('private');
  });

  it('applies snapshots as deep copies and returns detached copies to callers', async () => {
    const f = fixture();
    const start = await f.service.start({ path: root });
    await tick();
    const update = { ...done(f.walks[0].initial), status: 'running' as const };
    f.walks[0].deps.onSnapshot(update);
    update.children[0].aliases.push('external mutation');
    update.progress.visitedDirs = 999;
    const read = f.service.get(start.jobId);
    expect(read.children[0].aliases).toEqual(['pkg']);
    expect(read.progress.visitedDirs).toBe(2);
    read.children[0].aliases.push('caller mutation');
    read.progress.visitedDirs = 999;
    expect(f.service.get(start.jobId).children[0].aliases).toEqual(['pkg']);
    expect(f.service.get(start.jobId).progress.visitedDirs).toBe(2);
  });

  it('ignores a snapshot with a different jobId even from the active callback', async () => {
    const f = fixture();
    const start = await f.service.start({ path: root });
    await tick();
    f.walks[0].deps.onSnapshot({
      ...done(f.walks[0].initial),
      jobId: '00000000-0000-4000-8000-000000000099',
      status: 'running',
    });
    expect(f.service.get(start.jobId).sizeBytes).toBeNull();
  });

  it('caches a complete result only after root mtime is checked again', async () => {
    const f = fixture();
    const start = await f.service.start({ path: root });
    await tick();
    const restat = deferred<BigIntStats>();
    f.fs.lstat.mockReturnValueOnce(restat.promise);
    f.walks[0].task.resolve(done(f.walks[0].initial));
    await tick();
    expect(f.putCached).not.toHaveBeenCalled();
    restat.resolve(directory());
    await tick();
    expect(f.service.get(start.jobId)).toMatchObject({
      status: 'completed',
      partial: false,
      sizeBytes: 42,
      measuredAt: now,
      cacheHit: false,
    });
    expect(f.putCached).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: start.jobId, sizeBytes: 42 }),
      10n,
    );
    expect(f.fs.lstat).toHaveBeenCalledTimes(2);
    expect(f.service.peekCompletedSize(root)).toEqual({
      sizeBytes: 42,
      measuredAt: now,
    });
  });

  it('marks a completed walk partial and does not cache when root mtime changes', async () => {
    const f = fixture();
    const start = await f.service.start({ path: root });
    await tick();
    f.fs.lstat.mockResolvedValueOnce(directory(11n));
    f.walks[0].task.resolve(done(f.walks[0].initial));
    await tick();
    expect(f.service.get(start.jobId)).toMatchObject({
      status: 'completed',
      partial: true,
      sizeBytes: 42,
    });
    expect(f.putCached).not.toHaveBeenCalled();
    expect(f.service.peekCompletedSize(root)).toBeNull();
  });

  it('handles a rejected final root stat as a background failure without caching', async () => {
    const f = fixture();
    const start = await f.service.start({ path: root });
    await tick();
    f.fs.lstat.mockRejectedValueOnce(new Error('private final stat failure'));
    f.walks[0].task.resolve(done(f.walks[0].initial));
    await tick();
    expect(f.service.get(start.jobId)).toMatchObject({
      status: 'failed',
      partial: true,
      failureCode: 'INTERNAL_SERVER_ERROR',
    });
    expect(f.putCached).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalled();
    expect(JSON.stringify(f.service.get(start.jobId))).not.toContain('private');
  });

  it('completes and caches when the walker publishes a terminal snapshot before resolving', async () => {
    const f = fixture();
    const start = await f.service.start({ path: root });
    await tick();
    const result = done(f.walks[0].initial);
    // This is the production walker's finish protocol, not just a promise result.
    f.walks[0].deps.onSnapshot(result);
    f.walks[0].task.resolve(result);
    await tick();
    expect(f.service.get(start.jobId)).toMatchObject({
      status: 'completed',
      partial: false,
      sizeBytes: 42,
    });
    expect(f.fs.lstat).toHaveBeenCalledTimes(2);
    expect(f.service.peekCompletedSize(root)).toEqual({
      sizeBytes: 42,
      measuredAt: now,
    });
  });

  it('does not cache partial or stopped walker results', async () => {
    const f = fixture();
    const start = await f.service.start({ path: root });
    await tick();
    f.walks[0].task.resolve({
      ...done(f.walks[0].initial),
      partial: true,
      stopReason: 'row_limit',
    });
    await tick();
    expect(f.service.get(start.jobId).stopReason).toBe('row_limit');
    expect(f.putCached).not.toHaveBeenCalled();
    expect(f.service.peekCompletedSize(root)).toBeNull();
  });

  it('creates a new terminal job on every cache hit while preserving original measuredAt', async () => {
    const f = fixture();
    const first = await f.service.start({ path: root });
    await tick();
    f.walks[0].task.resolve(done(f.walks[0].initial));
    await tick();
    jest.advanceTimersByTime(7 * 24 * 60 * 60 * 1000);
    const cached = await f.service.start({ path: root });
    expect(cached.status).toBe('completed');
    expect(cached.jobId).not.toBe(first.jobId);
    expect(f.service.get(cached.jobId)).toMatchObject({
      status: 'completed',
      cacheHit: true,
      sizeBytes: 42,
      measuredAt: now,
      startedAt: '2026-11-03T03:00:00.000Z',
    });
    const again = await f.service.start({ path: root });
    expect(again.jobId).not.toBe(cached.jobId);
    expect(f.walker).toHaveBeenCalledTimes(1);
    expect(f.guard.assertAllowed).toHaveBeenCalledTimes(3);
    expect(() => f.service.get(first.jobId)).toThrow(NotFoundException);
  });

  it('remeasures when the root mtime no longer matches the cached job', async () => {
    const f = fixture();
    await f.service.start({ path: root });
    await tick();
    f.walks[0].task.resolve(done(f.walks[0].initial));
    await tick();
    f.fs.lstat.mockResolvedValueOnce(directory(11n));
    const next = await f.service.start({ path: root });
    await tick();
    expect(next.status).toBe('running');
    expect(f.walker).toHaveBeenCalledTimes(2);
    expect(f.service.peekCompletedSize(root)).toBeNull();
  });

  it('clears all RAM summaries and remeasures on force without using a cache hit', async () => {
    const f = fixture();
    await f.service.start({ path: root });
    await tick();
    const cached = done(f.walks[0].initial);
    f.walks[0].task.resolve(cached);
    await tick();
    f.cache.put({ ...cached, path: 'D:\\TEST' }, 10n);
    f.cache.put({ ...cached, path: `${root}\\pkg` }, 10n);
    const cacheLookups = f.getCached.mock.calls.length;
    const forced = await f.service.start({ path: root, force: true });
    await tick();
    expect(forced.status).toBe('running');
    expect(f.clearCached).toHaveBeenCalledTimes(1);
    expect(f.getCached).toHaveBeenCalledTimes(cacheLookups);
    for (const path of ['D:\\TEST', root, `${root}\\pkg`]) {
      expect(f.service.peekCompletedSize(path)).toBeNull();
    }
    expect(f.walker).toHaveBeenCalledTimes(2);
  });

  it('delegates peek synchronously without stat, walking or authorization IO', () => {
    const f = fixture();
    f.peekCached.mockReturnValue({ sizeBytes: 0, measuredAt: now });
    expect(f.service.peekCompletedSize(root)).toEqual({
      sizeBytes: 0,
      measuredAt: now,
    });
    expect(f.peekCached).toHaveBeenCalledWith(root);
    expect(f.fs.lstat).not.toHaveBeenCalled();
    expect(f.fs.realpath).not.toHaveBeenCalled();
    expect(f.fs.entries).not.toHaveBeenCalled();
    expect(f.guard.assertAllowed).not.toHaveBeenCalled();
    expect(f.walker).not.toHaveBeenCalled();
  });

  it('does not time out a long walk and remains cancellable', async () => {
    const f = fixture();
    const start = await f.service.start({ path: root });
    await tick();
    jest.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(f.service.get(start.jobId).status).toBe('running');
    expect(f.walks[0].signal.aborted).toBe(false);
    expect(f.service.cancel(start.jobId).status).toBe('cancelled');
    expect(f.walks[0].signal.aborted).toBe(true);
  });

  it('cancels immediately despite a pending walk and keeps the last progress', async () => {
    const f = fixture();
    const start = await f.service.start({ path: root });
    await tick();
    const update = { ...done(f.walks[0].initial), status: 'running' as const };
    f.walks[0].deps.onSnapshot(update);
    const cancelled = f.service.cancel(start.jobId);
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      partial: true,
      stopReason: 'cancelled',
      sizeBytes: 42,
      progress: { visitedDirs: 2 },
      finishedAt: now,
    });
    expect(f.walks[0].signal.aborted).toBe(true);
    cancelled.children[0].aliases.push('caller mutation');
    expect(f.service.get(start.jobId).children[0].aliases).toEqual(['pkg']);
    jest.advanceTimersByTime(1000);
    expect(f.service.cancel(start.jobId).finishedAt).toBe(now);
    expect(f.putCached).not.toHaveBeenCalled();
  });

  it('marks unfinished rows partial when cancelled before the walker settles', async () => {
    const f = fixture();
    const start = await f.service.start({ path: root });
    await tick();
    const update = { ...done(f.walks[0].initial), status: 'running' as const };
    const [row] = update.children;
    update.children = [
      { ...row, state: 'measuring', sizeBytes: 10 },
      {
        ...row,
        path: `${root}\\later`,
        name: 'later',
        state: 'pending',
        sizeBytes: null,
        fileCount: null,
      },
      { ...row, path: `${root}\\done`, name: 'done', state: 'complete' },
    ];
    f.walks[0].deps.onSnapshot(update);
    expect(
      f.service.cancel(start.jobId).children.map((child) => child.state),
    ).toEqual(['partial', 'partial', 'complete']);
  });

  it('does not log a late rejection from a cancelled job as a failure', async () => {
    const f = fixture();
    const start = await f.service.start({ path: root });
    await tick();
    f.service.cancel(start.jobId);
    f.walks[0].task.reject(new Error('cancelled IO settled late'));
    await tick();
    expect(errors).not.toHaveBeenCalled();
    expect(f.service.get(start.jobId).status).toBe('cancelled');
  });

  it('does not start a walker if cancelled while matcher creation is pending', async () => {
    const f = fixture();
    const match = deferred<typeof f.matcher>();
    f.guard.createProtectedTreeMatcher.mockReturnValueOnce(match.promise);
    const start = await f.service.start({ path: root });
    f.service.cancel(start.jobId);
    match.resolve(f.matcher);
    await tick();
    expect(f.walker).not.toHaveBeenCalled();
    expect(f.service.get(start.jobId).status).toBe('cancelled');
  });

  it('keeps old IO permits after cancellation so the next job cannot exceed eight metadata operations', async () => {
    const f = fixture();
    const rawStat = jest.mocked(nodeFs.lstat);
    rawStat.mockResolvedValue(directory());
    const gate = deferred<BigIntStats>();
    const pendingWalk = deferred<IDiskUsageJob>();
    const adapter = createDiskFs();
    let oldIO: Promise<BigIntStats>[] = [];
    let calls = 0;
    const walker: DiskWalker = (_initial, signal, deps) => {
      if (calls++ === 0) {
        rawStat.mockImplementation(() => gate.promise);
        oldIO = Array.from({ length: 8 }, (_, i) =>
          deps.fs.lstat(`${root}\\file-${i}`, signal),
        );
        for (const operation of oldIO) void operation.catch(() => undefined);
      }
      return pendingWalk.promise;
    };
    const service = new DiskUsageService(
      f.guard as unknown as PathGuardService,
      walker,
      adapter,
      f.cache,
    );
    let next: ReturnType<DiskUsageService['start']> | undefined;
    try {
      const first = await service.start({ path: root });
      await tick();
      expect(rawStat).toHaveBeenCalledTimes(9); // Root + eight blocked calls.
      service.cancel(first.jobId);
      next = service.start({ path: root });
      void next.catch(() => undefined);
      await tick();
      expect(rawStat).toHaveBeenCalledTimes(9);
      expect(calls).toBe(1);
      rawStat.mockResolvedValue(directory());
      gate.resolve(directory());
      const started = await next;
      await tick();
      expect(started.status).toBe('running');
      expect(calls).toBe(2);
      service.cancel(started.jobId);
    } finally {
      rawStat.mockResolvedValue(directory());
      gate.resolve(directory());
      await Promise.allSettled(oldIO);
      if (next) await next.catch(() => undefined);
      rawStat.mockReset();
    }
  });

  it('keeps a completed job unchanged when cancel is repeated', async () => {
    const f = fixture();
    const start = await f.service.start({ path: root });
    await tick();
    f.walks[0].task.resolve(done(f.walks[0].initial));
    await tick();
    const terminal = f.service.get(start.jobId);
    jest.advanceTimersByTime(1000);
    expect(f.service.cancel(start.jobId)).toEqual(terminal);
    expect(f.service.cancel(start.jobId)).toEqual(terminal);
  });

  it('ignores snapshots and completion from a cancelled and replaced job', async () => {
    const f = fixture();
    const first = await f.service.start({ path: root });
    await tick();
    const old = f.walks[0];
    f.service.cancel(first.jobId);
    const next = await f.service.start({ path: root });
    await tick();
    old.deps.onSnapshot({ ...done(old.initial), status: 'running' });
    old.task.resolve(done(old.initial));
    await tick();
    expect(f.service.get(next.jobId)).toMatchObject({
      status: 'running',
      sizeBytes: null,
      children: [],
    });
    expect(f.putCached).not.toHaveBeenCalled();
    expect(() => f.service.get(first.jobId)).toThrow(NotFoundException);
  });

  it('ignores late snapshots after cancellation even without replacement', async () => {
    const f = fixture();
    const start = await f.service.start({ path: root });
    await tick();
    const terminal = f.service.cancel(start.jobId);
    f.walks[0].deps.onSnapshot(done(f.walks[0].initial));
    f.walks[0].task.resolve(done(f.walks[0].initial));
    await tick();
    expect(f.service.get(start.jobId)).toEqual(terminal);
    expect(f.putCached).not.toHaveBeenCalled();
  });

  it('does not cache or overwrite a replacement if cancellation happens during the final stat', async () => {
    const f = fixture();
    const first = await f.service.start({ path: root });
    await tick();
    const restat = deferred<BigIntStats>();
    f.fs.lstat.mockReturnValueOnce(restat.promise);
    f.walks[0].task.resolve(done(f.walks[0].initial));
    await tick();
    expect(f.putCached).not.toHaveBeenCalled();
    f.service.cancel(first.jobId);
    const next = await f.service.start({ path: root });
    await tick();
    restat.resolve(directory());
    await tick();
    expect(f.service.get(next.jobId).status).toBe('running');
    expect(f.putCached).not.toHaveBeenCalled();
  });

  it('fails and logs a rejected walker without exposing private error details', async () => {
    const f = fixture();
    const start = await f.service.start({ path: root });
    await tick();
    f.walks[0].task.reject(new Error('private walker detail'));
    await tick();
    expect(f.service.get(start.jobId)).toMatchObject({
      status: 'failed',
      partial: true,
      failureCode: 'INTERNAL_SERVER_ERROR',
      finishedAt: now,
    });
    expect(errors).toHaveBeenCalled();
    expect(f.putCached).not.toHaveBeenCalled();
    expect(JSON.stringify(f.service.get(start.jobId))).not.toContain('private');
    const failed = f.service.get(start.jobId);
    jest.advanceTimersByTime(1000);
    expect(f.service.cancel(start.jobId)).toEqual(failed);
  });

  it('handles a synchronous walker throw as a background failure', async () => {
    const f = fixture();
    f.walker.mockImplementationOnce(() => {
      throw new Error('private synchronous failure');
    });
    const start = await f.service.start({ path: root });
    await tick();
    expect(f.service.get(start.jobId).failureCode).toBe(
      'INTERNAL_SERVER_ERROR',
    );
    expect(errors).toHaveBeenCalled();
  });

  it('handles late rejected promises without changing a replacement job', async () => {
    const f = fixture();
    const first = await f.service.start({ path: root });
    await tick();
    f.service.cancel(first.jobId);
    const next = await f.service.start({ path: root });
    await tick();
    f.walks[0].task.reject(new Error('late rejection'));
    await tick();
    expect(f.service.get(next.jobId).status).toBe('running');
    expect(f.putCached).not.toHaveBeenCalled();
    // Jest reports any unhandled rejection; the deferred promise is not caught here.
  });

  it('aborts the active job on module destruction without waiting for blocked IO', async () => {
    const f = fixture();
    const start = await f.service.start({ path: root });
    await tick();
    f.service.onModuleDestroy();
    expect(f.walks[0].signal.aborted).toBe(true);
    expect(f.service.get(start.jobId).status).toBe('cancelled');
    expect(f.putCached).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for an unknown, replaced or pre-restart jobId', async () => {
    const f = fixture();
    expect(() => f.service.get('unknown')).toThrow(NotFoundException);
    expect(() => f.service.cancel('unknown')).toThrow(NotFoundException);
    const first = await f.service.start({ path: root });
    f.service.cancel(first.jobId);
    await f.service.start({ path: root });
    expect(() => f.service.get(first.jobId)).toThrow(NotFoundException);
    expect(() => f.service.cancel(first.jobId)).toThrow(NotFoundException);
    expect(() => fixture().service.get(first.jobId)).toThrow(NotFoundException);
  });
});
