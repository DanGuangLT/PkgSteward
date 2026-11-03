import * as path from 'node:path';
import { parseScanRootPaths } from '@/config/scan-roots';
import { makeScanCacheKey, ScannerCache } from '@/scanner/scanner-cache';
import type {
  IScanCacheEntry,
  IScanCacheFs,
} from '@/scanner/interfaces/scanner.types';

const entry = (): IScanCacheEntry => ({
  schemaVersion: 1,
  key: { roots: '*', maxDepth: 0 },
  result: {
    scanId: '10000000-0000-4000-8000-000000000001',
    status: 'completed',
    partial: false,
    roots: ['C:\\work'],
    maxDepth: 0,
    startedAt: '2026-10-21T00:00:00.000Z',
    finishedAt: '2026-10-21T00:00:01.000Z',
    skippedCount: 1,
    projects: [
      {
        path: 'C:\\work\\app',
        name: 'app',
        packageManager: 'pnpm',
        hasLockfile: true,
        lastActivityAt: '2026-10-20T00:00:00.000Z',
        nodeModules: {
          exists: true,
          path: 'C:\\work\\app\\node_modules',
          sizeBytes: null,
        },
      },
    ],
    orphanNodeModules: [
      {
        path: 'C:\\work\\old\\node_modules',
        sizeBytes: null,
        mtime: '2026-10-20T00:00:00.000Z',
      },
    ],
  },
});

function fixture() {
  const files = new Map<string, string>();
  const cacheFilePath = path.resolve('/test-cache/last-scan.json');
  const fs: jest.Mocked<IScanCacheFs> = {
    readFile: jest.fn((file) => {
      if (!files.has(file))
        return Promise.reject(
          Object.assign(new Error('missing'), { code: 'ENOENT' }),
        );
      return Promise.resolve(files.get(file)!);
    }),
    writeFile: jest.fn((file, content) => {
      files.set(file, content);
      return Promise.resolve();
    }),
    rename: jest.fn((from, to) => {
      files.set(to, files.get(from)!);
      files.delete(from);
      return Promise.resolve();
    }),
    unlink: jest.fn((file) => {
      files.delete(file);
      return Promise.resolve();
    }),
  };
  const ensureCacheDir = jest.fn(() =>
    Promise.resolve(path.dirname(cacheFilePath)),
  );
  const warn = jest.fn();
  const cache = new ScannerCache({ cacheFilePath, fs, ensureCacheDir, warn });
  return { cache, files, cacheFilePath, fs, ensureCacheDir, warn };
}

