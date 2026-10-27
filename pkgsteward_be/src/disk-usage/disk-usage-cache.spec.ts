import * as fs from 'node:fs/promises';
import * as pathUtil from '@/common/utils/path.util';
import { DiskUsageCache } from '@/disk-usage/disk-usage-cache';
import type {
  DiskStatus,
  DiskStop,
  DiskView,
  IDiskUsageJob,
} from '@/disk-usage/interfaces/disk-usage.types';

jest.mock('node:fs/promises', () => ({
  lstat: jest.fn(),
  stat: jest.fn(),
  realpath: jest.fn(),
  opendir: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
}));

// TEST fixtures only; these paths are never read from the filesystem.
const root = 'D:\\TEST\\node_modules';
const measuredAt = '2026-10-27T03:00:00.000Z';
const completed = (
  path = root,
  view: DiskView = 'directory',
): IDiskUsageJob => ({
  jobId: '00000000-0000-4000-8000-000000000001',
  status: 'completed',
  path,
  view,
  metric: 'unique-apparent',
  phase: 'measuring',
  partial: false,
  stopReason: null,
  sizeBytes: 42,
  fileCount: 1,
  children: [
    {
      path: `${path}\\pkg`,
      name: 'pkg',
      kind: 'directory',
      canonicalPath: `${path}\\pkg`,
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
  startedAt: '2026-10-27T02:59:00.000Z',
  finishedAt: measuredAt,
  measuredAt,
  cacheHit: false,
  failureCode: null,
});

describe('DiskUsageCache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(pathUtil, 'toPathPlatform').mockReturnValue('win32');
    jest.useFakeTimers();
    jest.setSystemTime(new Date(measuredAt));
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('misses an unknown canonical path or view', () => {
    const cache = new DiskUsageCache();
    cache.put(completed(), 10n);
    expect(cache.get('D:\\TEST\\other', 'directory', 10n)).toBeNull();
    expect(cache.get(root, 'packages', 10n)).toBeNull();
    expect(cache.peekCompletedSize('D:\\TEST\\other')).toBeNull();
  });

  it('compares canonical paths using Windows case, separator and trailing-slash normalization', () => {
    const cache = new DiskUsageCache();
    cache.put(completed(), 10n);
    expect(cache.get('d:/test/NODE_MODULES/', 'directory', 10n)).toEqual(
      completed(),
    );
  });

  it('keeps separate entries for directory and packages views', () => {
    const cache = new DiskUsageCache();
    cache.put(completed(), 10n);
    const packages = completed(root, 'packages');
    packages.children[0].kind = 'package';
    cache.put(packages, 10n);
    expect(cache.get(root, 'directory', 10n)?.children[0].kind).toBe(
      'directory',
    );
    expect(cache.get(root, 'packages', 10n)?.children[0].kind).toBe('package');
  });

  it('drops a mismatched root mtime entry permanently without rounding bigint', () => {
    const cache = new DiskUsageCache();
    cache.put(completed(), 9007199254740992n);
    expect(cache.get(root, 'directory', 9007199254740993n)).toBeNull();
    expect(cache.get(root, 'directory', 9007199254740992n)).toBeNull();
    expect(cache.peekCompletedSize(root)).toBeNull();
  });

  it('has no TTL and preserves the original measuredAt after a long delay', () => {
    const cache = new DiskUsageCache();
    cache.put(completed(), 10n);
    jest.advanceTimersByTime(30 * 24 * 60 * 60 * 1000);
    expect(cache.get(root, 'directory', 10n)?.measuredAt).toBe(measuredAt);
    expect(cache.peekCompletedSize(root)).toEqual({
      sizeBytes: 42,
      measuredAt,
    });
  });

  it.each<DiskStatus>(['running', 'cancelled', 'timed_out', 'failed'])(
    'never caches a %s job',
    (status) => {
      const cache = new DiskUsageCache();
      cache.put({ ...completed(), status }, 10n);
      expect(cache.get(root, 'directory', 10n)).toBeNull();
      expect(cache.peekCompletedSize(root)).toBeNull();
    },
  );

  it('never caches a partial completed job', () => {
    const cache = new DiskUsageCache();
    cache.put({ ...completed(), partial: true }, 10n);
    expect(cache.get(root, 'directory', 10n)).toBeNull();
    expect(cache.peekCompletedSize(root)).toBeNull();
  });

  it.each<Exclude<DiskStop, null>>([
    'cancelled',
    'row_limit',
    'identity_limit',
    'numeric_limit',
  ])('never caches a stopped job even with partial false: %s', (stopReason) => {
    const cache = new DiskUsageCache();
    cache.put({ ...completed(), stopReason }, 10n);
    expect(cache.get(root, 'directory', 10n)).toBeNull();
    expect(cache.peekCompletedSize(root)).toBeNull();
  });

  it('owns a deep copy independent of the job passed to put', () => {
    const cache = new DiskUsageCache();
    const job = completed();
    cache.put(job, 10n);
    job.children[0].aliases.push('changed');
    job.children[0].sizeBytes = 999;
    job.progress.visitedDirs = 999;
    job.sizeBytes = 999;
    expect(cache.get(root, 'directory', 10n)).toEqual(completed());
  });

  it('returns detached copies from get and peek', () => {
    const cache = new DiskUsageCache();
    cache.put(completed(), 10n);
    const job = cache.get(root, 'directory', 10n)!;
    job.children[0].aliases.push('changed');
    job.progress.visitedDirs = 999;
    job.sizeBytes = 999;
    cache.peekCompletedSize(root)!.sizeBytes = 999;
    expect(cache.get(root, 'directory', 10n)).toEqual(completed());
    expect(cache.peekCompletedSize(root)).toEqual({
      sizeBytes: 42,
      measuredAt,
    });
  });

  it('evicts the least recently used entry on insertion of the 65th entry', () => {
    const cache = new DiskUsageCache();
    for (let i = 0; i < 64; i++) cache.put(completed(`${root}\\${i}`), 10n);
    expect(cache.get(`${root}\\0`, 'directory', 10n)).not.toBeNull();
    cache.put(completed(`${root}\\64`), 10n);
    expect(cache.get(`${root}\\1`, 'directory', 10n)).toBeNull();
    for (const i of [0, 2, 63, 64]) {
      expect(cache.get(`${root}\\${i}`, 'directory', 10n)).not.toBeNull();
    }
  });

  it('replaces an existing key without consuming another LRU slot', () => {
    const cache = new DiskUsageCache();
    for (let i = 0; i < 64; i++) cache.put(completed(`${root}\\${i}`), 10n);
    cache.put({ ...completed(`${root}\\0`), sizeBytes: 84 }, 11n);
    expect(cache.get(`${root}\\1`, 'directory', 10n)).not.toBeNull();
    expect(cache.get(`${root}\\0`, 'directory', 11n)?.sizeBytes).toBe(84);
  });

  it('peeks size and measuredAt from either view without filesystem IO', () => {
    const cache = new DiskUsageCache();
    cache.put(completed(root, 'packages'), 10n);
    expect(cache.peekCompletedSize('d:/TEST/node_modules/')).toEqual({
      sizeBytes: 42,
      measuredAt,
    });
    for (const operation of [
      fs.lstat,
      fs.stat,
      fs.realpath,
      fs.opendir,
      fs.readFile,
      fs.writeFile,
    ]) {
      expect(operation).not.toHaveBeenCalled();
    }
  });

  it('does not touch LRU order when peeking', () => {
    const cache = new DiskUsageCache();
    for (let i = 0; i < 64; i++) cache.put(completed(`${root}\\${i}`), 10n);
    expect(cache.peekCompletedSize(`${root}\\0`)).not.toBeNull();
    cache.put(completed(`${root}\\64`), 10n);
    expect(cache.peekCompletedSize(`${root}\\0`)).toBeNull();
    expect(cache.peekCompletedSize(`${root}\\1`)).not.toBeNull();
  });

  it('peeks an exact zero instead of treating it as a miss', () => {
    const cache = new DiskUsageCache();
    cache.put({ ...completed(), sizeBytes: 0, fileCount: 0 }, 10n);
    expect(cache.peekCompletedSize(root)).toEqual({ sizeBytes: 0, measuredAt });
  });

  it('clears every path and view, including ancestor and descendant summaries', () => {
    const cache = new DiskUsageCache();
    for (const path of ['D:\\TEST', root, `${root}\\pkg`]) {
      for (const view of ['directory', 'packages'] as const) {
        cache.put(completed(path, view), 10n);
      }
    }
    cache.clear();
    for (const path of ['D:\\TEST', root, `${root}\\pkg`]) {
      expect(cache.peekCompletedSize(path)).toBeNull();
      expect(cache.get(path, 'directory', 10n)).toBeNull();
      expect(cache.get(path, 'packages', 10n)).toBeNull();
    }
  });

  it('starts empty in a new cache instance', () => {
    const cache = new DiskUsageCache();
    cache.put(completed(), 10n);
    expect(new DiskUsageCache().peekCompletedSize(root)).toBeNull();
  });
});
