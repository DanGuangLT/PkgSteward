import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Dirent } from 'node:fs';
import { toPathPlatform, pathApi } from '@/common/utils/path.util';
import { NotFoundException } from '@/common/exceptions/app.exception';
import type { PathGuardService } from '@/core/path-guard/path-guard.service';
import type { IDriveDetector } from '@/platform/interfaces/drive-detector.interface';
import { UnsupportedDriveDetector } from '@/platform/unsupported-drive-detector';
import { ScannerCache, makeScanCacheKey } from '@/scanner/scanner-cache';
import { parseScanRootPaths } from '@/config/scan-roots';
import { ScannerService } from '@/scanner/scanner.service';
import { walkScan } from '@/scanner/scan-walker';
import type {
  IScanFs,
  IScanCacheEntry,
  IScanResult,
  IWalkerDeps,
  IWalkSnapshot,
  ScanWalker,
} from '@/scanner/interfaces/scanner.types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const root = pathApi(toPathPlatform()).resolve('/scan-fixture');
const snapshot = (): IWalkSnapshot => ({
  roots: [root],
  projects: [
    {
      path: `${root}/app`,
      name: 'app',
      packageManager: null,
      hasLockfile: false,
      lastActivityAt: '2026-10-20T00:00:00.000Z',
      nodeModules: {
        exists: false,
        path: `${root}/app/node_modules`,
        sizeBytes: null,
      },
    },
  ],
  orphanNodeModules: [
    {
      path: `${root}/old/node_modules`,
      mtime: '2026-10-20T00:00:00.000Z',
      sizeBytes: null,
    },
  ],
  progress: { visitedDirs: 3, foundProjects: 1, skippedCount: 1 },
});
const tick = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

function fixture(
  options: {
    roots?: string | null;
    depth?: number;
    timeout?: number;
    detector?: IDriveDetector;
  } = {},
) {
  const config = new ConfigService({
    ...(options.roots === null
      ? {}
      : { SCAN_ROOT_PATHS: options.roots ?? root }),
    MAX_SCAN_DEPTH: options.depth ?? 0,
    SCAN_TIMEOUT_MS: options.timeout ?? 1000,
  });
  config.skipProcessEnv = true;
  const cache = new ScannerCache({
    cacheFilePath: '/unused',
    fs: {
      readFile: jest.fn(),
      writeFile: jest.fn(),
      rename: jest.fn(),
      unlink: jest.fn(),
    },
    ensureCacheDir: jest.fn(),
    warn: jest.fn(),
  });
  const load = jest.spyOn(cache, 'load').mockResolvedValue(null);
  const save = jest.spyOn(cache, 'save').mockResolvedValue();
  const flush = jest.spyOn(cache, 'flush').mockResolvedValue();
  const detector = options.detector ?? {
    listFixedDrives: jest.fn(() => Promise.resolve([root])),
  };
  const detect = jest.spyOn(detector, 'listFixedDrives');
  const matcher = jest.fn<boolean, [string]>(() => false);
  const guard = {
    isInsideProtectedTree: jest.fn(() => Promise.resolve(false)),
    createProtectedTreeMatcher: jest.fn(() => Promise.resolve(matcher)),
  };
  const walks: {
    task: ReturnType<typeof deferred<IWalkSnapshot>>;
    signal: AbortSignal;
    deps: IWalkerDeps;
  }[] = [];
  const walker: jest.MockedFunction<ScanWalker> = jest.fn(
    (_roots, _depth, signal, deps) => {
      const task = deferred<IWalkSnapshot>();
      walks.push({ task, signal, deps });
      return task.promise;
    },
  );
  const service = new ScannerService(
    config,
    guard as unknown as PathGuardService,
    detector,
    walker,
    cache,
  );
  return {
    service,
    config,
    cache,
    load,
    save,
    flush,
    detector,
    detect,
    guard,
    matcher,
    walker,
    walks,
  };
}

