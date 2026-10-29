import {
  AppException,
  ForbiddenException,
  InternalServerException,
  NotFoundException,
  ValidationException,
} from '@/common/exceptions/app.exception';
import { pathApi, type PathPlatform } from '@/common/utils/path.util';
import type {
  PathCheckFailureCode,
  PathCheckResult,
} from '@/core/path-guard/interfaces/path-guard.types';
import { readTreeLevel, TREE_ENTRY_LIMIT } from '@/file-ops/file-tree';
import type {
  IFileOpsDirent,
  IFileOpsStat,
} from '@/file-ops/interfaces/file-ops.types';
import type { IStoredScanResult } from '@/scanner/interfaces/scanner.types';

type Kind = 'directory' | 'file' | 'link' | 'other';
const errno = (code: string) =>
  Object.assign(new Error('PRIVATE_FS_DETAIL'), { code });
const stat = (kind: Kind = 'directory', size = 0n): IFileOpsStat => ({
  dev: 1n,
  ino: 2n,
  size,
  isFile: () => kind === 'file',
  isDirectory: () => kind === 'directory',
  isSymbolicLink: () => kind === 'link',
});
const entry = (name: string, kind: Kind = 'directory'): IFileOpsDirent => ({
  name,
  isDirectory: () => kind === 'directory',
  isSymbolicLink: () => kind === 'link',
});
const allowed = (inputPath: string, realPath = inputPath): PathCheckResult => ({
  allowed: true,
  path: { inputPath, resolvedPath: inputPath, realPath, isSymbolicLink: false },
});

const fixture = (platform: PathPlatform = 'win32') => {
  const api = pathApi(platform);
  const root = platform === 'win32' ? 'D:\\Dự án 🚀' : '/Dự án 🚀';
  const controller = new AbortController();
  const stats = new Map<string, IFileOpsStat | Error>();
  const listing = new Map<string, IFileOpsDirent[]>();
  const yielded = jest.fn<void, [string]>();
  const closed = jest.fn<void, []>();
  const scan: Pick<IStoredScanResult, 'projects' | 'orphanNodeModules'> = {
    projects: [
      {
        path: root,
        name: 'Ứng dụng',
        hasLockfile: true,
        packageManager: 'pnpm',
        lastActivityAt: '2026-10-01T00:00:00.000Z',
        nodeModules: {
          exists: false,
          path: api.join(root, 'node_modules'),
          sizeBytes: null,
        },
      },
    ],
    orphanNodeModules: [],
  };
  stats.set(root, stat());
  stats.set(api.join(root, 'package.json'), stat('file'));
  const lstat = jest.fn((path: string): Promise<IFileOpsStat> => {
    const value = stats.get(path) ?? errno('ENOENT');
    return value instanceof Error
      ? Promise.reject(value)
      : Promise.resolve(value);
  });
  const entries = jest.fn(
    (path: string, signal: AbortSignal): AsyncIterable<IFileOpsDirent> => {
      // A silent end on abort models the disk adapter's cancellation contract.
      function* iterate() {
        try {
          for (const value of listing.get(path) ?? []) {
            if (signal.aborted) return;
            yielded(value.name);
            yield value;
          }
        } finally {
          closed();
        }
      }
      const iterator = iterate();
      return {
        [Symbol.asyncIterator]() {
          return {
            next: () => Promise.resolve(iterator.next()),
            return: () => Promise.resolve(iterator.return(undefined)),
          };
        },
      };
    },
  );
  const checkMany = jest.fn(
    (paths: readonly string[]): Promise<PathCheckResult[]> =>
      Promise.resolve(paths.map((path) => allowed(path))),
  );
  const run = (path = root) =>
    readTreeLevel(path, scan, {
      platform,
      checkMany,
      fs: { lstat, entries },
      signal: controller.signal,
    });
  return {
    api,
    root,
    controller,
    stats,
    listing,
    scan,
    lstat,
    entries,
    checkMany,
    yielded,
    closed,
    run,
  };
};

type ExceptionClass =
  | typeof ValidationException
  | typeof ForbiddenException
  | typeof NotFoundException
  | typeof InternalServerException;
