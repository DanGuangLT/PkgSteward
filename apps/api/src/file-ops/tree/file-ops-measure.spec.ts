import type { BigIntStats, Dirent } from 'node:fs';
import { pathApi, type PathPlatform } from '@/common/utils/path.util';
import { DISK_IDENTITY_LIMIT } from '@/disk-usage/traversal/disk-usage-identity';
import { measureTarget } from '@/file-ops/tree/file-ops-measure';
import type { IDiskFs } from '@/disk-usage/interfaces/disk-usage.types';

jest.mock('@/disk-usage/traversal/disk-usage-identity', () => {
  const actual = jest.requireActual<
    typeof import('@/disk-usage/traversal/disk-usage-identity')
  >('@/disk-usage/traversal/disk-usage-identity');
  return { ...actual, DISK_IDENTITY_LIMIT: 4 };
});

const errno = (code: string) => Object.assign(new Error(code), { code });
type EntryKind = 'file' | 'directory' | 'link' | 'special';
const stat = (
  kind: EntryKind = 'file',
  overrides: Partial<Pick<BigIntStats, 'dev' | 'ino' | 'nlink' | 'size'>> = {},
): BigIntStats =>
  ({
    dev: 1n,
    ino: 1n,
    nlink: 1n,
    size: 10n,
    ...overrides,
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'directory',
    isSymbolicLink: () => kind === 'link',
  }) as BigIntStats;
const dirent = (name: string, kind: EntryKind = 'file'): Dirent => ({
  name,
  parentPath: '',
  isFile: () => kind === 'file',
  isDirectory: () => kind === 'directory',
  isSymbolicLink: () => kind === 'link',
  isBlockDevice: () => false,
  isCharacterDevice: () => false,
  isFIFO: () => kind === 'special',
  isSocket: () => false,
});
const done = (
  apparentBytes: number,
  sizeBytes: number,
  reclaimableBytes: number,
  sharedBytes: number,
  fileCount: number,
) => ({
  status: 'done',
  size: { apparentBytes, sizeBytes, reclaimableBytes, sharedBytes, fileCount },
});

const fixture = (platform: PathPlatform = 'win32') => {
  const api = pathApi(platform);
  const root = platform === 'win32' ? 'D:\\target' : '/target';
  const stats = new Map<string, BigIntStats | Error>([
    [root, stat('directory')],
  ]);
  const directories = new Map<string, Dirent[] | Error>([[root, []]]);
  const controller = new AbortController();
  let nextIno = 1n;
  const add = (
    relative: string,
    kind: EntryKind = 'file',
    overrides: Partial<
      Pick<BigIntStats, 'dev' | 'ino' | 'nlink' | 'size'>
    > = {},
  ) => {
    const p = api.join(root, relative);
    stats.set(p, stat(kind, { ino: nextIno++, ...overrides }));
    const siblings = directories.get(api.dirname(p));
    if (!Array.isArray(siblings)) throw new Error('Fixture parent must exist');
    siblings.push(dirent(api.basename(p), kind));
    if (kind === 'directory') directories.set(p, []);
    return p;
  };
  const fs = {
    lstat: jest.fn<Promise<BigIntStats>, [string, AbortSignal?]>((p) => {
      const entry = stats.get(p) ?? errno('ENOENT');
      return entry instanceof Error
        ? Promise.reject(entry)
        : Promise.resolve(entry);
    }),
    entries: jest.fn(async function* (
      p: string,
      signal: AbortSignal,
    ): AsyncGenerator<Dirent> {
      await Promise.resolve();
      const entries = directories.get(p) ?? errno('ENOENT');
      if (entries instanceof Error) throw entries;
      for (const entry of entries) {
        if (signal.aborted) return;
        yield entry;
      }
    }),
    realpath: jest.fn<Promise<string>, [string, AbortSignal?]>(() =>
      Promise.reject(new Error('Measurement must not resolve links')),
    ),
  } satisfies IDiskFs;
  const run = (p = root) =>
    measureTarget(p, { fs, platform, signal: controller.signal });
  return { root, stats, directories, controller, add, fs, run };
};