describe('ScannerService', () => {
  let errors: jest.SpyInstance;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-21T00:00:00.000Z'));
    errors = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('claims one slot synchronously, returns UUID v4 and starts only one walker', async () => {
    const f = fixture();
    const first = f.service.startScan();
    expect(first.status).toBe('running');
    expect(first.scanId).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
    );
    expect(f.service.startScan()).toEqual(first);
    await tick();
    expect(f.walker).toHaveBeenCalledTimes(1);
    expect(f.detect).not.toHaveBeenCalled();
    expect(f.service.getScan(first.scanId).startedAt).toBe(
      '2026-10-21T00:00:00.000Z',
    );
    expect(f.walker.mock.calls[0].slice(0, 2)).toEqual([[root], 0]);
    f.service.cancelScan(first.scanId);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('passes normalized explicit roots/depth, including missing roots, to walker and delegates guard', async () => {
    const f = fixture({ roots: `${root}/missing,${root}/nested/..`, depth: 2 });
    const scan = f.service.startScan();
    await tick();
    expect(f.walker.mock.calls[0][0]).toEqual([
      pathApi(toPathPlatform()).join(root, 'missing'),
      root,
    ]);
    expect(f.walker.mock.calls[0][1]).toBe(2);
    await f.walks[0].deps.isInsideProtectedTree(root);
    expect(f.matcher).toHaveBeenCalledWith(root);
    expect(f.guard.isInsideProtectedTree).not.toHaveBeenCalled();
    f.service.cancelScan(scan.scanId);
  });

  it('creates one protected-tree matcher per scan and reuses it for every directory', async () => {
    const f = fixture();
    const first = f.service.startScan();
    await tick();
    for (const dir of [root, `${root}/a`, `${root}/b`]) {
      expect(await f.walks[0].deps.isInsideProtectedTree(dir)).toBe(false);
    }
    expect(f.guard.createProtectedTreeMatcher).toHaveBeenCalledTimes(1);
    expect(f.matcher).toHaveBeenCalledTimes(3);
    f.service.cancelScan(first.scanId);
    await tick();
    f.service.startScan();
    await tick();
    expect(f.guard.createProtectedTreeMatcher).toHaveBeenCalledTimes(2);
  });

  it('fails the scan without walking when the matcher cannot be created', async () => {
    const f = fixture();
    f.guard.createProtectedTreeMatcher.mockRejectedValueOnce(
      new Error('private guard error'),
    );
    const scan = f.service.startScan();
    await tick();
    expect(f.service.getScan(scan.scanId)).toEqual(
      expect.objectContaining({ status: 'failed', partial: true }),
    );
    expect(JSON.stringify(f.service.getScan(scan.scanId))).not.toMatch(
      /private/i,
    );
    expect(f.walker).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('discovers default all-fixed roots once and starts timestamp/timer before discovery', async () => {
    const discovery = deferred<string[]>();
    const detector = { listFixedDrives: jest.fn(() => discovery.promise) };
    const f = fixture({ roots: null, detector });
    const scan = f.service.startScan();
    expect(f.service.startScan()).toEqual(scan);
    expect(detector.listFixedDrives).toHaveBeenCalledTimes(1);
    expect(f.walker).not.toHaveBeenCalled();
    expect(f.service.getScan(scan.scanId).startedAt).toBe(
      '2026-10-21T00:00:00.000Z',
    );
    discovery.resolve([root]);
    await tick();
    expect(f.walker.mock.calls[0][0]).toEqual([root]);
    f.service.cancelScan(scan.scanId);
  });

  it.each(['unsupported', 'rejected', 'sync throw'])(
    'turns %s discovery into failed without exposing internals',
    async (kind) => {
      const detector =
        kind === 'unsupported'
          ? new UnsupportedDriveDetector('linux')
          : {
              listFixedDrives: jest.fn(() => {
                if (kind === 'sync throw')
                  throw new Error('private drive error');
                return Promise.reject(new Error('private drive error'));
              }),
            };
      const f = fixture({ roots: '*', detector });
      const scan = f.service.startScan();
      await tick();
      expect(f.service.getScan(scan.scanId)).toEqual(
        expect.objectContaining({
          status: 'failed',
          partial: true,
          finishedAt: '2026-10-21T00:00:00.000Z',
        }),
      );
      expect(JSON.stringify(f.service.getScan(scan.scanId))).not.toMatch(
        /private|linux|error/i,
      );
      expect(errors).toHaveBeenCalled();
      expect(f.walker).not.toHaveBeenCalled();
      expect(f.save).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it('publishes progress copies and completed snapshot/cache using config key', async () => {
    const f = fixture();
    const scan = f.service.startScan();
    await tick();
    const value = snapshot();
    f.walks[0].deps.onProgress(value.progress);
    value.progress.visitedDirs++;
    expect(f.service.getScan(scan.scanId).progress.visitedDirs).toBe(3);
    const debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    f.walks[0].deps.onSkipped(root, new Error('skip'));
    expect(debug).toHaveBeenCalled();
    f.walks[0].task.resolve(value);
    await tick();
    const result = f.service.getLatest();
    expect(result).toEqual({
      scanId: scan.scanId,
      status: 'completed',
      partial: false,
      roots: value.roots,
      maxDepth: 0,
      startedAt: '2026-10-21T00:00:00.000Z',
      finishedAt: '2026-10-21T00:00:00.000Z',
      skippedCount: 1,
      projects: value.projects,
      orphanNodeModules: value.orphanNodeModules,
    });
    expect(f.service.getScan(scan.scanId).progress).toEqual(value.progress);
    expect(f.save).toHaveBeenCalledWith({
      schemaVersion: 1,
      key: makeScanCacheKey(
        parseScanRootPaths(root, toPathPlatform()),
        0,
        toPathPlatform(),
      ),
      result,
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('cancel is immediate and idempotent, ignores callbacks/resolution, preserves latest', async () => {
    const f = fixture();
    const first = f.service.startScan();
    await tick();
    f.walks[0].task.resolve(snapshot());
    await tick();
    const latest = f.service.getLatest();
    const scan = f.service.startScan();
    await tick();
    const cancelled = f.service.cancelScan(scan.scanId);
    expect(cancelled).toEqual(
      expect.objectContaining({
        status: 'cancelled',
        partial: true,
        finishedAt: '2026-10-21T00:00:00.000Z',
      }),
    );
    expect(f.service.cancelScan(scan.scanId)).toEqual(cancelled);
    expect(f.walks[1].signal.aborted).toBe(true);
    f.walks[1].deps.onProgress(snapshot().progress);
    f.walks[1].task.resolve(snapshot());
    await tick();
    expect(f.service.getScan(scan.scanId)).toEqual(cancelled);
    expect(f.service.getLatest()).toEqual(latest);
    expect(f.save).toHaveBeenCalledTimes(1);
    expect(() => f.service.getScan(first.scanId)).toThrow(NotFoundException);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('timeout captures the walker snapshot resolved on abort, then freezes it', async () => {
    const f = fixture();
    const scan = f.service.startScan();
    await tick();
    const value = snapshot();
    f.walks[0].deps.onProgress(value.progress);
    f.walks[0].signal.addEventListener(
      'abort',
      () => f.walks[0].task.resolve(value),
      { once: true },
    );
    jest.advanceTimersByTime(1000);
    expect(f.service.getScan(scan.scanId).status).toBe('timed_out');
    await tick();
    expect(f.service.getLatest()).toEqual(
      expect.objectContaining({
        status: 'timed_out',
        partial: true,
        roots: value.roots,
        projects: value.projects,
        orphanNodeModules: value.orphanNodeModules,
      }),
    );
    expect(f.service.getLatest().finishedAt).toBe('2026-10-21T00:00:01.000Z');
    const terminal = f.service.getScan(scan.scanId);
    f.walks[0].deps.onProgress({
      visitedDirs: 999,
      foundProjects: 999,
      skippedCount: 999,
    });
    value.projects.length = 0;
    expect(f.service.cancelScan(scan.scanId)).toEqual(terminal);
    expect(f.service.getLatest().projects).toHaveLength(1);
    f.walks[0].task.resolve(snapshot());
    jest.advanceTimersByTime(1000);
    await tick();
    expect(f.save).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps visitedDirs in a timed-out job when real walker metadata is blocked', async () => {
    const f = fixture();
    const reading = deferred<void>();
    const content = deferred<string>();
    const fs: IScanFs = {
      realpath: (p) => Promise.resolve(p),
      readdir: () =>
        Promise.resolve([
          {
            name: 'package.json',
            isFile: () => true,
            isSymbolicLink: () => false,
          } as Dirent,
        ]),
      lstat: (p) =>
        Promise.resolve({
          mtimeMs: 1000,
          isDirectory: () => p === root,
          isFile: () => p !== root,
          isSymbolicLink: () => false,
        }),
      readFile: () => {
        reading.resolve();
        return content.promise;
      },
    };
    f.walker.mockImplementation((roots, depth, signal, deps) =>
      walkScan(roots, depth, signal, { ...deps, fs }),
    );
    const scan = f.service.startScan();
    await reading.promise;
    jest.advanceTimersByTime(1000);
    await tick();
    const terminal = f.service.getScan(scan.scanId);
    content.resolve('{"name":"late"}');
    await tick();

    expect(terminal.status).toBe('timed_out');
    expect(terminal.progress).toEqual({
      visitedDirs: 1,
      foundProjects: 0,
      skippedCount: 0,
    });
    expect(f.service.getScan(scan.scanId)).toEqual(terminal);
    expect(f.service.getLatest().projects).toEqual([]);
    expect(f.save).toHaveBeenCalledTimes(1);
  });

  it.each(['cancel', 'timeout'] as const)(
    '%s during hung discovery prevents a late walker',
    async (action) => {
      const discovery = deferred<string[]>();
      const f = fixture({
        roots: '*',
        detector: { listFixedDrives: jest.fn(() => discovery.promise) },
      });
      const scan = f.service.startScan();
      if (action === 'cancel') f.service.cancelScan(scan.scanId);
      else jest.advanceTimersByTime(1000);
      const terminal = f.service.getScan(scan.scanId);
      expect(terminal.status).toBe(
        action === 'cancel' ? 'cancelled' : 'timed_out',
      );
      discovery.resolve([root]);
      await tick();
      expect(f.walker).not.toHaveBeenCalled();
      expect(f.service.getScan(scan.scanId)).toEqual(terminal);
      expect(() => f.service.getLatest()).toThrow(NotFoundException);
      expect(f.save).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it('preserves latest and cache when timeout happens during hung discovery', async () => {
    const discovery = deferred<string[]>();
    const f = fixture({ roots: '*' });
    f.detect
      .mockResolvedValueOnce([root])
      .mockReturnValueOnce(discovery.promise);
    f.service.startScan();
    await tick();
    f.walks[0].task.resolve(snapshot());
    await tick();
    const latest = f.service.getLatest();
    f.save.mockClear();
    f.walker.mockClear();

    const scan = f.service.startScan();
    jest.advanceTimersByTime(1000);
    await tick();
    const terminal = f.service.getScan(scan.scanId);
    expect(terminal.status).toBe('timed_out');
    expect(terminal.partial).toBe(true);
    expect(f.service.getLatest()).toEqual(latest);
    expect(f.save).not.toHaveBeenCalled();
    expect(f.walker).not.toHaveBeenCalled();

    discovery.resolve([root]);
    await tick();
    expect(f.service.getScan(scan.scanId)).toEqual(terminal);
    expect(f.service.getLatest()).toEqual(latest);
    expect(f.save).not.toHaveBeenCalled();
    expect(f.walker).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('handles discovery rejection after cancel without changing terminal state', async () => {
    const discovery = deferred<string[]>();
    const f = fixture({
      roots: '*',
      detector: { listFixedDrives: () => discovery.promise },
    });
    const scan = f.service.startScan();
    const cancelled = f.service.cancelScan(scan.scanId);
    discovery.reject(new Error('late'));
    await tick();
    expect(f.service.getScan(scan.scanId)).toEqual(cancelled);
    expect(f.save).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores old job %s/progress after replacement',
    async (settle) => {
      const f = fixture();
      const old = f.service.startScan();
      await tick();
      f.service.cancelScan(old.scanId);
      const current = f.service.startScan();
      await tick();
      f.walks[0].deps.onProgress(snapshot().progress);
      if (settle === 'resolve') f.walks[0].task.resolve(snapshot());
      else f.walks[0].task.reject(new Error('late'));
      await tick();
      expect(f.service.getScan(current.scanId)).toEqual(
        expect.objectContaining({
          status: 'running',
          progress: { visitedDirs: 0, foundProjects: 0, skippedCount: 0 },
        }),
      );
      expect(() => f.service.getScan(old.scanId)).toThrow(NotFoundException);
      expect(() => f.service.getLatest()).toThrow(NotFoundException);
      f.service.cancelScan(current.scanId);
    },
  );

  it('waits for a real walker snapshot before publishing a timed-out result', async () => {
    const f = fixture();
    const scan = f.service.startScan();
    await tick();
    jest.advanceTimersByTime(1000);
    await tick();
    expect(() => f.service.getLatest()).toThrow(NotFoundException);
    expect(f.save).not.toHaveBeenCalled();
    const value = snapshot();
    f.walks[0].task.resolve(value);
    await tick();
    expect(f.service.getLatest()).toEqual(
      expect.objectContaining({
        status: 'timed_out',
        roots: value.roots,
        projects: value.projects,
        orphanNodeModules: value.orphanNodeModules,
      }),
    );
    expect(f.service.getScan(scan.scanId).status).toBe('timed_out');
    expect(f.save).toHaveBeenCalledTimes(1);
  });

  it.each(['resolve first', 'cancel first', 'timeout first'] as const)(
    'settles terminal race once: %s',
    async (order) => {
      const f = fixture();
      const scan = f.service.startScan();
      await tick();
      if (order === 'resolve first') {
        f.walks[0].task.resolve(snapshot());
        await tick();
      } else if (order === 'cancel first') f.service.cancelScan(scan.scanId);
      else jest.advanceTimersByTime(1000);
      f.walks[0].task.resolve(snapshot());
      f.service.cancelScan(scan.scanId);
      jest.advanceTimersByTime(1000);
      await tick();
      expect(f.service.getScan(scan.scanId).status).toBe(
        order === 'resolve first'
          ? 'completed'
          : order === 'cancel first'
            ? 'cancelled'
            : 'timed_out',
      );
      expect(f.save).toHaveBeenCalledTimes(order === 'cancel first' ? 0 : 1);
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it('does not let callers or walker result objects mutate RAM or queued cache data', async () => {
    const f = fixture();
    const scan = f.service.startScan();
    await tick();
    const polled = f.service.getScan(scan.scanId);
    polled.progress.visitedDirs = 99;
    polled.status = 'failed';
    const value = snapshot();
    f.walks[0].task.resolve(value);
    await tick();
    const latest = f.service.getLatest();
    latest.projects[0].nodeModules.exists = true;
    latest.roots.length = 0;
    value.projects[0].name = 'changed';
    expect(f.service.getLatest().projects[0].name).toBe('app');
    expect(f.service.getLatest().projects[0].nodeModules.exists).toBe(false);
    expect(f.service.getLatest().roots).toEqual([root]);
    expect(f.service.getScan(scan.scanId).progress.visitedDirs).toBe(3);
  });

  it('failed walker keeps latest, logs error and clears timer', async () => {
    const f = fixture();
    f.service.startScan();
    await tick();
    f.walks[0].task.resolve(snapshot());
    await tick();
    const latest = f.service.getLatest();
    const scan = f.service.startScan();
    await tick();
    f.walks[1].task.reject(new Error('guard failed'));
    await tick();
    expect(f.service.getScan(scan.scanId).status).toBe('failed');
    expect(f.service.getLatest()).toEqual(latest);
    expect(f.save).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps completed RAM result even if injected cache save rejects', async () => {
    const f = fixture();
    f.save.mockRejectedValueOnce(new Error('cache'));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const scan = f.service.startScan();
    await tick();
    f.walks[0].task.resolve(snapshot());
    await tick();
    expect(f.service.getScan(scan.scanId).status).toBe('completed');
    expect(f.service.getLatest().projects).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('loads only latest on restart without discovery, leaving old job IDs unknown', async () => {
    const f = fixture({ roots: '*' });
    const { progress, ...data } = snapshot();
    const result: IScanResult = {
      ...data,
      scanId: '10000000-0000-4000-8000-000000000001',
      status: 'completed',
      partial: false,
      maxDepth: 0,
      startedAt: '2026-10-21T00:00:00.000Z',
      finishedAt: '2026-10-21T00:00:01.000Z',
      skippedCount: progress.skippedCount,
    };
    const cached: IScanCacheEntry = {
      schemaVersion: 1,
      key: { roots: '*', maxDepth: 0 },
      result,
    };
    f.load.mockResolvedValue(cached);
    await f.service.onModuleInit();
    expect(f.service.getLatest()).toEqual(result);
    expect(() => f.service.getScan(result.scanId)).toThrow(NotFoundException);
    expect(f.detect).not.toHaveBeenCalled();
    expect(f.walker).not.toHaveBeenCalled();
    expect(f.load).toHaveBeenCalledWith(cached.key);
    const scan = f.service.startScan();
    await tick();
    expect(f.service.getLatest()).toEqual(result);
    f.service.cancelScan(scan.scanId);
  });

  it('keeps latest unavailable on an empty startup and uses config depth to load', async () => {
    const f = fixture({ depth: 2 });
    await f.service.onModuleInit();
    expect(() => f.service.getLatest()).toThrow(NotFoundException);
    expect(() => f.service.getScan('unknown')).toThrow(NotFoundException);
    expect(() => f.service.cancelScan('unknown')).toThrow(NotFoundException);
    expect(f.load).toHaveBeenCalledWith(
      makeScanCacheKey(
        parseScanRootPaths(root, toPathPlatform()),
        2,
        toPathPlatform(),
      ),
    );
  });

  it('destroy aborts running, clears timer, waits for cache flush', async () => {
    const f = fixture();
    const scan = f.service.startScan();
    await tick();
    const gate = deferred<void>();
    f.flush.mockReturnValue(gate.promise);
    let destroyed = false;
    const destroying = f.service.onModuleDestroy().then(() => {
      destroyed = true;
    });
    await tick();
    expect(f.walks[0].signal.aborted).toBe(true);
    expect(f.service.getScan(scan.scanId).status).toBe('cancelled');
    expect(jest.getTimerCount()).toBe(0);
    expect(destroyed).toBe(false);
    gate.resolve();
    await destroying;
    expect(destroyed).toBe(true);
    expect(f.flush).toHaveBeenCalledTimes(1);
  });
});
