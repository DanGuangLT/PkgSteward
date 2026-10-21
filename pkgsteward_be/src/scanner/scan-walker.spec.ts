import type { Dirent } from 'node:fs';
import { pathApi, toComparable } from '@/common/utils/path.util';
import type { PathPlatform } from '@/common/utils/path.util';
import type {
  IScanFs,
  IScanProgress,
  IWalkerDeps,
  IWalkSnapshot,
} from '@/scanner/interfaces/scanner.types';
import { SCAN_CONCURRENCY, walkScan } from '@/scanner/scan-walker';

const errno = (code: string) => Object.assign(new Error(code), { code });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

const fixture = (platform: PathPlatform = 'win32') => {
  const api = pathApi(platform);
  const root = platform === 'win32' ? 'D:\\Scan' : '/scan';
  const key = (p: string) => toComparable(p, platform);
  type Node = {
    kind: string;
    content: string;
    target?: string;
    children: Map<string, string>;
  };
  const nodes = new Map<string, Node>();
  const stats = (node: Node) => ({
    mtimeMs: 1000,
    isFile: () => node.kind === 'file',
    isDirectory: () => node.kind === 'directory',
    isSymbolicLink: () => node.kind === 'link',
  });
  const add = (p: string, kind: string, content = '', target?: string) => {
    nodes.set(key(p), { kind, content, target, children: new Map() });
    if (key(api.dirname(p)) !== key(p)) {
      nodes.get(key(api.dirname(p)))?.children.set(api.basename(p), p);
    }
    return p;
  };
  const dir = (p: string) => add(p, 'directory');
  const file = (p: string, content = '{"name":"app"}') =>
    add(p, 'file', content);
  const link = (p: string, target: string) => add(p, 'link', '', target);
  const get = (p: string) => {
    const node = nodes.get(key(p));
    if (!node) throw errno('ENOENT');
    return node;
  };
  const fs: jest.Mocked<IScanFs> = {
    lstat: jest.fn((p) => Promise.resolve(stats(get(p)))),
    realpath: jest.fn((p) => Promise.resolve(get(p).target ?? api.resolve(p))),
    readdir: jest.fn((p) => {
      const node = get(p);
      if (node.kind !== 'directory') return Promise.reject(errno('ENOTDIR'));
      return Promise.resolve(
        Array.from(
          node.children,
          ([name, child]) =>
            ({ name, ...stats(get(child)) }) as unknown as Dirent,
        ),
      );
    }),
    readFile: jest.fn((p) => Promise.resolve(get(p).content)),
  };
  const onProgress = jest.fn<void, [IScanProgress]>();
  const onSkipped = jest.fn<void, [string, unknown]>();
  const deps: IWalkerDeps = {
    platform,
    fs,
    isInsideProtectedTree: jest.fn(() => Promise.resolve(false)),
    onProgress,
    onSkipped,
  };
  const controller = new AbortController();
  const run = (roots: readonly string[] = [root], maxDepth = 0) =>
    walkScan(roots, maxDepth, controller.signal, deps);
  dir(root);
  const guardCalls = () =>
    (deps.isInsideProtectedTree as jest.Mock).mock.calls as string[][];
  return {
    api,
    root,
    key,
    nodes,
    dir,
    file,
    link,
    fs,
    deps,
    onProgress,
    onSkipped,
    guardCalls,
    controller,
    run,
  };
};

