import type { BigIntStats, Dirent } from 'node:fs';
import { win32 as path } from 'node:path';
import {
  DISK_ROW_LIMIT,
  listPackageTargets,
} from '@/disk-usage/packages/disk-usage-packages';
import type {
  IDiskFs,
  IDiskWalkDeps,
} from '@/disk-usage/interfaces/disk-usage.types';

const errno = (code: string) => Object.assign(new Error(code), { code });

const fixture = () => {
  const root = 'D:\\TEST\\node_modules';
  const key = (p: string) => path.resolve(p).toLowerCase();
  interface INode {
    kind: 'directory' | 'file' | 'link';
    unknownDirent?: boolean;
    target?: string;
    error?: string;
    children: string[];
  }
  const nodes = new Map<string, INode>();
  const add = (p: string, kind: INode['kind'], target?: string) => {
    nodes.set(key(p), { kind, target, children: [] });
    nodes.get(key(path.dirname(p)))?.children.push(p);
    return p;
  };
  const get = (p: string) => {
    const node = nodes.get(key(p));
    if (!node) throw errno('ENOENT');
    return node;
  };
  const kindStats = (node: INode) => ({
    isDirectory: () => node.kind === 'directory',
    isFile: () => node.kind === 'file',
    isSymbolicLink: () => node.kind === 'link',
  });
  const fs = {
    entries: jest.fn(async function* (
      p: string,
      signal: AbortSignal,
    ): AsyncGenerator<Dirent> {
      await Promise.resolve();
      const node = get(p);
      if (node.error) throw errno(node.error);
      for (const child of node.children) {
        if (signal.aborted) return;
        const childNode = get(child);
        yield {
          name: path.basename(child),
          parentPath: p,
          ...kindStats(childNode),
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isFIFO: () => false,
          isSocket: () => false,
          ...(childNode.unknownDirent
            ? {
                isDirectory: () => false,
                isFile: () => false,
                isSymbolicLink: () => false,
              }
            : {}),
        };
      }
    }),
    lstat: jest.fn((p: string) =>
      Promise.resolve({ ...kindStats(get(p)) } as BigIntStats),
    ),
    realpath: jest.fn((p: string) => {
      const node = get(p);
      if (node.error) return Promise.reject(errno(node.error));
      return Promise.resolve(node.target ?? path.resolve(p));
    }),
  } satisfies IDiskFs;
  const deps: IDiskWalkDeps = {
    fs,
    platform: 'win32',
    isProtected: jest.fn(() => false),
    onSnapshot: jest.fn(),
  };
  const controller = new AbortController();
  add(root, 'directory');
  return {
    root,
    fs,
    deps,
    nodes,
    key,
    controller,
    dir: (p: string) => add(p, 'directory'),
    file: (p: string) => add(p, 'file'),
    link: (p: string, target: string) => add(p, 'link', target),
    run: () => listPackageTargets(root, controller.signal, deps),
  };
};

