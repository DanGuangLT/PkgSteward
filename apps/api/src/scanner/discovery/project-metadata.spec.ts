import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import { inspectScanDirectory } from '@/scanner/discovery/project-metadata';

const directory = 'D:\\Scan\\app';
const errno = (code: string) => Object.assign(new Error(code), { code });
const stat = (kind = 'file', mtimeMs = 1000) => ({
  mtimeMs,
  isFile: () => kind === 'file',
  isDirectory: () => kind === 'directory',
  isSymbolicLink: () => kind === 'link',
});
const entry = (name: string, kind = 'file') =>
  ({ name, ...stat(kind) }) as unknown as Dirent;

const fixture = (content = '{"name":"example"}') => {
  const stats = new Map([
    ['package.json', stat()],
    ['node_modules', stat('directory', 2000)],
  ]);
  const fs = {
    readdir: jest.fn<Promise<Dirent[]>, [string]>(),
    realpath: jest.fn((p: string) => Promise.resolve(p)),
    lstat: jest.fn((p: string) => {
      const value = stats.get(path.win32.relative(directory, p));
      return value ? Promise.resolve(value) : Promise.reject(errno('ENOENT'));
    }),
    readFile: jest.fn(() => Promise.resolve(content)),
  };
  const signal = new AbortController().signal;
  const deps = { platform: 'win32' as const, fs, signal };
  const inspect = (
    entries = [entry('package.json'), entry('node_modules', 'directory')],
  ) => inspectScanDirectory(directory, entries, deps);
  return { stats, fs, signal, deps, inspect };
};