describe('scan cache', () => {
  it('normalizes default sentinel, Windows slash/case/order/duplicates and depth', () => {
    const key = (value?: string, depth = 0) =>
      makeScanCacheKey(parseScanRootPaths(value, 'win32'), depth, 'win32');
    expect(key()).toEqual(key(' , '));
    expect(key('*')).toEqual({ roots: '*', maxDepth: 0 });
    expect(key('D:/B/,C:\\A,D:\\b')).toEqual(key('c:/a,d:/b'));
    expect(key('C:\\A', 1)).not.toEqual(key('C:\\A', 0));
    expect(
      makeScanCacheKey(parseScanRootPaths('/B,/b', 'posix'), 0, 'posix').roots,
    ).toEqual(['/B', '/b']);
  });

  it.each(['completed', 'timed_out'] as const)(
    'loads valid %s without mkdir or storing visitedDirs',
    async (status) => {
      const f = fixture();
      const value = entry();
      value.result.status = status;
      value.result.partial = status === 'timed_out';
      f.files.set(f.cacheFilePath, JSON.stringify(value));
      expect(await f.cache.load(value.key)).toEqual(value);
      expect(f.ensureCacheDir).not.toHaveBeenCalled();
      expect(f.warn).not.toHaveBeenCalled();
      expect(JSON.stringify(value)).not.toContain('visitedDirs');
    },
  );

  it('ignores missing file silently and warns on read failure or invalid JSON', async () => {
    const f = fixture();
    expect(await f.cache.load(entry().key)).toBeNull();
    expect(f.warn).not.toHaveBeenCalled();
    f.fs.readFile.mockRejectedValueOnce(
      Object.assign(new Error('denied'), { code: 'EACCES' }),
    );
    expect(await f.cache.load(entry().key)).toBeNull();
    f.files.set(f.cacheFilePath, '{');
    expect(await f.cache.load(entry().key)).toBeNull();
    expect(f.warn).toHaveBeenCalledTimes(2);
    expect(f.ensureCacheDir).not.toHaveBeenCalled();
  });

  const invalid: [string, (value: IScanCacheEntry) => void][] = [
    [
      'schema',
      (v) => {
        Object.assign(v, { schemaVersion: 2 });
      },
    ],
    [
      'key roots',
      (v) => {
        Object.assign(v.key, { roots: [1] });
      },
    ],
    [
      'key depth',
      (v) => {
        v.key.maxDepth = -1;
      },
    ],
    [
      'status',
      (v) => {
        Object.assign(v.result, { status: 'cancelled' });
      },
    ],
    [
      'UUID',
      (v) => {
        v.result.scanId = 'invalid';
      },
    ],
    [
      'date',
      (v) => {
        v.result.startedAt = 'yesterday';
      },
    ],
    [
      'calendar date',
      (v) => {
        v.result.finishedAt = '2026-02-30T00:00:00.000Z';
      },
    ],
    [
      'partial',
      (v) => {
        v.result.partial = true;
      },
    ],
    [
      'skipped count',
      (v) => {
        v.result.skippedCount = -1;
      },
    ],
    [
      'result roots',
      (v) => {
        Object.assign(v.result, { roots: [true] });
      },
    ],
    [
      'result depth',
      (v) => {
        v.result.maxDepth = 2;
      },
    ],
    [
      'projects',
      (v) => {
        Object.assign(v.result, { projects: {} });
      },
    ],
    [
      'project name',
      (v) => {
        Object.assign(v.result.projects[0], { name: 3 });
      },
    ],
    [
      'project manager',
      (v) => {
        Object.assign(v.result.projects[0], { packageManager: 'bun' });
      },
    ],
    [
      'project lock flag',
      (v) => {
        Object.assign(v.result.projects[0], { hasLockfile: 'true' });
      },
    ],
    [
      'project date',
      (v) => {
        v.result.projects[0].lastActivityAt = '';
      },
    ],
    [
      'node modules',
      (v) => {
        Object.assign(v.result.projects[0], { nodeModules: null });
      },
    ],
    [
      'node modules exists',
      (v) => {
        Object.assign(v.result.projects[0].nodeModules, { exists: 1 });
      },
    ],
    [
      'node modules path',
      (v) => {
        Object.assign(v.result.projects[0].nodeModules, { path: null });
      },
    ],
    [
      'node modules size',
      (v) => {
        Object.assign(v.result.projects[0].nodeModules, { sizeBytes: 10 });
      },
    ],
    [
      'orphans',
      (v) => {
        Object.assign(v.result, { orphanNodeModules: null });
      },
    ],
    [
      'orphan size',
      (v) => {
        Object.assign(v.result.orphanNodeModules[0], { sizeBytes: 1 });
      },
    ],
    [
      'orphan date',
      (v) => {
        v.result.orphanNodeModules[0].mtime = 'bad';
      },
    ],
  ];
  it.each(invalid)('rejects malformed nested %s', async (_name, mutate) => {
    const f = fixture();
    const value = entry();
    mutate(value);
    f.files.set(f.cacheFilePath, JSON.stringify(value));
    expect(await f.cache.load(entry().key)).toBeNull();
    expect(f.warn).toHaveBeenCalledTimes(1);
  });

  it('invalidates changed config, using configured rather than discovered roots', async () => {
    const f = fixture();
    f.files.set(f.cacheFilePath, JSON.stringify(entry()));
    expect(await f.cache.load({ roots: '*', maxDepth: 1 })).toBeNull();
    expect(await f.cache.load({ roots: ['C:\\work'], maxDepth: 0 })).toBeNull();
    expect(f.warn).toHaveBeenCalledTimes(2);
  });

  it('writes atomic unique temps FIFO and flush waits for both writes', async () => {
    const f = fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const write = f.fs.writeFile.getMockImplementation()!;
    f.fs.writeFile.mockImplementationOnce(async (file, content) => {
      await gate;
      await write(file, content);
    });
    const first = entry();
    const second = entry();
    second.result.scanId = '10000000-0000-4000-8000-000000000002';
    const a = f.cache.save(first);
    const b = f.cache.save(second);
    let flushed = false;
    const flushing = f.cache.flush().then(() => {
      flushed = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(f.fs.writeFile.mock.calls).toHaveLength(1);
    expect(f.fs.rename.mock.calls).toHaveLength(0);
    expect(flushed).toBe(false);
    release();
    await Promise.all([a, b, flushing]);
    const temps = f.fs.writeFile.mock.calls.map(([file]) => file);
    expect(new Set(temps).size).toBe(2);
    for (const temp of temps)
      expect(path.dirname(temp)).toBe(path.dirname(f.cacheFilePath));
    expect(f.fs.rename.mock.calls).toEqual(
      temps.map((temp) => [temp, f.cacheFilePath]),
    );
    expect(JSON.parse(f.files.get(f.cacheFilePath)!)).toEqual(second);
    expect(f.ensureCacheDir).toHaveBeenCalledTimes(2);
    expect(f.warn).not.toHaveBeenCalled();
  });

  it.each(['writeFile', 'rename'] as const)(
    'keeps old cache on %s failure, cleans own temp, recovers next save',
    async (operation) => {
      const f = fixture();
      f.files.set(f.cacheFilePath, 'old');
      f.fs[operation].mockRejectedValueOnce(new Error('denied'));
      await expect(f.cache.save(entry())).resolves.toBeUndefined();
      expect(f.files.get(f.cacheFilePath)).toBe('old');
      expect(f.fs.unlink.mock.calls).toContainEqual([
        f.fs.writeFile.mock.calls[0][0],
      ]);
      expect(f.warn).toHaveBeenCalled();
      await f.cache.save(entry());
      await f.cache.flush();
      expect(JSON.parse(f.files.get(f.cacheFilePath)!)).toEqual(entry());
      expect([...f.files.keys()]).toEqual([f.cacheFilePath]);
    },
  );

  it('absorbs mkdir and cleanup failures without poisoning the queue', async () => {
    const f = fixture();
    f.ensureCacheDir.mockRejectedValueOnce(new Error('mkdir'));
    await expect(f.cache.save(entry())).resolves.toBeUndefined();
    expect(f.fs.writeFile.mock.calls).toHaveLength(0);
    expect(f.fs.unlink.mock.calls).toHaveLength(0);
    f.fs.rename.mockRejectedValueOnce(new Error('rename'));
    f.fs.unlink.mockRejectedValueOnce(new Error('cleanup'));
    await expect(f.cache.save(entry())).resolves.toBeUndefined();
    await f.cache.save(entry());
    await f.cache.flush();
    expect(await f.cache.load(entry().key)).toEqual(entry());
  });
});