describe('listPackageTargets', () => {
  it('lists npm directories and one level of scoped packages as pending rows', async () => {
    const f = fixture();
    const plain = f.dir(path.join(f.root, 'plain'));
    const scope = f.dir(path.join(f.root, '@scope'));
    const scoped = f.dir(path.join(scope, 'name'));
    f.dir(path.join(scoped, 'nested'));
    const rows = await f.run();
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: plain,
          name: 'plain',
          kind: 'package',
          canonicalPath: plain,
          aliases: ['plain'],
          state: 'pending',
          sizeBytes: null,
          fileCount: null,
          reason: null,
        }),
        expect.objectContaining({
          path: scoped,
          name: '@scope/name',
          canonicalPath: scoped,
          aliases: ['@scope/name'],
          state: 'pending',
        }),
      ]),
    );
    expect(f.fs.entries.mock.calls.map(([p]) => p)).toEqual([f.root, scope]);
  });

  it('does not enumerate a scope junction that escapes the root', async () => {
    const f = fixture();
    const outside = f.dir('E:\\TEST\\outside');
    f.link(path.join(f.root, '@escape'), outside);
    const rows = await f.run();
    expect(f.fs.entries).not.toHaveBeenCalledWith(outside, expect.anything());
    expect(f.fs.entries.mock.calls).toHaveLength(1);
    expect(rows.every((r) => r.state === 'excluded')).toBe(true);
    expect(rows.every((r) => r.canonicalPath === null)).toBe(true);
  });

  it('also checks containment for a non-link scope canonical path', async () => {
    const f = fixture();
    const scope = f.dir(path.join(f.root, '@escape'));
    f.nodes.get(f.key(scope))!.target = `${f.root}-outside`;
    await f.run();
    expect(f.fs.entries.mock.calls.map(([p]) => p)).toEqual([f.root]);
  });

  it('groups pnpm aliases with the same case-insensitive canonical target', async () => {
    const f = fixture();
    const store = f.dir(path.join(f.root, '.pnpm'));
    const target = f.dir(path.join(store, 'pkg@1'));
    f.link(path.join(f.root, 'pkg'), target);
    f.link(path.join(f.root, 'alias'), target.toUpperCase());
    const rows = await f.run();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'package', state: 'pending' });
    expect(rows[0].canonicalPath?.toLowerCase()).toBe(target.toLowerCase());
    expect([...rows[0].aliases].sort()).toEqual(['alias', 'pkg']);
    expect(f.fs.entries.mock.calls.map(([p]) => p)).toEqual([f.root]);
  });

  it.each([
    'E:\\TEST\\workspace',
    'D:\\TEST\\store',
    'D:\\TEST\\node_modules2',
  ])(
    'excludes external target %s without disclosing or enumerating it',
    async (outside) => {
      const f = fixture();
      f.dir(outside);
      const alias = f.link(path.join(f.root, 'external'), outside);
      const rows = await f.run();
      expect(rows).toEqual([
        expect.objectContaining({
          path: alias,
          state: 'excluded',
          reason: 'outside_root',
          canonicalPath: null,
          sizeBytes: null,
          fileCount: null,
        }),
      ]);
      expect(f.fs.entries.mock.calls.map(([p]) => p)).toEqual([f.root]);
      expect(f.fs.lstat.mock.calls.map(([p]) => p)).not.toContain(outside);
    },
  );

  it.each(['ENOENT', 'ELOOP'])(
    'excludes a broken or cyclic alias (%s) and keeps a valid sibling',
    async (code) => {
      const f = fixture();
      const bad = f.link(path.join(f.root, 'bad'), f.root);
      f.nodes.get(f.key(bad))!.error = code;
      f.dir(path.join(f.root, 'good'));
      const rows = await f.run();
      expect(rows.find((r) => r.name === 'bad')).toMatchObject({
        state: 'excluded',
        canonicalPath: null,
        sizeBytes: null,
      });
      expect(rows.find((r) => r.name === 'good')?.state).toBe('pending');
      expect(f.fs.entries.mock.calls.map(([p]) => p)).toEqual([f.root]);
    },
  );

  it('excludes a self/root alias rather than counting the root as a package', async () => {
    const f = fixture();
    f.link(path.join(f.root, 'cycle'), f.root);
    expect(await f.run()).toEqual([
      expect.objectContaining({ state: 'excluded', canonicalPath: null }),
    ]);
    expect(f.fs.entries.mock.calls.map(([p]) => p)).toEqual([f.root]);
  });

  it.each(['lexical', 'canonical'])(
    'checks protected %s paths before enumerating a target',
    async (mode) => {
      const f = fixture();
      const target = f.dir(path.join(f.root, '.pnpm'));
      const alias = f.link(path.join(f.root, 'secret'), target);
      f.deps.isProtected = (p) =>
        f.key(p) === f.key(mode === 'lexical' ? alias : target);
      const rows = await f.run();
      expect(rows).toEqual([
        expect.objectContaining({
          state: 'excluded',
          reason: 'protected',
          canonicalPath: null,
        }),
      ]);
      expect(f.fs.entries.mock.calls.map(([p]) => p)).toEqual([f.root]);
      if (mode === 'lexical') {
        expect(f.fs.realpath.mock.calls.map(([p]) => p)).not.toContain(alias);
      }
    },
  );

  it('omits .bin, dot entries and loose files from package rows', async () => {
    const f = fixture();
    for (const name of ['.bin', '.pnpm', '.cache']) {
      f.dir(path.join(f.root, name));
    }
    const scope = f.dir(path.join(f.root, '@scope'));
    f.dir(path.join(scope, '.hidden'));
    f.file(path.join(f.root, 'README'));
    f.file(path.join(scope, 'README'));
    expect(await f.run()).toEqual([]);
  });

  it('lists every canonical target beyond the snapshot limit for later measurement', async () => {
    const f = fixture();
    expect(DISK_ROW_LIMIT).toBe(2000);
    for (let i = 0; i < DISK_ROW_LIMIT + 2; i++) {
      f.dir(path.join(f.root, `pkg-${i}`));
    }
    const rows = await f.run();
    expect(rows).toHaveLength(2002);
    expect(rows[0].name).toBe('pkg-0');
    expect(rows[2001]).toMatchObject({
      name: 'pkg-2001',
      state: 'pending',
      sizeBytes: null,
      fileCount: null,
    });
  });

  it('still groups aliases discovered after more than 2000 canonical targets', async () => {
    const f = fixture();
    const first = f.dir(path.join(f.root, 'first'));
    for (let i = 0; i < 2000; i++) f.dir(path.join(f.root, `pkg-${i}`));
    f.link(path.join(f.root, 'late-alias'), first);
    const rows = await f.run();
    expect(rows).toHaveLength(2001);
    expect(rows.find((row) => row.name === 'first')).toMatchObject({
      canonicalPath: first,
      aliases: ['first', 'late-alias'],
    });
  });

  it('realpaths known package and scope directories without lstat', async () => {
    const f = fixture();
    const plain = f.dir(path.join(f.root, 'plain'));
    const scope = f.dir(path.join(f.root, '@scope'));
    const scoped = f.dir(path.join(scope, 'name'));
    const rows = await f.run();
    expect(rows.map((row) => row.name)).toEqual(['plain', '@scope/name']);
    expect(f.fs.lstat).not.toHaveBeenCalled();
    expect(f.fs.realpath.mock.calls.map(([p]) => p)).toEqual([
      plain,
      scope,
      scoped,
    ]);
  });

  it('falls back to lstat for an unknown package directory Dirent', async () => {
    const f = fixture();
    const target = f.dir(path.join(f.root, 'unknown'));
    f.nodes.get(f.key(target))!.unknownDirent = true;
    expect(await f.run()).toEqual([
      expect.objectContaining({
        name: 'unknown',
        canonicalPath: target,
        state: 'pending',
      }),
    ]);
    expect(f.fs.lstat.mock.calls.map(([p]) => p)).toContain(target);
    expect(f.fs.realpath.mock.calls.map(([p]) => p)).toContain(target);
  });

  it('does no IO for an already aborted listing', async () => {
    const f = fixture();
    f.controller.abort();
    expect(await f.run()).toEqual([]);
    expect(f.fs.entries).not.toHaveBeenCalled();
    expect(f.fs.lstat).not.toHaveBeenCalled();
    expect(f.fs.realpath).not.toHaveBeenCalled();
  });
});
