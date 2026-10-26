import type { BigIntStats, Dir, Dirent } from 'node:fs';
import * as nodeFs from 'node:fs/promises';
import { win32 as path } from 'node:path';
import { DISK_IDENTITY_LIMIT } from '@/disk-usage/disk-usage-identity';
import { DISK_ROW_LIMIT } from '@/disk-usage/disk-usage-packages';
import {
  createDiskFs,
  DISK_CONCURRENCY,
  walkDiskUsage,
} from '@/disk-usage/disk-usage-walker';
import type {
  DiskView,
  IDiskFs,
  IDiskUsageJob,
  IDiskWalkDeps,
} from '@/disk-usage/interfaces/disk-usage.types';

jest.mock('node:fs/promises', () => ({
  opendir: jest.fn(),
  lstat: jest.fn(),
  realpath: jest.fn(),
}));

// Hạ hằng số tại ranh giới module, không thêm tuỳ chọn chỉ phục vụ test vào API.
jest.mock('@/disk-usage/disk-usage-identity', () => {
  const actual = jest.requireActual<
    typeof import('@/disk-usage/disk-usage-identity')
  >('@/disk-usage/disk-usage-identity');
  return { ...actual, DISK_IDENTITY_LIMIT: 6 };
});

const errno = (code: string) => Object.assign(new Error(code), { code });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

const initialJob = (
  root: string,
  view: DiskView = 'directory',
): IDiskUsageJob => ({
  jobId: '00000000-0000-4000-8000-000000000001',
  status: 'running',
  path: root,
  view,
  metric: 'unique-apparent',
  phase: 'listing',
  partial: true,
  stopReason: null,
  sizeBytes: null,
  fileCount: null,
  children: [],
  progress: {
    visitedDirs: 0,
    visitedEntries: 0,
    skippedCount: 0,
    skippedLinks: 0,
  },
  startedAt: new Date().toISOString(),
  measuredAt: null,
  cacheHit: false,
  failureCode: null,
});

const fixture = (view: DiskView = 'directory') => {
  const root = 'D:\\TEST\\node_modules';
  const key = (p: string) => path.resolve(p).toLowerCase();
  interface INode {
    kind: 'directory' | 'file' | 'link' | 'special';
    unknownDirent?: boolean;
    size: bigint;
    ino: bigint;
    dev: bigint;
    nlink: bigint;
    target?: string;
    children: string[];
  }
  let nextIno = 1n;
  const nodes = new Map<string, INode>();
  const add = (
    p: string,
    kind: INode['kind'],
    overrides: Partial<INode> = {},
  ) => {
    nodes.set(key(p), {
      kind,
      size: 0n,
      ino: nextIno++,
      dev: 1n,
      nlink: 1n,
      children: [],
      ...overrides,
    });
    nodes.get(key(path.dirname(p)))?.children.push(p);
    return p;
  };
  const get = (p: string) => {
    const node = nodes.get(key(p));
    if (!node) throw errno('ENOENT');
    return node;
  };
  const stat = (node: INode): BigIntStats =>
    ({
      size: node.size,
      ino: node.ino,
      dev: node.dev,
      nlink: node.nlink,
      mtimeNs: 1_000_000n,
      isDirectory: () => node.kind === 'directory',
      isFile: () => node.kind === 'file',
      isSymbolicLink: () => node.kind === 'link',
    }) as BigIntStats;
  const fs = {
    entries: jest.fn(async function* (
      p: string,
      signal: AbortSignal,
    ): AsyncGenerator<Dirent> {
      await Promise.resolve();
      for (const child of get(p).children) {
        if (signal.aborted) return;
        const node = get(child);
        const kind = node.unknownDirent ? null : node.kind;
        yield {
          name: path.basename(child),
          parentPath: p,
          isDirectory: () => kind === 'directory',
          isFile: () => kind === 'file',
          isSymbolicLink: () => kind === 'link',
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isFIFO: () => kind === 'special',
          isSocket: () => false,
        };
      }
    }),
    lstat: jest.fn((p: string) => Promise.resolve(stat(get(p)))),
    realpath: jest.fn((p: string) =>
      Promise.resolve(get(p).target ?? path.resolve(p)),
    ),
  } satisfies IDiskFs;
  const snapshots: IDiskUsageJob[] = [];
  const onSnapshot = jest.fn((snapshot: IDiskUsageJob) => {
    snapshots.push(structuredClone(snapshot));
  });
  const deps: IDiskWalkDeps = {
    fs,
    platform: 'win32',
    isProtected: jest.fn(() => false),
    onSnapshot,
  };
  const controller = new AbortController();
  const initial = initialJob(root, view);
  add(root, 'directory');
  const run = () => {
    const result = walkDiskUsage(initial, controller.signal, deps);
    // Ca chờ I/O vẫn thu rejection của khung RED ngay, không unhandled rejection.
    void result.catch(() => undefined);
    return result;
  };
  return {
    root,
    key,
    nodes,
    stat,
    fs,
    deps,
    initial,
    snapshots,
    onSnapshot,
    controller,
    run,
    dir: (p: string) => add(p, 'directory'),
    file: (p: string, size = 10n, overrides: Partial<INode> = {}) =>
      add(p, 'file', { size, ...overrides }),
    link: (p: string, target: string) => add(p, 'link', { target }),
    special: (p: string) => add(p, 'special'),
  };
};