describe('walkScan', () => {
  it('prunes named children, links, junctions and protected trees without counting skips', async () => {
    const f = fixture();
    const pruned = [
      'node_modules',
      'NODE_MODULES',
      'dist',
      'DIST',
      '.next',
      '.NEXT',
      '.cache',
      '.git',
      'AppData',
      'appDATA',
      'protected',
    ];
    for (const name of pruned) {
      const p = f.dir(f.api.join(f.root, name));
      f.file(f.api.join(p, 'package.json'));
    }
    const external = f.dir('E:\\external');
    f.file(f.api.join(external, 'package.json'));
    f.link(f.api.join(f.root, 'symlink'), external);
    f.link(f.api.join(f.root, 'junction'), external);
    const good = f.dir(f.api.join(f.root, 'good'));
    f.file(f.api.join(good, 'package.json'));
    f.deps.isInsideProtectedTree = jest.fn((p) =>
      Promise.resolve(p.endsWith('protected')),
    );
    const result = await f.run();
    expect(f.fs.readdir.mock.calls.map(([p]) => p)).toEqual([f.root, good]);
    expect(result.projects.map((p) => p.path)).toEqual([good]);
    expect(result.progress).toEqual({
      visitedDirs: 2,
      foundProjects: 1,
      skippedCount: 0,
    });
    expect(f.onSkipped.mock.calls).toHaveLength(0);
  });

  it.each(['D:\\', 'C:\\Users', 'C:\\Users\\alice', 'D:\\.projects'])(
    'allows configured root exception %s',
    async (root) => {
      const f = fixture();
      f.dir(root);
      f.file(f.api.join(root, 'package.json'));
      const result = await f.run([root]);
      expect(result.roots).toEqual([root]);
      expect(result.projects[0].path).toBe(root);
    },
  );

  it('prunes protected roots before reading them', async () => {
    const f = fixture();
    f.deps.isInsideProtectedTree = jest.fn(() => Promise.resolve(true));
    const result = await f.run();
    expect(result.roots).toEqual([]);
    expect(result.progress.skippedCount).toBe(0);
    expect(f.fs.readdir.mock.calls).toHaveLength(0);
  });

  it('follows a configured junction root using its canonical target', async () => {
    const f = fixture();
    const target = f.dir('E:\\Projects');
    f.file(f.api.join(target, 'package.json'));
    f.link('D:\\alias', target);
    const result = await f.run(['D:/alias/']);
    expect(result.roots).toEqual([target]);
    expect(result.projects[0].path).toBe(target);
    expect(f.fs.readdir.mock.calls).toEqual([[target]]);
  });

  it('checks protection on both lexical and canonical root and child paths', async () => {
    const f = fixture();
    const target = f.dir('E:\\Protected');
    f.link('D:\\alias', target);
    const child = f.dir(f.api.join(f.root, 'short-name'));
    const realpath = f.fs.realpath.getMockImplementation()!;
    f.fs.realpath.mockImplementation((p) =>
      p === child ? Promise.resolve(target) : realpath(p),
    );
    f.deps.isInsideProtectedTree = jest.fn((p) =>
      Promise.resolve(p === target),
    );
    const result = await f.run(['D:\\alias', f.root]);
    expect(result.roots).toEqual([f.root]);
    expect(f.fs.readdir.mock.calls).toEqual([[f.root]]);
    expect(f.guardCalls()).toContainEqual([child]);
    expect(f.guardCalls()).toContainEqual([target]);
  });

  it('rechecks child links with lstat after readdir', async () => {
    const f = fixture();
    const child = f.dir(f.api.join(f.root, 'changed'));
    const lstat = f.fs.lstat.getMockImplementation()!;
    f.fs.lstat.mockImplementation((p) =>
      p === child
        ? Promise.resolve({
            mtimeMs: 0,
            isFile: () => false,
            isDirectory: () => false,
            isSymbolicLink: () => true,
          })
        : lstat(p),
    );
    expect((await f.run()).progress.skippedCount).toBe(0);
    expect(f.fs.readdir.mock.calls).toEqual([[f.root]]);
  });

  it('handles unlimited deep trees without recursion', async () => {
    const f = fixture();
    let deepest = f.root;
    for (let i = 0; i < 1200; i++) deepest = f.dir(f.api.join(deepest, 'd'));
    f.file(f.api.join(deepest, 'package.json'));
    const result = await f.run();
    expect(result.projects[0].path).toBe(deepest);
    expect(result.progress.visitedDirs).toBe(1201);
  });

  it('inspects metadata at depth 0 and 1 but does not enter depth 2', async () => {
    const f = fixture();
    const one = f.dir(f.api.join(f.root, 'one'));
    const two = f.dir(f.api.join(one, 'two'));
    for (const p of [f.root, one, two]) f.file(f.api.join(p, 'package.json'));
    f.dir(f.api.join(one, 'node_modules'));
    const result = await f.run([f.root], 1);
    expect(result.projects.map((p) => p.path).sort()).toEqual(
      [f.root, one].sort(),
    );
    expect(
      result.projects.find((p) => p.path === one)?.nodeModules.exists,
    ).toBe(true);
    expect(f.fs.readdir.mock.calls.map(([p]) => p)).toEqual([f.root, one]);
  });

  it('finds monorepo parents, children and orphans without entering node_modules', async () => {
    const f = fixture();
    const child = f.dir(f.api.join(f.root, 'child'));
    const abandoned = f.dir(f.api.join(f.root, 'abandoned'));
    for (const p of [f.root, child]) {
      f.file(f.api.join(p, 'package.json'));
      f.dir(f.api.join(p, 'node_modules'));
    }
    const orphan = f.dir(f.api.join(abandoned, 'node_modules'));
    const result = await f.run();
    expect(result.projects.map((p) => p.path).sort()).toEqual(
      [f.root, child].sort(),
    );
    expect(result.orphanNodeModules).toEqual([
      { path: orphan, sizeBytes: null, mtime: new Date(1000).toISOString() },
    ]);
    expect(
      f.fs.readdir.mock.calls.some(([p]) => p.endsWith('node_modules')),
    ).toBe(false);
  });

  it('deduplicates canonical roots and results while preserving overlapping root depth', async () => {
    const f = fixture();
    const one = f.dir(f.api.join(f.root, 'one'));
    const two = f.dir(f.api.join(one, 'two'));
    const three = f.dir(f.api.join(two, 'three'));
    for (const p of [f.root, one, two, three])
      f.file(f.api.join(p, 'package.json'));
    const abandoned = f.dir(f.api.join(one, 'abandoned'));
    f.dir(f.api.join(abandoned, 'node_modules'));
    f.link('E:\\alias', f.root);
    const result = await f.run(
      [f.root, 'd:/SCAN/', 'E:\\alias', one, abandoned],
      1,
    );
    expect(result.roots.sort()).toEqual([f.root, one, abandoned].sort());
    expect(result.projects.map((p) => p.path).sort()).toEqual(
      [f.root, one, two].sort(),
    );
    expect(result.orphanNodeModules).toHaveLength(1);
    expect(result.progress.foundProjects).toBe(3);
    expect(
      f.fs.readdir.mock.calls.filter(([p]) => f.key(p) === f.key(f.root)),
    ).toHaveLength(1);
  });

  it('uses posix paths and keeps case-distinct roots and projects', async () => {
    const f = fixture('posix');
    for (const name of ['a', 'A']) {
      const p = f.dir(f.api.join(f.root, name));
      f.file(f.api.join(p, 'package.json'));
    }
    const result = await f.run();
    expect(result.projects.map((p) => p.path).sort()).toEqual([
      '/scan/A',
      '/scan/a',
    ]);
    expect(
      result.projects.every((p) =>
        p.nodeModules.path.endsWith('/node_modules'),
      ),
    ).toBe(true);
  });

  it.each(['realpath', 'lstat', 'readdir', 'readFile'] as const)(
    'isolates a directory %s failure, counts one skip and continues siblings',
    async (operation) => {
      const f = fixture();
      const bad = f.dir(f.api.join(f.root, 'bad'));
      const good = f.dir(f.api.join(f.root, 'good'));
      f.file(f.api.join(bad, 'package.json'));
      f.dir(f.api.join(bad, 'node_modules'));
      f.file(f.api.join(good, 'package.json'));
      const original = f.fs[operation].getMockImplementation()!;
      const error = errno('EPERM');
      // Các chữ ký có tham số khác nhau; delegate riêng để giữ mock đúng type.
      if (operation === 'readFile') {
        const read = f.fs.readFile.getMockImplementation()!;
        f.fs.readFile.mockImplementation((p, s) =>
          p.startsWith(bad) ? Promise.reject(error) : read(p, s),
        );
      } else if (operation === 'lstat') {
        const read = f.fs.lstat.getMockImplementation()!;
        f.fs.lstat.mockImplementation((p) =>
          p === f.api.join(bad, 'package.json')
            ? Promise.reject(error)
            : read(p),
        );
      } else {
        // realpath và readdir được mock riêng bên dưới.
        if (operation === 'realpath') {
          const read = f.fs.realpath.getMockImplementation()!;
          f.fs.realpath.mockImplementation((p) =>
            p === bad ? Promise.reject(error) : read(p),
          );
        } else {
          const read = f.fs.readdir.getMockImplementation()!;
          f.fs.readdir.mockImplementation((p) =>
            p === bad ? Promise.reject(error) : read(p),
          );
        }
      }
      expect(original).toBeDefined();
      const result = await f.run();
      expect(result.progress).toEqual({
        visitedDirs: operation === 'lstat' || operation === 'readFile' ? 3 : 2,
        foundProjects: 1,
        skippedCount: 1,
      });
      expect(result.projects[0].path).toBe(good);
      expect(result.orphanNodeModules).toEqual([]);
      expect(f.onSkipped.mock.calls).toEqual([[bad, error]]);
    },
  );

  it('skips a missing root once and omits roots whose readdir fails', async () => {
    const f = fixture();
    const denied = f.dir('E:\\denied');
    const read = f.fs.readdir.getMockImplementation()!;
    f.fs.readdir.mockImplementation((p) =>
      p === denied ? Promise.reject(errno('EACCES')) : read(p),
    );
    const result = await f.run(['E:\\missing', denied, f.root]);
    expect(result.roots).toEqual([f.root]);
    expect(result.progress).toEqual({
      visitedDirs: 1,
      foundProjects: 0,
      skippedCount: 2,
    });
    expect(f.onSkipped.mock.calls).toHaveLength(2);
  });

  it.each([false, true])(
    'keeps traversing valid children after metadata fails (root=%s)',
    async (failureAtRoot) => {
      const f = fixture();
      const bad = failureAtRoot ? f.root : f.dir(f.api.join(f.root, 'bad'));
      const child = f.dir(f.api.join(bad, 'child'));
      const tooDeep = f.dir(f.api.join(child, 'too-deep'));
      f.file(f.api.join(bad, 'package.json'));
      f.dir(f.api.join(bad, 'node_modules'));
      f.file(f.api.join(child, 'package.json'));
      f.file(f.api.join(tooDeep, 'package.json'));
      const read = f.fs.readFile.getMockImplementation()!;
      const error = errno('EPERM');
      f.fs.readFile.mockImplementation((p, s) =>
        p === f.api.join(bad, 'package.json')
          ? Promise.reject(error)
          : read(p, s),
      );

      const result = await f.run([f.root], failureAtRoot ? 1 : 2);

      expect(result.roots).toEqual([f.root]);
      expect(result.progress).toEqual({
        visitedDirs: failureAtRoot ? 2 : 3,
        foundProjects: 1,
        skippedCount: 1,
      });
      expect(result.projects.map((project) => project.path)).toEqual([child]);
      expect(result.orphanNodeModules).toEqual([]);
      expect(f.fs.readdir.mock.calls).toContainEqual([child]);
      expect(f.fs.readdir.mock.calls).not.toContainEqual([tooDeep]);
      expect(f.fs.readdir.mock.calls).not.toContainEqual([
        f.api.join(bad, 'node_modules'),
      ]);
      expect(f.onSkipped.mock.calls).toEqual([[bad, error]]);
    },
  );

  it('still fails the job when a child guard rejects after parent metadata fails', async () => {
    const f = fixture();
    const child = f.dir(f.api.join(f.root, 'child'));
    f.file(f.api.join(f.root, 'package.json'));
    const error = new Error('guard unavailable');
    f.fs.readFile.mockRejectedValue(errno('EPERM'));
    f.deps.isInsideProtectedTree = jest.fn((p) =>
      p === child ? Promise.reject(error) : Promise.resolve(false),
    );

    await expect(f.run()).rejects.toBe(error);
    expect(f.onSkipped.mock.calls).toHaveLength(1);
  });

  it('compacts consumed queue entries during a wide scan', async () => {
    const f = fixture();
    for (let i = 0; i < 1200; i++) f.dir(f.api.join(f.root, `child${i}`));
    const splice = jest.spyOn(Array.prototype, 'splice');
    try {
      const result = await f.run();
      expect(result.progress.visitedDirs).toBe(1201);
      // Chỉ số đã lấy ra phải được xoá khỏi mảng, không giữ đến cuối lượt quét.
      expect(
        splice.mock.calls.some(
          ([start, count]) => start === 0 && count >= 1024,
        ),
      ).toBe(true);
    } finally {
      splice.mockRestore();
    }
  });

  it.each(['readdir', 'readFile'] as const)(
    'bounds workers across pending %s IO',
    async (operation) => {
      const f = fixture();
      for (let i = 0; i < 24; i++) {
        const p = f.dir(f.api.join(f.root, `child${i}`));
        f.file(f.api.join(p, 'package.json'));
      }
      const gate = deferred<void>();
      let active = 0;
      let peak = 0;
      const blocked = async <T>(read: () => Promise<T>) => {
        active++;
        peak = Math.max(peak, active);
        await gate.promise;
        try {
          return await read();
        } finally {
          active--;
        }
      };
      if (operation === 'readdir') {
        const read = f.fs.readdir.getMockImplementation()!;
        f.fs.readdir.mockImplementation((p) =>
          p === f.root ? read(p) : blocked(() => read(p)),
        );
      } else {
        const read = f.fs.readFile.getMockImplementation()!;
        f.fs.readFile.mockImplementation((p, s) => blocked(() => read(p, s)));
      }
      const pending = f.run();
      await settle();
      expect(SCAN_CONCURRENCY).toBe(8);
      expect(active).toBe(8);
      gate.resolve();
      expect((await pending).projects).toHaveLength(24);
      expect(peak).toBe(8);
    },
  );

  it('aborts before work without IO or callbacks', async () => {
    const f = fixture();
    f.controller.abort();
    const result = await f.run();
    expect(result.progress).toEqual({
      visitedDirs: 0,
      foundProjects: 0,
      skippedCount: 0,
    });
    for (const mock of Object.values(f.fs)) expect(mock).not.toHaveBeenCalled();
    expect(f.onProgress.mock.calls).toHaveLength(0);
    expect(f.guardCalls()).toHaveLength(0);
  });

  it.each(['guard', 'realpath', 'lstat', 'readdir', 'readFile'] as const)(
    'aborts during %s and freezes snapshot without waiting for stuck IO',
    async (operation) => {
      const f = fixture();
      const child = f.dir(f.api.join(f.root, 'child'));
      f.file(f.api.join(child, 'package.json'));
      const gate = deferred<void>();
      if (operation === 'guard') {
        f.deps.isInsideProtectedTree = jest.fn(async () => {
          await gate.promise;
          return false;
        });
      } else if (operation === 'realpath') {
        const read = f.fs.realpath.getMockImplementation()!;
        f.fs.realpath.mockImplementation(async (p) => {
          await gate.promise;
          return read(p);
        });
      } else if (operation === 'lstat') {
        const read = f.fs.lstat.getMockImplementation()!;
        f.fs.lstat.mockImplementation(async (p) => {
          await gate.promise;
          return read(p);
        });
      } else if (operation === 'readdir') {
        const read = f.fs.readdir.getMockImplementation()!;
        f.fs.readdir.mockImplementation(async (p) => {
          await gate.promise;
          return read(p);
        });
      } else {
        const read = f.fs.readFile.getMockImplementation()!;
        f.fs.readFile.mockImplementation(async (p, s) => {
          await gate.promise;
          return read(p, s);
        });
      }
      const pending = f.run();
      await settle();
      f.controller.abort();
      const result = await pending;
      const before = structuredClone(result);
      const ioCounts = () => [
        f.fs.readdir.mock.calls.length,
        f.fs.lstat.mock.calls.length,
        f.fs.realpath.mock.calls.length,
        f.fs.readFile.mock.calls.length,
      ];
      const counts = ioCounts();
      const progressCount = f.onProgress.mock.calls.length;
      gate.resolve();
      await settle();
      expect(result).toEqual(before);
      expect(ioCounts()).toEqual(counts);
      expect(f.onProgress.mock.calls).toHaveLength(progressCount);
      expect(f.onSkipped.mock.calls).toHaveLength(0);
    },
  );

  it('catches a late IO rejection after abort', async () => {
    const f = fixture();
    const gate = deferred<Dirent[]>();
    f.fs.readdir.mockReturnValue(gate.promise);
    const pending = f.run();
    await settle();
    f.controller.abort();
    const result = await pending;
    gate.reject(errno('EPERM'));
    await settle();
    expect(result.progress.skippedCount).toBe(0);
    expect(f.onSkipped.mock.calls).toHaveLength(0);
  });

  it.each([false, true])(
    'fails closed when protected callback rejects (canonical=%s)',
    async (canonical) => {
      const f = fixture();
      const error = new Error('guard unavailable');
      const guard = jest.fn(() => Promise.resolve(false));
      if (canonical)
        guard.mockResolvedValueOnce(false).mockRejectedValueOnce(error);
      else guard.mockRejectedValueOnce(error);
      f.deps.isInsideProtectedTree = guard;
      await expect(f.run()).rejects.toBe(error);
      expect(f.fs.readdir.mock.calls).toHaveLength(0);
      expect(f.onSkipped.mock.calls).toHaveLength(0);
    },
  );

  it('publishes independent counter-only progress and returns the full snapshot once', async () => {
    const f = fixture();
    f.file(f.api.join(f.root, 'package.json'));
    f.dir(f.api.join(f.root, 'child'));
    const progress: IScanProgress[] = [];
    f.deps.onProgress = (counters) => {
      progress.push(counters);
    };
    const clone = jest.spyOn(globalThis, 'structuredClone');
    let result!: IWalkSnapshot;
    try {
      result = await f.run();
      expect(clone).toHaveBeenCalledTimes(1);
    } finally {
      clone.mockRestore();
    }
    expect(progress).toEqual([
      { visitedDirs: 1, foundProjects: 1, skippedCount: 0 },
      { visitedDirs: 2, foundProjects: 1, skippedCount: 0 },
    ]);
    progress[0].visitedDirs = 999;
    expect(progress[1].visitedDirs).toBe(2);
    expect(result.progress.visitedDirs).toBe(2);
    expect(result.projects[0].name).toBe('app');
    expect(result.projects[0].nodeModules.exists).toBe(false);
    expect(result.roots).toEqual([f.root]);
  });
});