describe('measureTarget', () => {
  it('measures an individual file and forwards the cancellation signal', async () => {
    const f = fixture();
    const p = f.add('one', 'file', { size: 123n });
    expect(await f.run(p)).toEqual(done(123, 123, 123, 0, 1));
    expect(f.fs.lstat.mock.calls).toEqual([[p, f.controller.signal]]);
    expect(f.fs.entries).not.toHaveBeenCalled();
    expect(f.fs.realpath).not.toHaveBeenCalled();
  });

  it('returns zeros for an empty directory', async () => {
    const f = fixture();
    expect(await f.run()).toEqual(done(0, 0, 0, 0, 0));
  });

  it.each<PathPlatform>(['win32', 'posix'])(
    'walks a three-level tree using %s path joins',
    async (platform) => {
      const f = fixture(platform);
      const a = f.add('a', 'directory');
      const b = f.add('a/b', 'directory');
      const first = f.add('root.txt', 'file', { size: 2n });
      const second = f.add('a/middle.txt', 'file', { size: 3n });
      const third = f.add('a/b/leaf.txt', 'file', { size: 5n });
      expect(await f.run()).toEqual(done(10, 10, 10, 0, 3));
      expect(f.fs.entries.mock.calls.map(([p]) => p)).toEqual(
        expect.arrayContaining([f.root, a, b]),
      );
      expect(f.fs.entries).toHaveBeenCalledTimes(3);
      expect(f.fs.lstat.mock.calls.map(([p]) => p)).toEqual(
        expect.arrayContaining([f.root, first, second, third]),
      );
      expect(f.fs.lstat).toHaveBeenCalledTimes(4);
      expect(f.fs.lstat).not.toHaveBeenCalledWith(a, expect.anything());
      expect(f.fs.lstat).not.toHaveBeenCalledWith(b, expect.anything());
      for (const [, signal] of f.fs.entries.mock.calls)
        expect(signal).toBe(f.controller.signal);
      for (const [, signal] of f.fs.lstat.mock.calls)
        expect(signal).toBe(f.controller.signal);
    },
  );

  it('counts both hardlink entries but reclaims and counts their inode only once', async () => {
    const f = fixture();
    f.add('a', 'file', { size: 20n, ino: 50n, nlink: 2n });
    f.add('b', 'file', { size: 20n, ino: 50n, nlink: 2n });
    expect(await f.run()).toEqual(done(40, 20, 20, 0, 2));
  });

  it('reports an outside hardlink as shared, including when the target itself is a file', async () => {
    const f = fixture();
    const p = f.add('a', 'file', { size: 20n, ino: 50n, nlink: 2n });
    expect(await f.run()).toEqual(done(20, 20, 0, 20, 1));
    expect(await f.run(p)).toEqual(done(20, 20, 0, 20, 1));
  });

  it('separates three pnpm-like shared files from one private file', async () => {
    const f = fixture();
    f.add('a', 'file', { ino: 1n, nlink: 2n, size: 10n });
    f.add('b', 'file', { ino: 2n, nlink: 3n, size: 20n });
    f.add('c', 'file', { ino: 3n, nlink: 2n, size: 30n });
    f.add('own', 'file', { size: 7n });
    expect(await f.run()).toEqual(done(67, 67, 7, 60, 4));
  });

  it('distinguishes equal inode numbers on different devices', async () => {
    const f = fixture();
    f.add('a', 'file', { dev: 1n, ino: 50n, nlink: 2n });
    f.add('b', 'file', { dev: 2n, ino: 50n, nlink: 2n });
    expect(await f.run()).toEqual(done(20, 20, 0, 20, 2));
  });

  it('always counts nlink <= 1 as unique and reclaimable without requiring an identity', async () => {
    const f = fixture();
    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      f.add(name, 'file', {
        ino: 0n,
        dev: -1n,
        nlink: name === 'a' ? 0n : 1n,
        size: 2n,
      });
    }
    expect(await f.run()).toEqual(done(10, 10, 10, 0, 5));
  });

  it('tracks hardlinks across subdirectories and never adds reclaimable bytes twice', async () => {
    const f = fixture();
    f.add('nested', 'directory');
    f.add('a', 'file', { ino: 50n, nlink: 2n });
    f.add('nested/b', 'file', { ino: 50n, nlink: 2n });
    // More observed entries than nlink can occur when metadata changes during traversal.
    f.add('nested/c', 'file', { ino: 50n, nlink: 2n });
    expect(await f.run()).toEqual(done(30, 10, 10, 0, 3));
  });

  it('does not lstat or open child symlinks and junctions', async () => {
    const f = fixture();
    const link = f.add('symlink', 'link');
    const junction = f.add('junction', 'link');
    f.add('own', 'file', { size: 7n });
    expect(await f.run()).toEqual(done(7, 7, 7, 0, 1));
    expect(f.fs.entries.mock.calls).toEqual([[f.root, f.controller.signal]]);
    expect(f.fs.lstat.mock.calls.map(([p]) => p)).not.toContain(link);
    expect(f.fs.lstat.mock.calls.map(([p]) => p)).not.toContain(junction);
    expect(f.fs.realpath).not.toHaveBeenCalled();
  });

  it('skips entries that turn into links or non-files after enumeration', async () => {
    const f = fixture();
    const link = f.add('link-later');
    const special = f.add('special-later');
    const directory = f.add('dir-later');
    f.stats.set(link, stat('link'));
    f.stats.set(special, stat('special'));
    f.stats.set(directory, stat('directory'));
    f.add('own', 'file', { size: 7n });
    expect(await f.run()).toEqual(done(7, 7, 7, 0, 1));
    expect(f.fs.entries.mock.calls).toEqual([[f.root, f.controller.signal]]);
  });

  it('walks 10,000 nested directories without recursion or real filesystem access', async () => {
    const root = '/r';
    const signal = new AbortController().signal;
    // A counter, not jest.fn: recorded calls would keep 10,001 deep path strings alive
    // (gigabytes, beyond the CI heap limit).
    let entriesCalls = 0;
    const entries = async function* (p: string): AsyncGenerator<Dirent> {
      entriesCalls += 1;
      await Promise.resolve();
      const depth = (p.length - root.length) / 2;
      yield depth < 10_000 ? dirent('d', 'directory') : dirent('leaf');
    };
    const lstat = jest.fn((p: string): Promise<BigIntStats> =>
      Promise.resolve(
        p === root ? stat('directory') : stat('file', { size: 1n }),
      ),
    );
    const fs: IDiskFs = { entries, lstat, realpath: jest.fn() };
    expect(
      await measureTarget(root, { fs, platform: 'posix', signal }),
    ).toEqual(done(1, 1, 1, 0, 1));
    expect(entriesCalls).toBe(10_001);
    expect(lstat).toHaveBeenCalledTimes(2);
    expect(lstat).toHaveBeenLastCalledWith(
      '/r' + '/d'.repeat(10_000) + '/leaf',
      signal,
    );
  }, 30_000);

  it.each(['ENOENT', 'ENOTDIR'])(
    'skips disappearing files and directories (%s) and continues',
    async (code) => {
      const f = fixture();
      const file = f.add('missing');
      const directory = f.add('gone', 'directory');
      f.stats.set(file, errno(code));
      f.directories.set(directory, errno(code));
      f.add('own', 'file', { size: 7n });
      expect(await f.run()).toEqual(done(7, 7, 7, 0, 1));
    },
  );

  it.each(['ENOENT', 'ENOTDIR'])(
    'returns not_found for a missing root (%s)',
    async (code) => {
      const f = fixture();
      f.stats.set(f.root, errno(code));
      expect(await f.run()).toEqual({ status: 'failed', reason: 'not_found' });
      expect(f.fs.entries).not.toHaveBeenCalled();
    },
  );

  it('returns changed for a root link without following it', async () => {
    const f = fixture();
    f.stats.set(f.root, stat('link'));
    expect(await f.run()).toEqual({ status: 'failed', reason: 'changed' });
    expect(f.fs.entries).not.toHaveBeenCalled();
    expect(f.fs.realpath).not.toHaveBeenCalled();
  });

  it.each(['root-stat', 'file-stat', 'root-entries', 'child-entries'])(
    'returns read_error, never partial success, after EACCES at %s',
    async (where) => {
      const f = fixture();
      f.add('ok');
      const file = f.add('bad');
      const directory = f.add('nested', 'directory');
      if (where === 'root-stat') f.stats.set(f.root, errno('EACCES'));
      if (where === 'file-stat') f.stats.set(file, errno('EACCES'));
      if (where === 'root-entries') f.directories.set(f.root, errno('EACCES'));
      if (where === 'child-entries')
        f.directories.set(directory, errno('EACCES'));
      expect(await f.run()).toEqual({ status: 'failed', reason: 'read_error' });
    },
  );

  it('returns read_error for a non-errno exception', async () => {
    const f = fixture();
    f.fs.lstat.mockRejectedValue(new Error('unexpected adapter failure'));
    expect(await f.run()).toEqual({ status: 'failed', reason: 'read_error' });
  });

  it('returns cancelled before root I/O for a pre-aborted signal', async () => {
    const f = fixture();
    f.controller.abort();
    expect(await f.run()).toEqual({ status: 'cancelled' });
    expect(f.fs.lstat).not.toHaveBeenCalled();
    expect(f.fs.entries).not.toHaveBeenCalled();
  });

  it('checks cancellation after root lstat resolves', async () => {
    const f = fixture();
    f.fs.lstat.mockImplementationOnce(() => {
      f.controller.abort();
      return Promise.resolve(stat('file'));
    });
    expect(await f.run()).toEqual({ status: 'cancelled' });
    expect(f.fs.entries).not.toHaveBeenCalled();
  });

  it('checks cancellation after a child lstat resolves', async () => {
    const f = fixture();
    f.add('a');
    f.add('b');
    f.fs.lstat
      .mockResolvedValueOnce(stat('directory'))
      .mockImplementationOnce(() => {
        f.controller.abort();
        return Promise.resolve(stat('file'));
      });
    expect(await f.run()).toEqual({ status: 'cancelled' });
    expect(f.fs.lstat.mock.calls.map(([p]) => p)).toEqual([
      f.root,
      'D:\\target\\a',
    ]);
  });

  it('returns cancelled when entries ends silently after yielding some files', async () => {
    const f = fixture();
    f.add('a');
    f.fs.entries.mockImplementation(async function* (): AsyncGenerator<Dirent> {
      await Promise.resolve();
      yield dirent('a');
      f.controller.abort();
      return;
    });
    expect(await f.run()).toEqual({ status: 'cancelled' });
    expect(f.fs.lstat).toHaveBeenCalledWith(
      'D:\\target\\a',
      f.controller.signal,
    );
  });

  it('checks cancellation after iterator.next before inspecting a yielded entry', async () => {
    const f = fixture();
    f.fs.entries.mockImplementation(async function* (): AsyncGenerator<Dirent> {
      await Promise.resolve();
      f.controller.abort();
      yield dirent('not-to-read');
    });
    expect(await f.run()).toEqual({ status: 'cancelled' });
    expect(f.fs.lstat.mock.calls).toEqual([[f.root, f.controller.signal]]);
  });

  it.each(['lstat', 'entries'])(
    'treats an aborted metadata permit failure in %s as cancellation',
    async (where) => {
      const f = fixture();
      if (where === 'lstat') {
        f.fs.lstat.mockImplementationOnce(() => {
          f.controller.abort();
          return Promise.reject(new Error('Disk metadata operation cancelled'));
        });
      } else {
        f.add('a');
        f.fs.entries.mockImplementation(
          async function* (): AsyncGenerator<Dirent> {
            yield dirent('a');
            await Promise.resolve();
            f.controller.abort();
            throw new Error('Disk metadata operation cancelled');
          },
        );
      }
      expect(await f.run()).toEqual({ status: 'cancelled' });
    },
  );

  it('prioritizes cancellation over a simultaneous not_found error', async () => {
    const f = fixture();
    f.fs.lstat.mockImplementationOnce(() => {
      f.controller.abort();
      return Promise.reject(errno('ENOENT'));
    });
    expect(await f.run()).toEqual({ status: 'cancelled' });
  });

  it('allows a byte total exactly equal to MAX_SAFE_INTEGER', async () => {
    const f = fixture();
    f.add('large', 'file', { size: BigInt(Number.MAX_SAFE_INTEGER) });
    expect(await f.run()).toEqual(
      done(
        Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
        0,
        1,
      ),
    );
  });

  it('rejects an individual file above MAX_SAFE_INTEGER', async () => {
    const f = fixture();
    f.add('large', 'file', { size: BigInt(Number.MAX_SAFE_INTEGER) + 1n });
    expect(await f.run()).toEqual({
      status: 'failed',
      reason: 'numeric_limit',
    });
  });

  it('rejects cumulative overflow even when each file size is safe', async () => {
    const f = fixture();
    f.add('large', 'file', { size: BigInt(Number.MAX_SAFE_INTEGER) });
    f.add('one', 'file', { size: 1n });
    expect(await f.run()).toEqual({
      status: 'failed',
      reason: 'numeric_limit',
    });
  });

  it('checks apparent overflow even when unique and reclaimable totals remain safe', async () => {
    const f = fixture();
    const size = BigInt(Number.MAX_SAFE_INTEGER) / 2n + 1n;
    f.add('a', 'file', { size, ino: 50n, nlink: 2n });
    f.add('b', 'file', { size, ino: 50n, nlink: 2n });
    expect(await f.run()).toEqual({
      status: 'failed',
      reason: 'numeric_limit',
    });
  });

  it('accepts exactly the identity limit and rejects the next distinct hardlink identity', async () => {
    const f = fixture();
    for (let i = 1; i <= DISK_IDENTITY_LIMIT; i++)
      f.add(`file-${i}`, 'file', { ino: BigInt(i), nlink: 2n, size: 1n });
    expect(await f.run()).toEqual(done(4, 4, 0, 4, 4));
    f.add('over-limit', 'file', { ino: 99n, nlink: 2n, size: 1n });
    expect(await f.run()).toEqual({
      status: 'failed',
      reason: 'identity_limit',
    });
  });

  it('does not charge duplicate hardlink entries against the identity limit', async () => {
    const f = fixture();
    for (let i = 0; i < 5; i++)
      f.add(`file-${i}`, 'file', { ino: 50n, nlink: 5n, size: 1n });
    expect(await f.run()).toEqual(done(5, 1, 1, 0, 5));
  });

  it.each([{ ino: 0n }, { ino: -1n }, { dev: -1n }])(
    'fails closed for unusable hardlink identity %#',
    async (overrides) => {
      const f = fixture();
      f.add('bad', 'file', { nlink: 2n, ...overrides });
      expect(await f.run()).toEqual({ status: 'failed', reason: 'read_error' });
    },
  );

  it('awaits each metadata operation before starting another one', async () => {
    const f = fixture();
    f.add('a');
    f.add('b');
    f.add('c');
    let active = 0;
    let peak = 0;
    f.fs.lstat.mockImplementation(async (p) => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return p === f.root ? stat('directory') : stat('file');
    });
    expect(await f.run()).toEqual(done(30, 30, 30, 0, 3));
    expect(peak).toBe(1);
    expect(active).toBe(0);
  });
});