describe('inspectScanDirectory', () => {
  it('reads valid package metadata with null sizes and only package content', async () => {
    const { inspect, fs, signal } = fixture();
    await expect(inspect()).resolves.toEqual({
      project: {
        path: directory,
        name: 'example',
        packageManager: null,
        hasLockfile: false,
        lastActivityAt: new Date(1000).toISOString(),
        nodeModules: {
          exists: true,
          path: path.win32.join(directory, 'node_modules'),
          sizeBytes: null,
        },
      },
      orphan: null,
    });
    expect(fs.readFile.mock.calls).toEqual([
      [path.win32.join(directory, 'package.json'), signal],
    ]);
    expect(fs.readdir).not.toHaveBeenCalled();
    expect(fs.realpath).not.toHaveBeenCalled();
  });

  it.each([
    '{',
    '{}',
    '{"name":null}',
    '{"name":42}',
    '{"name":""}',
    '{"name":"  "}',
    'null',
    '[]',
  ])('keeps a project with null name for %s', async (content) => {
    expect((await fixture(content).inspect()).project?.name).toBeNull();
    expect((await fixture(content).inspect()).orphan).toBeNull();
  });

  it('reads the name from a package.json saved with a UTF-8 BOM', async () => {
    const result = await fixture('\uFEFF{"name":"with-bom"}').inspect();
    expect(result.project?.name).toBe('with-bom');
  });

  it('returns the candidate node_modules path when it is absent', async () => {
    const result = await fixture().inspect([entry('package.json')]);
    expect(result.project?.nodeModules).toEqual({
      exists: false,
      path: path.win32.join(directory, 'node_modules'),
      sizeBytes: null,
    });
  });

  it.each(Array.from({ length: 8 }, (_, mask) => mask))(
    'uses lock priority for combination %i',
    async (mask) => {
      const { stats, inspect, fs } = fixture();
      const locks = ['pnpm-lock.yaml', 'yarn.lock', 'package-lock.json'];
      const selected = locks.filter((_, index) => mask & (1 << index));
      for (const name of selected) stats.set(name, stat());
      const result = await inspect([
        entry('package.json'),
        ...selected.map((name) => entry(name)),
      ]);
      expect(result.project?.hasLockfile).toBe(selected.length > 0);
      expect(result.project?.packageManager).toBe(
        mask & 1 ? 'pnpm' : mask & 2 ? 'yarn' : mask & 4 ? 'npm' : null,
      );
      expect(fs.readFile).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    'package.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'package-lock.json',
    '.git\\HEAD',
    '.git\\index',
  ])(
    'uses activity max including %s without reading lock or git content',
    async (latest) => {
      const { stats, inspect, fs } = fixture();
      const locks = ['pnpm-lock.yaml', 'yarn.lock', 'package-lock.json'];
      for (const name of [...locks, '.git\\HEAD', '.git\\index'])
        stats.set(name, stat());
      stats.set('.git', stat('directory'));
      stats.set(latest, stat('file', 9000));
      const result = await inspect([
        entry('package.json'),
        ...locks.map((name) => entry(name)),
        entry('.git', 'directory'),
      ]);
      expect(result.project?.lastActivityAt).toBe(new Date(9000).toISOString());
      expect(result.project?.packageManager).toBe('pnpm');
      expect(fs.readFile.mock.calls.map(([p]) => p)).toEqual([
        path.win32.join(directory, 'package.json'),
      ]);
    },
  );

  it.each(['ENOENT', 'ENOTDIR'])(
    'ignores missing auxiliary files (%s)',
    async (code) => {
      const { inspect, fs } = fixture();
      fs.lstat.mockImplementation((p) =>
        p.endsWith('package.json')
          ? Promise.resolve(stat())
          : Promise.reject(errno(code)),
      );
      const result = await inspect([
        entry('package.json'),
        entry('pnpm-lock.yaml'),
        entry('.git', 'directory'),
        entry('node_modules', 'directory'),
      ]);
      expect(result.project).toMatchObject({
        hasLockfile: false,
        nodeModules: { exists: false },
      });
    },
  );

  it('returns orphan only without package with ISO mtime and null size', async () => {
    const { inspect } = fixture();
    await expect(
      inspect([entry('node_modules', 'directory')]),
    ).resolves.toEqual({
      project: null,
      orphan: {
        path: path.win32.join(directory, 'node_modules'),
        sizeBytes: null,
        mtime: new Date(2000).toISOString(),
      },
    });
    expect((await fixture('{').inspect()).orphan).toBeNull();
  });

  it('rejects a package read failure rather than returning an orphan', async () => {
    const { inspect, fs } = fixture();
    const error = errno('EACCES');
    fs.readFile.mockRejectedValue(error);
    await expect(inspect()).rejects.toBe(error);
  });

  it.each([
    'package.json',
    'pnpm-lock.yaml',
    'node_modules',
    '.git',
    '.git\\HEAD',
    '.git\\index',
  ])('rejects a metadata access failure at %s', async (target) => {
    const { inspect, fs, stats } = fixture();
    stats.set('.git', stat('directory'));
    const original = fs.lstat.getMockImplementation()!;
    const error = errno('EPERM');
    fs.lstat.mockImplementation((p) =>
      path.win32.relative(directory, p) === target
        ? Promise.reject(error)
        : original(p),
    );
    await expect(
      inspect([
        entry('package.json'),
        entry('pnpm-lock.yaml'),
        entry('node_modules', 'directory'),
        entry('.git', 'directory'),
      ]),
    ).rejects.toBe(error);
  });

  it('rejects a discovered package that disappears during stat', async () => {
    const { inspect, stats } = fixture();
    stats.delete('package.json');
    await expect(inspect()).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('ignores linked metadata, linked node_modules and git worktree files', async () => {
    const { inspect, stats, fs } = fixture();
    stats.set('pnpm-lock.yaml', stat('link', 99999));
    stats.set('node_modules', stat('link'));
    stats.set('.git', stat('file', 99999));
    const result = await inspect([
      entry('package.json'),
      entry('pnpm-lock.yaml'),
      entry('node_modules', 'directory'),
      entry('.git'),
    ]);
    expect(result.project).toMatchObject({
      hasLockfile: false,
      lastActivityAt: new Date(1000).toISOString(),
      nodeModules: { exists: false },
    });
    expect(fs.readFile).toHaveBeenCalledTimes(1);
    expect(fs.lstat.mock.calls.flat()).not.toContain(
      path.win32.join(directory, '.git', 'HEAD'),
    );
    expect(
      (
        await inspect([
          entry('package.json', 'link'),
          entry('node_modules', 'directory'),
        ])
      ).project,
    ).toBeNull();
    expect(
      (
        await inspect([
          entry('package.json', 'link'),
          entry('node_modules', 'directory'),
        ])
      ).orphan,
    ).toBeNull();
  });

  it('does not follow a package replaced with a link after readdir', async () => {
    const { inspect, stats, fs } = fixture();
    stats.set('package.json', stat('link'));
    await expect(inspect()).rejects.toThrow();
    expect(fs.readFile).not.toHaveBeenCalled();
  });

  it('uses posix paths when requested', async () => {
    const { deps, fs } = fixture();
    fs.lstat.mockResolvedValue(stat());
    const result = await inspectScanDirectory(
      '/scan/app',
      [entry('package.json')],
      { ...deps, platform: 'posix' },
    );
    expect(result.project?.nodeModules.path).toBe('/scan/app/node_modules');
    expect(fs.readFile).toHaveBeenCalledWith(
      '/scan/app/package.json',
      deps.signal,
    );
  });

  it('starts no IO after abort', async () => {
    const { deps, fs } = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      inspectScanDirectory(directory, [entry('package.json')], {
        ...deps,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(fs.lstat).not.toHaveBeenCalled();
    expect(fs.readFile).not.toHaveBeenCalled();
  });
});