const expectFailure = async (
  request: Promise<unknown>,
  exception: ExceptionClass,
  statusCode: number,
) => {
  const error: unknown = await request.catch((value: unknown) => value);
  expect(error).toBeInstanceOf(exception);
  expect(error).toBeInstanceOf(AppException);
  expect(error).toMatchObject({ statusCode });
  if (error instanceof Error) {
    expect(error.message).not.toContain('PRIVATE_FS_DETAIL');
    expect(error.message).not.toContain('PRIVATE_GUARD_DETAIL');
  }
};

describe('readTreeLevel', () => {
  it('declares the bounded listing limit', () => {
    expect(TREE_ENTRY_LIMIT).toBe(2_000);
  });

  it.each<PathPlatform>(['win32', 'posix'])(
    'lists one level of a project on %s',
    async (platform) => {
      const f = fixture(platform);
      f.listing.set(f.root, [entry('thư mục'), entry('tệp 🚀.txt', 'file')]);
      f.stats.set(f.api.join(f.root, 'tệp 🚀.txt'), stat('file', 123n));
      await expect(f.run()).resolves.toEqual({
        path: f.root,
        owner: { path: f.root, name: 'Ứng dụng' },
        truncated: false,
        entries: [
          {
            name: 'thư mục',
            path: f.api.join(f.root, 'thư mục'),
            type: 'directory',
            sizeBytes: null,
            selectable: true,
          },
          {
            name: 'tệp 🚀.txt',
            path: f.api.join(f.root, 'tệp 🚀.txt'),
            type: 'file',
            sizeBytes: 123,
            selectable: true,
          },
        ],
      });
      expect(f.checkMany).toHaveBeenCalledWith([f.root]);
      expect(f.entries).toHaveBeenCalledTimes(1);
      expect(f.entries).toHaveBeenCalledWith(f.root, f.controller.signal);
      expect(f.lstat).not.toHaveBeenCalledWith(f.api.join(f.root, 'thư mục'));
    },
  );

  it('uses the guarded realPath to classify and list a subdirectory', async () => {
    const f = fixture();
    const path = f.api.join(f.root, 'src');
    const input = 'D:\\alias\\src';
    f.stats.set(path, stat());
    f.checkMany.mockResolvedValue([allowed(input, path)]);
    await expect(f.run(input)).resolves.toEqual({
      path,
      owner: { path: f.root, name: 'Ứng dụng' },
      entries: [],
      truncated: false,
    });
    expect(f.entries).toHaveBeenCalledWith(path, f.controller.signal);
    expect(f.lstat).not.toHaveBeenCalledWith(input);
  });

  it.each([
    [2_000, false, 2_000],
    [2_001, true, 2_001],
    [2_100, true, 2_001],
  ] as const)(
    'bounds a listing of %i entries',
    async (count, truncated, reads) => {
      const f = fixture();
      f.listing.set(
        f.root,
        Array.from({ length: count }, (_, i) => entry(`folder${i}`)),
      );
      const result = await f.run();
      expect(result.entries).toHaveLength(2_000);
      expect(result.truncated).toBe(truncated);
      expect(f.yielded).toHaveBeenCalledTimes(reads);
      expect(f.closed).toHaveBeenCalledTimes(1);
      expect(f.entries).toHaveBeenCalledTimes(1);
    },
  );

  it('sorts directories first, numeric names naturally and ties by code unit', async () => {
    const f = fixture();
    f.listing.set(f.root, [
      entry('file10', 'file'),
      entry('a', 'file'),
      entry('z-dir'),
      entry('A', 'file'),
      entry('file2', 'file'),
      entry('a-dir'),
    ]);
    for (const name of ['file10', 'a', 'A', 'file2'])
      f.stats.set(f.api.join(f.root, name), stat('file'));
    expect((await f.run()).entries.map(({ name }) => name)).toEqual([
      'a-dir',
      'z-dir',
      'A',
      'a',
      'file2',
      'file10',
    ]);
  });

  it('never stats links or junctions even when the dirent also claims to be a directory', async () => {
    const f = fixture();
    f.listing.set(f.root, [
      entry('symlink', 'link'),
      {
        name: 'junction',
        isSymbolicLink: () => true,
        isDirectory: () => true,
      },
    ]);
    const result = await f.run();
    expect(result.entries).toEqual(
      ['junction', 'symlink'].map((name) => ({
        name,
        path: f.api.join(f.root, name),
        type: 'link',
        sizeBytes: null,
        selectable: false,
      })),
    );
    expect(f.lstat).not.toHaveBeenCalledWith(f.api.join(f.root, 'symlink'));
    expect(f.lstat).not.toHaveBeenCalledWith(f.api.join(f.root, 'junction'));
  });

  it.each<[bigint, number | null]>([
    [0n, 0],
    [9007199254740991n, 9007199254740991],
    [9007199254740992n, null],
  ])(
    'reports file size %s without losing precision',
    async (size, expected) => {
      const f = fixture();
      f.listing.set(f.root, [entry('file', 'file')]);
      f.stats.set(f.api.join(f.root, 'file'), stat('file', size));
      expect((await f.run()).entries).toEqual([
        {
          name: 'file',
          path: f.api.join(f.root, 'file'),
          type: 'file',
          sizeBytes: expected,
          selectable: true,
        },
      ]);
    },
  );

  it.each(['ENOENT', 'ENOTDIR'])(
    'omits children that disappear with %s',
    async (code) => {
      const f = fixture();
      f.listing.set(f.root, [entry('gone', 'file'), entry('stays')]);
      f.stats.set(f.api.join(f.root, 'gone'), errno(code));
      expect((await f.run()).entries.map(({ name }) => name)).toEqual([
        'stays',
      ]);
    },
  );

  it.each<[Kind | 'EACCES', Kind]>([
    ['link', 'link'],
    ['other', 'other'],
    ['EACCES', 'other'],
  ])(
    'makes a child with lstat result %s unselectable',
    async (kind, expected) => {
      const f = fixture();
      f.listing.set(f.root, [entry('changed', 'file')]);
      f.stats.set(
        f.api.join(f.root, 'changed'),
        kind === 'EACCES' ? errno(kind) : stat(kind),
      );
      expect((await f.run()).entries).toEqual([
        {
          name: 'changed',
          path: f.api.join(f.root, 'changed'),
          type: expected,
          sizeBytes: null,
          selectable: false,
        },
      ]);
    },
  );

  it.each<[PathCheckFailureCode, ExceptionClass, number]>([
    ['INVALID_PATH', ValidationException, 400],
    ['NOT_FOUND', NotFoundException, 404],
    ['DENYLISTED', ForbiddenException, 403],
    ['OUTSIDE_ALLOWLIST', ForbiddenException, 403],
  ])(
    'maps guard %s without exposing details',
    async (code, exception, status) => {
      const f = fixture();
      f.checkMany.mockResolvedValue([
        { allowed: false, code, message: 'PRIVATE_GUARD_DETAIL' },
      ]);
      await expectFailure(f.run(), exception, status);
      expect(f.lstat).not.toHaveBeenCalled();
      expect(f.entries).not.toHaveBeenCalled();
    },
  );

  it('rejects a directory outside scanned projects', async () => {
    const f = fixture();
    f.stats.set('D:\\outside', stat());
    await expectFailure(f.run('D:\\outside'), ForbiddenException, 403);
    expect(f.entries).not.toHaveBeenCalled();
  });

  it('maps a guard-detected link to validation failure', async () => {
    const f = fixture();
    f.checkMany.mockResolvedValue([
      {
        allowed: true,
        path: {
          inputPath: f.root,
          resolvedPath: f.root,
          realPath: f.root,
          isSymbolicLink: true,
        },
      },
    ]);
    await expectFailure(f.run(), ValidationException, 400);
    expect(f.entries).not.toHaveBeenCalled();
  });

  it.each<[Kind | 'ENOENT' | 'EACCES', ExceptionClass, number]>([
    ['link', ValidationException, 400],
    ['other', ValidationException, 400],
    ['file', ValidationException, 400],
    ['ENOENT', NotFoundException, 404],
    ['EACCES', InternalServerException, 500],
  ])('maps root classification failure %s', async (kind, exception, status) => {
    const f = fixture();
    f.stats.set(
      f.root,
      kind === 'ENOENT' || kind === 'EACCES' ? errno(kind) : stat(kind),
    );
    await expectFailure(f.run(), exception, status);
    expect(f.entries).not.toHaveBeenCalled();
  });

  it('rejects a changed owner manifest', async () => {
    const f = fixture();
    f.stats.delete(f.api.join(f.root, 'package.json'));
    await expectFailure(f.run(), ValidationException, 400);
    expect(f.entries).not.toHaveBeenCalled();
  });

  it('rejects an ordinary file inside a project as not a directory', async () => {
    const f = fixture();
    const path = f.api.join(f.root, 'source.ts');
    f.stats.set(path, stat('file'));
    await expectFailure(f.run(path), ValidationException, 400);
    expect(f.entries).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'allows an orphan only when it has a scanned owner: %s',
    async (hasOwner) => {
      const f = fixture();
      const path = hasOwner
        ? f.api.join(f.root, 'loose', 'node_modules')
        : 'D:\\loose\\node_modules';
      f.scan.orphanNodeModules.push({
        path,
        sizeBytes: null,
        mtime: '2026-10-01T00:00:00.000Z',
      });
      f.stats.set(path, stat());
      if (hasOwner) {
        await expect(f.run(path)).resolves.toEqual({
          path,
          owner: { path: f.root, name: 'Ứng dụng' },
          entries: [],
          truncated: false,
        });
      } else {
        await expectFailure(f.run(path), ForbiddenException, 403);
        expect(f.entries).not.toHaveBeenCalled();
      }
    },
  );

  it('rejects an orphan whose parent now contains package.json', async () => {
    const f = fixture();
    const path = f.api.join(f.root, 'loose', 'node_modules');
    f.scan.orphanNodeModules.push({
      path,
      sizeBytes: null,
      mtime: '2026-10-01T00:00:00.000Z',
    });
    f.stats.set(path, stat());
    f.stats.set(f.api.join(f.root, 'loose', 'package.json'), stat('file'));
    await expectFailure(f.run(path), ValidationException, 400);
    expect(f.entries).not.toHaveBeenCalled();
  });

  it('rejects an already cancelled request', async () => {
    const f = fixture();
    const reason = new Error('cancel tree');
    f.controller.abort(reason);
    await expect(f.run()).rejects.toBe(reason);
    expect(f.entries).not.toHaveBeenCalled();
  });

  it('checks cancellation after guard resolution', async () => {
    const f = fixture();
    const reason = new Error('cancel guard');
    f.checkMany.mockImplementation(() => {
      f.controller.abort(reason);
      return Promise.resolve([allowed(f.root)]);
    });
    await expect(f.run()).rejects.toBe(reason);
    expect(f.entries).not.toHaveBeenCalled();
  });

  it('checks cancellation after classification', async () => {
    const f = fixture();
    const reason = new Error('cancel classification');
    f.lstat.mockImplementation(() => {
      f.controller.abort(reason);
      return Promise.reject(errno('EACCES'));
    });
    await expect(f.run()).rejects.toBe(reason);
    expect(f.entries).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'checks cancellation after child lstat (reject=%s)',
    async (reject) => {
      const f = fixture();
      const reason = new Error('cancel child stat');
      f.listing.set(f.root, [entry('child', 'file')]);
      const original = f.lstat.getMockImplementation()!;
      f.lstat.mockImplementation((path) => {
        if (path !== f.api.join(f.root, 'child')) return original(path);
        f.controller.abort(reason);
        return reject
          ? Promise.reject(errno('ENOENT'))
          : Promise.resolve(stat('file'));
      });
      await expect(f.run()).rejects.toBe(reason);
    },
  );

  it('rejects when the iterator silently ends after cancellation', async () => {
    const f = fixture();
    const reason = new Error('cancel iterator');
    f.listing.set(f.root, [entry('first'), entry('second')]);
    f.yielded.mockImplementationOnce(() => f.controller.abort(reason));
    await expect(f.run()).rejects.toBe(reason);
  });

  it('checks cancellation even when an iterator ends without yielding anything', async () => {
    const f = fixture();
    const reason = new Error('cancel empty iterator');
    f.entries.mockImplementation(() => ({
      [Symbol.asyncIterator]() {
        return {
          next() {
            f.controller.abort(reason);
            return Promise.resolve({ done: true as const, value: undefined });
          },
        };
      },
    }));
    await expect(f.run()).rejects.toBe(reason);
  });
});