describe('walkDiskUsage', () => {
  afterEach(() => jest.useRealTimers());

  it('publishes shallow pending rows before blocked deep IO', async () => {
    const f = fixture();
    const child = f.dir(path.join(f.root, 'child'));
    f.file(path.join(child, 'data'));
    const gate = deferred<void>();
    const entries = f.fs.entries.getMockImplementation()!;
    f.fs.entries.mockImplementation(async function* (p, signal) {
      if (p === child) await gate.promise;
      yield* entries(p, signal);
    });
    const pending = f.run();
    try {
      await settle();
      expect(f.snapshots.some((s) => s.status === 'running')).toBe(true);
      expect(
        f.snapshots.some((s) =>
          s.children.some(
            (r) =>
              r.path === child && r.state === 'pending' && r.sizeBytes === null,
          ),
        ),
      ).toBe(true);
      expect(f.snapshots.every((s) => s.status === 'running')).toBe(true);
    } finally {
      gate.resolve();
    }
    expect((await pending).sizeBytes).toBe(10);
  });

  it('includes hidden, AppData, build and nested node_modules directories', async () => {
    const f = fixture();
    for (const name of [
      '.git',
      '.pnpm',
      'AppData',
      'dist',
      '.next',
      'node_modules',
    ]) {
      const child = f.dir(path.join(f.root, name));
      f.file(path.join(child, 'data'), 3n);
    }
    const result = await f.run();
    expect(result).toMatchObject({
      status: 'completed',
      partial: false,
      stopReason: null,
      sizeBytes: 18,
      fileCount: 6,
    });
    expect(result.children).toHaveLength(6);
    expect(result.progress.visitedDirs).toBe(7);
  });

  it('deduplicates root and each overlapping row independently without dividing nlink', async () => {
    const f = fixture();
    for (const name of ['a', 'b']) {
      const child = f.dir(path.join(f.root, name));
      f.file(path.join(child, 'first'), 100n, { ino: 99n, nlink: 4n });
      f.file(path.join(child, 'second'), 100n, { ino: 99n, nlink: 4n });
    }
    const result = await f.run();
    expect(result).toMatchObject({
      sizeBytes: 100,
      fileCount: 1,
      partial: false,
    });
    expect(result.children.map((r) => [r.sizeBytes, r.fileCount])).toEqual([
      [100, 1],
      [100, 1],
    ]);
  });

  it('counts same inode on different devices as separate files', async () => {
    const f = fixture();
    f.file(path.join(f.root, 'a'), 7n, { ino: 9n, dev: 1n, nlink: 2n });
    f.file(path.join(f.root, 'b'), 11n, { ino: 9n, dev: 2n, nlink: 2n });
    expect(await f.run()).toMatchObject({ sizeBytes: 18, fileCount: 2 });
  });

  it('does not merge adjacent bigint inodes above 2^53', async () => {
    const f = fixture();
    f.file(path.join(f.root, 'a'), 7n, { ino: 2n ** 53n, nlink: 2n });
    f.file(path.join(f.root, 'b'), 11n, { ino: 2n ** 53n + 1n, nlink: 2n });
    expect(await f.run()).toMatchObject({ sizeBytes: 18, fileCount: 2 });
  });

  it('does not track nlink 1 files against the identity ceiling', async () => {
    const f = fixture();
    const dir = f.dir(path.join(f.root, 'data'));
    for (let i = 0; i < DISK_IDENTITY_LIMIT * 3; i++) {
      // Cùng inode giả để chứng minh nhánh nlink=1 cộng thẳng, không dùng Set.
      f.file(path.join(dir, `file-${i}`), 1n, { ino: 42n, nlink: 1n });
    }
    expect(await f.run()).toMatchObject({
      status: 'completed',
      partial: false,
      stopReason: null,
      sizeBytes: DISK_IDENTITY_LIMIT * 3,
      fileCount: DISK_IDENTITY_LIMIT * 3,
    });
  });

  it('caps total stored identity memberships across root and row buckets', async () => {
    const f = fixture();
    const dir = f.dir(path.join(f.root, 'data'));
    for (let i = 0; i < DISK_IDENTITY_LIMIT; i++) {
      f.file(path.join(dir, `file-${i}`), 1n, { nlink: 2n });
    }
    const result = await f.run();
    expect(result).toMatchObject({
      status: 'completed',
      partial: true,
      stopReason: 'identity_limit',
    });
    expect(result.fileCount).toBeLessThanOrEqual(DISK_IDENTITY_LIMIT / 2);
    expect(result.sizeBytes).toBe(result.fileCount);
  });

  it('does not spend identity capacity again on duplicate hardlinks', async () => {
    const f = fixture();
    const dir = f.dir(path.join(f.root, 'data'));
    for (let i = 0; i < 30; i++) {
      f.file(path.join(dir, `file-${i}`), 11n, { ino: 99n, nlink: 30n });
    }
    expect(await f.run()).toMatchObject({
      sizeBytes: 11,
      fileCount: 1,
      partial: false,
      stopReason: null,
    });
  });

  it('accepts the exact safe integer boundary and serializes without bigint', async () => {
    const f = fixture();
    f.file(path.join(f.root, 'huge'), BigInt(Number.MAX_SAFE_INTEGER));
    const result = await f.run();
    expect(result).toMatchObject({
      sizeBytes: Number.MAX_SAFE_INTEGER,
      fileCount: 1,
      partial: false,
    });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('stops before byte overflow and keeps every published number safe', async () => {
    const f = fixture();
    f.file(path.join(f.root, 'huge'), BigInt(Number.MAX_SAFE_INTEGER));
    f.file(path.join(f.root, 'extra'), 1n);
    const result = await f.run();
    expect(result).toMatchObject({
      status: 'completed',
      partial: true,
      stopReason: 'numeric_limit',
    });
    for (const s of [...f.snapshots, result]) {
      for (const value of [
        s.sizeBytes,
        ...s.children.map((r) => r.sizeBytes),
      ]) {
        if (value !== null) expect(Number.isSafeInteger(value)).toBe(true);
      }
      expect(() => JSON.stringify(s)).not.toThrow();
    }
  });

  it('traverses .pnpm physically once and groups aliases without following them', async () => {
    const f = fixture('packages');
    const store = f.dir(path.join(f.root, '.pnpm'));
    const target = f.dir(path.join(store, 'pkg@1'));
    f.file(path.join(target, 'index.js'), 37n);
    const indirect = f.dir(path.join(store, 'indirect@1'));
    f.file(path.join(indirect, 'data'), 5n);
    const aliases = [
      f.link(path.join(f.root, 'pkg'), target),
      f.link(path.join(f.root, 'alias'), target),
    ];
    const result = await f.run();
    expect(result).toMatchObject({ sizeBytes: 42, fileCount: 2 });
    expect(result.children).toHaveLength(1);
    expect(result.children[0]).toMatchObject({
      canonicalPath: target,
      state: 'complete',
      sizeBytes: 37,
      fileCount: 1,
    });
    expect([...result.children[0].aliases].sort()).toEqual(['alias', 'pkg']);
    const opened = f.fs.entries.mock.calls.map(([p]) => p);
    expect(opened.filter((p) => p === target)).toHaveLength(1);
    for (const alias of aliases) expect(opened).not.toContain(alias);
  });

  it('does not report an unseen canonical package target as a zero-byte success', async () => {
    const f = fixture('packages');
    const target = f.dir(path.join(f.root, '.pnpm'));
    f.link(path.join(f.root, 'pkg'), target);
    const entries = f.fs.entries.getMockImplementation()!;
    // Target có thật lúc resolve alias nhưng biến mất khỏi lượt duyệt vật lý.
    f.fs.entries.mockImplementation(async function* (p, signal) {
      for await (const entry of entries(p, signal)) {
        if (p === f.root && entry.name === '.pnpm') continue;
        yield entry;
      }
    });
    const result = await f.run();
    expect(result.children[0]).toMatchObject({
      state: 'excluded',
      sizeBytes: null,
      fileCount: null,
    });
    expect(result.partial).toBe(true);
  });

  it('measures an empty directory as exact zero rather than pending null', async () => {
    const f = fixture();
    const empty = f.dir(path.join(f.root, 'empty'));
    const result = await f.run();
    expect(result).toMatchObject({
      sizeBytes: 0,
      fileCount: 0,
      partial: false,
    });
    expect(result.children).toEqual([
      expect.objectContaining({
        path: empty,
        state: 'complete',
        sizeBytes: 0,
        fileCount: 0,
      }),
    ]);
  });

  it('rejects a child canonical escape including a prefix-collision path', async () => {
    const f = fixture();
    const escape = f.dir(path.join(f.root, 'escape'));
    const outside = `${f.root}2`;
    f.nodes.get(f.key(escape))!.target = outside;
    const result = await f.run();
    expect(result.children[0]).toMatchObject({
      state: 'excluded',
      canonicalPath: null,
      reason: 'outside_root',
      sizeBytes: null,
    });
    expect(f.fs.entries.mock.calls.map(([p]) => p)).not.toContain(outside);
    expect(f.fs.entries.mock.calls.map(([p]) => p)).not.toContain(escape);
  });

  it.each(['lexical', 'canonical'])(
    'prunes protected %s descendants without opening their directories',
    async (mode) => {
      const f = fixture();
      const child = f.dir(path.join(f.root, 'secret'));
      const canonical = path.join(f.root, 'private');
      f.nodes.get(f.key(child))!.target = canonical;
      f.deps.isProtected = (p) =>
        f.key(p) === f.key(mode === 'lexical' ? child : canonical);
      const result = await f.run();
      expect(result.children[0]).toMatchObject({
        state: 'excluded',
        reason: 'protected',
        canonicalPath: null,
      });
      expect(f.fs.entries.mock.calls.map(([p]) => p)).toEqual([f.root]);
    },
  );

  it('does not traverse links and counts skippedLinks separately', async () => {
    const f = fixture();
    const outside = f.dir('E:\\TEST\\outside');
    const alias = f.link(path.join(f.root, 'alias'), outside);
    const result = await f.run();
    expect(result.progress.skippedLinks).toBe(1);
    expect(result.children[0]).toMatchObject({
      path: alias,
      kind: 'link',
      state: 'excluded',
      reason: 'link_skipped',
      sizeBytes: null,
    });
    expect(f.fs.entries.mock.calls.map(([p]) => p)).toEqual([f.root]);
  });

  it('walks a deep tree without recursive stack growth', async () => {
    const f = fixture();
    let leaf = f.root;
    const depth = 2500;
    for (let i = 0; i < depth; i++) leaf = f.dir(path.join(leaf, 'd'));
    f.file(path.join(leaf, 'data'), 7n);
    const result = await f.run();
    expect(result).toMatchObject({
      sizeBytes: 7,
      fileCount: 1,
      partial: false,
    });
    expect(result.progress.visitedDirs).toBe(depth + 1);
  });

  it.each<DiskView>(['directory', 'packages'])(
    '%s row limit still measures every child and keeps the 2000 largest rows',
    async (view) => {
      const f = fixture(view);
      for (let i = 0; i < 2002; i++) {
        const child = f.dir(path.join(f.root, `pkg-${i}`));
        f.file(path.join(child, 'data'), BigInt(i + 1));
      }
      const result = await f.run();
      expect(result).toMatchObject({
        status: 'completed',
        partial: true,
        stopReason: 'row_limit',
        sizeBytes: 2_005_003,
        fileCount: 2002,
      });
      expect(result.progress.visitedDirs).toBe(2003);
      expect(result.children).toHaveLength(2000);
      expect(result.children.map((row) => row.sizeBytes)).toEqual(
        Array.from({ length: 2000 }, (_, i) => 2002 - i),
      );
      expect(result.children[0]).toMatchObject({
        name: 'pkg-2001',
        state: 'complete',
        sizeBytes: 2002,
        fileCount: 1,
      });
      expect(result.children[1999]).toMatchObject({
        name: 'pkg-2',
        sizeBytes: 3,
        fileCount: 1,
      });
      const listing = f.snapshots.find(
        (snapshot) =>
          snapshot.status === 'running' && snapshot.phase === 'listing',
      );
      expect(listing?.children.map((row) => row.name)).toEqual(
        Array.from({ length: 2000 }, (_, i) => `pkg-${i}`),
      );
      expect(
        listing?.children.every(
          (row) => row.state === 'pending' && row.sizeBytes === null,
        ),
      ).toBe(true);
      for (const snapshot of f.snapshots) {
        expect(snapshot.children.length).toBeLessThanOrEqual(DISK_ROW_LIMIT);
      }
    },
  );

  it.each<DiskView>(['directory', 'packages'])(
    '%s orders equal-sized rows by name independently of listing order',
    async (view) => {
      const f = fixture(view);
      for (const name of ['zeta', 'alpha', 'middle']) {
        const child = f.dir(path.join(f.root, name));
        f.file(path.join(child, 'data'), 5n);
      }
      const result = await f.run();
      expect(result).toMatchObject({
        status: 'completed',
        partial: false,
        stopReason: null,
        sizeBytes: 15,
        fileCount: 3,
      });
      expect(result.children.map((row) => row.name)).toEqual([
        'alpha',
        'middle',
        'zeta',
      ]);
    },
  );

  it('lstats regular files but never realpaths them', async () => {
    const f = fixture();
    const nested = f.dir(path.join(f.root, 'nested'));
    const files = [
      f.file(path.join(f.root, 'top'), 7n),
      f.file(path.join(nested, 'data'), 11n),
    ];
    const result = await f.run();
    expect(result).toMatchObject({
      sizeBytes: 18,
      fileCount: 2,
      partial: false,
    });
    for (const file of files) {
      expect(f.fs.lstat.mock.calls.filter(([p]) => p === file)).toHaveLength(1);
      expect(f.fs.realpath.mock.calls.map(([p]) => p)).not.toContain(file);
    }
    expect(result.children.find((row) => row.name === 'top')).toMatchObject({
      canonicalPath: files[0],
      sizeBytes: 7,
    });
  });

  it('skips links identified by Dirent without metadata syscalls', async () => {
    const f = fixture();
    const outside = f.dir('E:\\TEST\\outside');
    f.file(path.join(outside, 'secret'), 100n);
    const alias = f.link(path.join(f.root, 'alias'), outside);
    f.file(path.join(f.root, 'good'), 7n);
    const result = await f.run();
    expect(result).toMatchObject({ sizeBytes: 7, fileCount: 1 });
    expect(result.progress.skippedLinks).toBe(1);
    expect(result.children.find((row) => row.path === alias)).toMatchObject({
      state: 'excluded',
      reason: 'link_skipped',
      canonicalPath: null,
      sizeBytes: null,
    });
    for (const path of [alias, outside]) {
      expect(f.fs.lstat.mock.calls.map(([p]) => p)).not.toContain(path);
      expect(f.fs.realpath.mock.calls.map(([p]) => p)).not.toContain(path);
    }
    expect(f.fs.entries.mock.calls.map(([p]) => p)).toEqual([f.root]);
  });

  it('realpaths directories identified by Dirent without lstat', async () => {
    const f = fixture();
    const first = f.dir(path.join(f.root, 'first'));
    const second = f.dir(path.join(first, 'second'));
    f.file(path.join(second, 'data'), 13n);
    const result = await f.run();
    expect(result).toMatchObject({
      sizeBytes: 13,
      fileCount: 1,
      partial: false,
    });
    for (const directory of [first, second]) {
      expect(f.fs.lstat.mock.calls.map(([p]) => p)).not.toContain(directory);
      expect(
        f.fs.realpath.mock.calls.filter(([p]) => p === directory),
      ).toHaveLength(1);
      expect(f.fs.entries.mock.calls.map(([p]) => p)).toContain(directory);
    }
  });

  it.each(['file', 'directory', 'link'] as const)(
    'falls back to lstat for unknown Dirent type (%s)',
    async (kind) => {
      const f = fixture();
      const entry = path.join(f.root, 'unknown');
      if (kind === 'directory') {
        f.dir(entry);
        f.file(path.join(entry, 'data'), 7n);
      } else if (kind === 'file') {
        f.file(entry, 7n);
      } else {
        f.link(entry, 'E:\\TEST\\outside');
      }
      f.nodes.get(f.key(entry))!.unknownDirent = true;
      const result = await f.run();
      expect(result).toMatchObject({
        status: 'completed',
        sizeBytes: kind === 'link' ? 0 : 7,
        fileCount: kind === 'link' ? 0 : 1,
      });
      expect(f.fs.lstat.mock.calls.filter(([p]) => p === entry)).toHaveLength(
        1,
      );
      if (kind === 'link') {
        expect(result.progress.skippedLinks).toBe(1);
        expect(f.fs.realpath.mock.calls.map(([p]) => p)).not.toContain(entry);
      }
    },
  );

  it('skips a regular file that became a link before lstat', async () => {
    const f = fixture();
    const changed = f.file(path.join(f.root, 'changed'), 100n);
    f.file(path.join(f.root, 'good'), 7n);
    const lstat = f.fs.lstat.getMockImplementation()!;
    f.fs.lstat.mockImplementation((p) =>
      p === changed
        ? Promise.resolve(
            f.stat({ ...f.nodes.get(f.key(changed))!, kind: 'link' }),
          )
        : lstat(p),
    );
    const result = await f.run();
    expect(result).toMatchObject({ sizeBytes: 7, fileCount: 1 });
    expect(result.progress.skippedLinks).toBe(1);
    expect(result.children.find((row) => row.path === changed)).toMatchObject({
      state: 'excluded',
      reason: 'link_skipped',
      sizeBytes: null,
    });
    expect(f.fs.realpath.mock.calls.map(([p]) => p)).not.toContain(changed);
  });

  it('has no entry ceiling for a wide directory below the shallow row ceiling', async () => {
    const f = fixture();
    const data = f.dir(path.join(f.root, 'data'));
    const count = 200_001;
    const entries = f.fs.entries.getMockImplementation()!;
    const lstat = f.fs.lstat.getMockImplementation()!;
    const realpath = f.fs.realpath.getMockImplementation()!;
    const fileStats = f.stat({
      ...f.nodes.get(f.key(data))!,
      kind: 'file',
      size: 1n,
      nlink: 1n,
    });
    f.fs.entries.mockImplementation(async function* (p, signal) {
      if (p !== data) {
        yield* entries(p, signal);
        return;
      }
      for (let i = 0; i < count && !signal.aborted; i++) {
        yield { ...fileStats, name: `f-${i}` } as unknown as Dirent;
      }
    });
    f.fs.lstat.mockImplementation((p) =>
      path.dirname(p) === data ? Promise.resolve(fileStats) : lstat(p),
    );
    f.fs.realpath.mockImplementation((p) =>
      path.dirname(p) === data ? Promise.resolve(p) : realpath(p),
    );
    const result = await f.run();
    expect(result).toMatchObject({
      status: 'completed',
      partial: false,
      stopReason: null,
      sizeBytes: count,
      fileCount: count,
    });
  }, 30_000);

  it.each(['ENOENT', 'EPERM', 'EACCES'])(
    'makes an unreadable child partial (%s) and still measures siblings',
    async (code) => {
      const f = fixture();
      const child = f.dir(path.join(f.root, 'child'));
      const bad = f.file(path.join(child, 'bad'), 100n);
      f.file(path.join(child, 'good'), 7n);
      const lstat = f.fs.lstat.getMockImplementation()!;
      f.fs.lstat.mockImplementation((p) =>
        p === bad ? Promise.reject(errno(code)) : lstat(p),
      );
      const result = await f.run();
      expect(result).toMatchObject({
        status: 'completed',
        partial: true,
        sizeBytes: 7,
        fileCount: 1,
      });
      expect(result.progress.skippedCount).toBeGreaterThanOrEqual(1);
      expect(result.children[0]).toMatchObject({
        state: 'partial',
        reason: 'unreadable',
        sizeBytes: 7,
      });
    },
  );

  it.each(['ENOENT', 'EPERM', 'EACCES'])(
    'fails the job when the root cannot be opened (%s)',
    async (code) => {
      const f = fixture();
      f.fs.entries.mockImplementation(async function* () {
        yield* [];
        await Promise.reject(errno(code));
      });
      expect(await f.run()).toMatchObject({
        status: 'failed',
        partial: true,
        failureCode: code === 'ENOENT' ? 'NOT_FOUND' : 'FORBIDDEN',
      });
    },
  );

  it.each([{ ino: 0n, nlink: 2n }, { ino: -1n, nlink: 2n }, { nlink: 0n }])(
    'skips unavailable identity %s and marks the row partial',
    async (invalid) => {
      const f = fixture();
      f.file(path.join(f.root, 'invalid'), 10n, invalid);
      const result = await f.run();
      expect(result).toMatchObject({
        partial: true,
        sizeBytes: 0,
        fileCount: 0,
      });
      expect(result.progress.skippedCount).toBe(1);
      expect(result.children[0]).toMatchObject({
        state: 'partial',
        reason: 'identity_unavailable',
      });
    },
  );

  it('skips special files rather than counting their metadata size', async () => {
    const f = fixture();
    f.special(path.join(f.root, 'pipe'));
    const result = await f.run();
    expect(result).toMatchObject({ partial: true, sizeBytes: 0, fileCount: 0 });
    expect(result.children[0]).toMatchObject({ reason: 'unsupported' });
  });

  it('completes a long walk without a default timeout', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    const f = fixture();
    const child = f.dir(path.join(f.root, 'slow'));
    f.file(path.join(child, 'data'), 9n);
    const gate = deferred<void>();
    const entries = f.fs.entries.getMockImplementation()!;
    f.fs.entries.mockImplementation(async function* (p, signal) {
      if (p === child) await gate.promise;
      yield* entries(p, signal);
    });
    const pending = f.run();
    try {
      await settle();
      await jest.advanceTimersByTimeAsync(120_000);
      expect(f.snapshots.every((s) => s.status === 'running')).toBe(true);
    } finally {
      gate.resolve();
    }
    expect(await pending).toMatchObject({
      status: 'completed',
      sizeBytes: 9,
      partial: false,
      stopReason: null,
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('returns cancelled immediately while IO is pending and ignores late success', async () => {
    const f = fixture();
    const child = f.dir(path.join(f.root, 'slow'));
    const gate = deferred<void>();
    const realpath = f.fs.realpath.getMockImplementation()!;
    f.fs.realpath.mockImplementation(async (p) => {
      if (p === child) await gate.promise;
      return realpath(p);
    });
    const pending = f.run();
    try {
      await settle();
      expect(f.fs.realpath.mock.calls.map(([p]) => p)).toContain(child);
      f.controller.abort();
      let result: IDiskUsageJob | undefined;
      void pending.then((value) => (result = value)).catch(() => undefined);
      await settle();
      expect(result).toMatchObject({
        status: 'cancelled',
        partial: true,
        stopReason: 'cancelled',
      });
      const frozen = structuredClone(result);
      const callbacks = f.onSnapshot.mock.calls.length;
      gate.resolve();
      await settle();
      expect(result).toEqual(frozen);
      expect(f.onSnapshot).toHaveBeenCalledTimes(callbacks);
      expect(f.fs.entries.mock.calls.map(([p]) => p)).not.toContain(child);
    } finally {
      gate.resolve();
    }
    await pending;
  });

  it('catches late IO rejection after cancellation without a second terminal snapshot', async () => {
    const f = fixture();
    const child = f.dir(path.join(f.root, 'slow'));
    const gate = deferred<string>();
    const realpath = f.fs.realpath.getMockImplementation()!;
    f.fs.realpath.mockImplementation((p) =>
      p === child ? gate.promise : realpath(p),
    );
    const pending = f.run();
    try {
      await settle();
      expect(f.fs.realpath.mock.calls.map(([p]) => p)).toContain(child);
      f.controller.abort();
      let done = false;
      void pending.then(() => (done = true)).catch(() => undefined);
      await settle();
      expect(done).toBe(true);
      const callbacks = f.onSnapshot.mock.calls.length;
      gate.reject(errno('EACCES'));
      await settle();
      expect(f.onSnapshot).toHaveBeenCalledTimes(callbacks);
    } finally {
      gate.resolve(child);
    }
    expect((await pending).status).toBe('cancelled');
  });

  it('does no IO for an already cancelled walk', async () => {
    const f = fixture();
    f.controller.abort();
    expect(await f.run()).toMatchObject({
      status: 'cancelled',
      partial: true,
      stopReason: 'cancelled',
    });
    expect(f.fs.entries).not.toHaveBeenCalled();
    expect(f.fs.lstat).not.toHaveBeenCalled();
    expect(f.fs.realpath).not.toHaveBeenCalled();
  });

  it('does not mutate the input or let callback consumers alter accounting', async () => {
    const f = fixture();
    f.file(path.join(f.root, 'data'), 9n);
    const original = structuredClone(f.initial);
    f.deps.onSnapshot = (snapshot) => {
      try {
        snapshot.sizeBytes = 999;
        snapshot.children.length = 0;
        snapshot.progress.skippedCount = 999;
      } catch (error) {
        // Bản sao đóng băng cũng là một cách hợp lệ để bảo vệ snapshot.
        expect(error).toBeInstanceOf(TypeError);
      }
    };
    const result = await f.run();
    expect(result).toMatchObject({
      sizeBytes: 9,
      fileCount: 1,
      partial: false,
    });
    expect(result.children).toHaveLength(1);
    expect(result.progress.skippedCount).toBe(0);
    expect(f.initial).toEqual(original);
  });

  it('throttles running snapshots instead of publishing once per file', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    const f = fixture();
    const child = f.dir(path.join(f.root, 'data'));
    for (let i = 0; i < 100; i++) f.file(path.join(child, `f-${i}`), 1n);
    const result = await f.run();
    expect(result).toMatchObject({ status: 'completed', sizeBytes: 100 });
    const running = f.snapshots.filter((s) => s.status === 'running');
    expect(running.length).toBeGreaterThanOrEqual(1);
    expect(running.length).toBeLessThanOrEqual(2);
    expect(f.snapshots.filter((s) => s.status === 'completed')).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('createDiskFs metadata adapter', () => {
  const root = 'D:\\TEST\\node_modules';
  const raw = jest.mocked(nodeFs);

  beforeEach(() => jest.resetAllMocks());

  const handle = (read: () => Promise<Dirent | null>) => {
    const close = jest.fn(() => Promise.resolve());
    const readMock = jest.fn(read);
    return {
      dir: { read: readMock, close } as unknown as Dir,
      read: readMock,
      close,
    };
  };

  it('uses bigint lstat and realpath without reading file contents', async () => {
    const adapter = createDiskFs();
    const stats = { ino: 2n ** 53n + 1n } as BigIntStats;
    raw.lstat.mockResolvedValue(stats);
    raw.realpath.mockResolvedValue(root);
    expect(await adapter.lstat(root)).toBe(stats);
    expect(raw.lstat).toHaveBeenCalledWith(root, { bigint: true });
    expect(await adapter.realpath(root)).toBe(root);
  });

  it('streams entries and closes opendir on normal exhaustion', async () => {
    const first = { name: 'data' } as Dirent;
    const read = jest
      .fn<Promise<Dirent | null>, []>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(null);
    const h = handle(read);
    raw.opendir.mockResolvedValue(h.dir);
    const adapter = createDiskFs();
    const entries: Dirent[] = [];
    for await (const entry of adapter.entries(
      root,
      new AbortController().signal,
    )) {
      entries.push(entry);
    }
    expect(entries).toEqual([first]);
    expect(raw.opendir.mock.calls[0][0]).toBe(root);
    expect(h.close).toHaveBeenCalledTimes(1);
  });

  it('closes the directory when the consumer stops a streaming listing early', async () => {
    const h = handle(() => Promise.resolve({ name: 'one' } as Dirent));
    raw.opendir.mockResolvedValue(h.dir);
    const adapter = createDiskFs();
    for await (const entry of adapter.entries(
      root,
      new AbortController().signal,
    )) {
      expect(entry.name).toBe('one');
      break;
    }
    expect(h.close).toHaveBeenCalledTimes(1);
  });

  it('closes the handle after a read error', async () => {
    const h = handle(() => Promise.reject(errno('EACCES')));
    raw.opendir.mockResolvedValue(h.dir);
    const iterator = createDiskFs().entries(root, new AbortController().signal);
    await expect(iterator[Symbol.asyncIterator]().next()).rejects.toMatchObject(
      {
        code: 'EACCES',
      },
    );
    expect(h.close).toHaveBeenCalledTimes(1);
  });

  it('opens nothing when the signal was already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const iterator = createDiskFs().entries(root, controller.signal);
    expect(await iterator[Symbol.asyncIterator]().next()).toMatchObject({
      done: true,
    });
    expect(raw.opendir).not.toHaveBeenCalled();
  });

  it('closes a late opendir handle after abort without yielding an entry', async () => {
    const gate = deferred<Dir>();
    raw.opendir.mockReturnValue(gate.promise);
    const controller = new AbortController();
    const iterator = createDiskFs()
      .entries(root, controller.signal)
      [Symbol.asyncIterator]();
    const next = iterator.next();
    void next.catch(() => undefined);
    try {
      await settle();
      expect(raw.opendir).toHaveBeenCalledTimes(1);
      controller.abort();
    } finally {
      const h = handle(() => Promise.resolve(null));
      gate.resolve(h.dir);
      await next;
      expect(h.close).toHaveBeenCalledTimes(1);
      expect(h.read).not.toHaveBeenCalled();
    }
  });

  it('closes after an aborted pending read settles and does not yield late data', async () => {
    const gate = deferred<Dirent | null>();
    const h = handle(() => gate.promise);
    raw.opendir.mockResolvedValue(h.dir);
    const controller = new AbortController();
    const iterator = createDiskFs()
      .entries(root, controller.signal)
      [Symbol.asyncIterator]();
    const next = iterator.next();
    void next.catch(() => undefined);
    try {
      await settle();
      expect(h.read).toHaveBeenCalledTimes(1);
      controller.abort();
    } finally {
      gate.resolve({ name: 'late' } as Dirent);
    }
    expect(await next).toMatchObject({ done: true });
    expect(h.close).toHaveBeenCalledTimes(1);
  });

  it('shares permits between opendir reads, lstat and realpath', async () => {
    const gate = deferred<Dirent | null>();
    const handles = Array.from({ length: 8 }, () => handle(() => gate.promise));
    for (const h of handles) raw.opendir.mockResolvedValueOnce(h.dir);
    const adapter = createDiskFs();
    const controller = new AbortController();
    const reads = handles.map(() =>
      adapter.entries(root, controller.signal)[Symbol.asyncIterator]().next(),
    );
    for (const read of reads) void read.catch(() => undefined);
    raw.lstat.mockResolvedValue({ ino: 1n } as BigIntStats);
    raw.realpath.mockResolvedValue(root);
    let metadata: Promise<unknown>[] = [];
    try {
      await settle();
      expect(handles.every((h) => h.read.mock.calls.length === 1)).toBe(true);
      metadata = [adapter.lstat(root), createDiskFs().realpath(root)];
      await settle();
      expect(raw.lstat).not.toHaveBeenCalled();
      expect(raw.realpath).not.toHaveBeenCalled();
    } finally {
      gate.resolve(null);
      await Promise.all([...reads, ...metadata]);
    }
    expect(raw.lstat).toHaveBeenCalledTimes(1);
    expect(raw.realpath).toHaveBeenCalledTimes(1);
    for (const h of handles) expect(h.close).toHaveBeenCalledTimes(1);
  });

  it('shares eight metadata permits between adapters until actual IO settles', async () => {
    expect(DISK_CONCURRENCY).toBe(8);
    const first = createDiskFs();
    const second = createDiskFs();
    const gate = deferred<BigIntStats>();
    let active = 0;
    let maximum = 0;
    raw.lstat.mockImplementation(() => {
      active++;
      maximum = Math.max(maximum, active);
      return gate.promise.finally(() => active--);
    });
    const pending = Array.from({ length: 20 }, (_, i) =>
      (i % 2 ? first : second).lstat(path.join(root, `${i}`)),
    );
    try {
      await settle();
      expect(raw.lstat).toHaveBeenCalledTimes(8);
      expect(maximum).toBe(8);
    } finally {
      gate.resolve({ ino: 1n } as BigIntStats);
      await Promise.all(pending);
    }
    expect(maximum).toBeLessThanOrEqual(8);
    expect(raw.lstat).toHaveBeenCalledTimes(20);
  });

  it('retains all old permits after job abort so a new adapter cannot bypass the cap', async () => {
    const gate = deferred<void>();
    const handles = Array.from({ length: 8 }, () =>
      handle(() => Promise.resolve(null)),
    );
    for (const h of handles) {
      raw.opendir.mockImplementationOnce(() => gate.promise.then(() => h.dir));
    }
    const controller = new AbortController();
    const adapter = createDiskFs();
    const iterators = Array.from({ length: 8 }, () =>
      adapter.entries(root, controller.signal)[Symbol.asyncIterator](),
    );
    const old = iterators.map((it) => it.next());
    for (const promise of old) void promise.catch(() => undefined);
    let fresh: Promise<string> | undefined;
    try {
      await settle();
      expect(raw.opendir).toHaveBeenCalledTimes(8);
      controller.abort();
      raw.realpath.mockResolvedValue(root);
      fresh = createDiskFs().realpath(root);
      await settle();
      expect(raw.realpath).not.toHaveBeenCalled();
    } finally {
      gate.resolve();
      await Promise.allSettled(old);
      if (fresh) await fresh;
    }
    expect(raw.realpath).toHaveBeenCalledTimes(1);
    for (const h of handles) expect(h.close).toHaveBeenCalledTimes(1);
  });
});
