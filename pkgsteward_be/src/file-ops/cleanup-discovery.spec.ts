import { pathApi, type PathPlatform } from '@/common/utils/path.util';
import {
  discoverCleanupCandidates,
  FRAMEWORK_MARKERS,
  type ICleanupDiscoveryOptions,
} from '@/file-ops/cleanup-discovery';
import type {
  CleanupKind,
  GitTrackedResult,
  IFileOpsDirent,
  IFileOpsStat,
} from '@/file-ops/interfaces/file-ops.types';
import type { IStoredScanResult } from '@/scanner/interfaces/scanner.types';

const errno = (code: string) => Object.assign(new Error(code), { code });
type EntryKind = 'directory' | 'file' | 'link';
const stat = (kind: EntryKind = 'directory'): IFileOpsStat => ({
  dev: 1n,
  ino: 1n,
  size: 0n,
  isDirectory: () => kind === 'directory',
  isFile: () => kind === 'file',
  isSymbolicLink: () => kind === 'link',
});
const dirent = (
  name: string,
  kind: EntryKind = 'directory',
): IFileOpsDirent => ({
  name,
  isDirectory: () => kind === 'directory',
  isSymbolicLink: () => kind === 'link',
});

const fixture = (platform: PathPlatform = 'win32') => {
  const api = pathApi(platform);
  const key = (p: string) =>
    platform === 'win32' ? api.resolve(p).toLowerCase() : api.resolve(p);
  const stats = new Map<string, IFileOpsStat | Error>();
  const directories = new Map<string, IFileOpsDirent[] | Error>();
  const contents = new Map<string, string | Error>();
  const scan: Pick<IStoredScanResult, 'projects' | 'orphanNodeModules'> = {
    projects: [],
    orphanNodeModules: [],
  };
  const controller = new AbortController();
  const put = (p: string, value: IFileOpsStat | Error) =>
    stats.set(key(p), value);
  const entries = (p: string, value: IFileOpsDirent[] | Error) =>
    directories.set(key(p), value);
  const manifest = (p: string, value: string | Error) =>
    contents.set(key(api.join(p, 'package.json')), value);
  const project = (p: string) => {
    scan.projects.push({
      path: p,
      name: api.basename(p),
      packageManager: null,
      hasLockfile: false,
      lastActivityAt: '2026-10-01T00:00:00.000Z',
      nodeModules: {
        path: api.join(p, 'node_modules'),
        exists: false,
        sizeBytes: null,
      },
    });
    put(api.join(p, 'package.json'), stat('file'));
    put(api.join(p, 'node_modules'), stat());
    entries(p, []);
    manifest(p, '{}');
  };
  const orphan = (p: string) => {
    scan.orphanNodeModules.push({
      path: p,
      sizeBytes: null,
      mtime: '2026-10-01T00:00:00.000Z',
    });
    put(p, stat());
  };
  const read = <T>(map: Map<string, T | Error>, p: string): Promise<T> => {
    const value = map.get(key(p)) ?? errno('ENOENT');
    return value instanceof Error
      ? Promise.reject(value)
      : Promise.resolve(value);
  };
  const fs = {
    lstat: jest.fn((p: string) => read(stats, p)),
    readdir: jest.fn((p: string) => read(directories, p)),
    readFile: jest.fn((p: string) => read(contents, p)),
  };
  const trackedNames = jest
    .fn<Promise<GitTrackedResult>, [string, readonly string[], AbortSignal?]>()
    .mockResolvedValue({ state: 'ok', tracked: [] });
  const run = (
    options: ICleanupDiscoveryOptions = {
      includeKinds: ['node_modules', 'build_cache', 'orphan_node_modules'],
    },
  ) =>
    discoverCleanupCandidates(scan, options, {
      platform,
      fs,
      git: { trackedNames },
      signal: controller.signal,
    });
  return {
    scan,
    controller,
    put,
    entries,
    manifest,
    project,
    orphan,
    fs,
    trackedNames,
    run,
  };
};

describe('discoverCleanupCandidates', () => {
  it('exports the approved framework markers', () => {
    expect(FRAMEWORK_MARKERS).toEqual({
      '.next': ['next'],
      '.nuxt': ['nuxt'],
      '.svelte-kit': ['@sveltejs/kit'],
      '.turbo': ['turbo'],
      '.parcel-cache': ['parcel', '@parcel/core'],
      '.angular': ['@angular/cli', '@angular/core'],
      coverage: ['jest', 'vitest', 'nyc', 'c8', '@vitest/coverage-*'],
      '.nyc_output': ['jest', 'vitest', 'nyc', 'c8', '@vitest/coverage-*'],
    });
  });

  it('orders projects by scan, caches by policy, then orphans by scan', async () => {
    const f = fixture();
    f.project('D:\\b');
    f.project('D:\\a');
    f.entries(
      'D:\\b',
      [
        'coverage',
        '.angular',
        '.parcel-cache',
        '.next',
        '.nyc_output',
        '.nuxt',
        '.turbo',
        '.svelte-kit',
      ].map((name) => dirent(name)),
    );
    f.entries('D:\\a', [dirent('.next')]);
    f.orphan('D:\\z\\node_modules');
    f.orphan('D:\\loose\\node_modules');
    const result = await f.run();
    expect(result.map((c) => c.path)).toEqual([
      'D:\\b\\node_modules',
      'D:\\b\\.next',
      'D:\\b\\.nuxt',
      'D:\\b\\.svelte-kit',
      'D:\\b\\.turbo',
      'D:\\b\\.parcel-cache',
      'D:\\b\\.angular',
      'D:\\b\\coverage',
      'D:\\b\\.nyc_output',
      'D:\\a\\node_modules',
      'D:\\a\\.next',
      'D:\\z\\node_modules',
      'D:\\loose\\node_modules',
    ]);
    expect(result[0]).toEqual({
      path: 'D:\\b\\node_modules',
      kind: 'node_modules',
      ownerPath: 'D:\\b',
      frameworkVerified: null,
      trackedCheck: null,
    });
    expect(result[1]).toEqual({
      path: 'D:\\b\\.next',
      kind: 'build_cache',
      ownerPath: 'D:\\b',
      frameworkVerified: false,
      trackedCheck: 'clean',
    });
    expect(result[11]).toEqual({
      path: 'D:\\z\\node_modules',
      kind: 'orphan_node_modules',
      ownerPath: null,
      frameworkVerified: null,
      trackedCheck: null,
    });
    expect(f.fs.readdir.mock.calls).toEqual([['D:\\b'], ['D:\\a']]);
    expect(f.fs.readFile.mock.calls).toEqual([
      ['D:\\b\\package.json'],
      ['D:\\a\\package.json'],
    ]);
    expect(f.trackedNames).toHaveBeenCalledTimes(2);
  });

  it.each<CleanupKind>(['node_modules', 'build_cache', 'orphan_node_modules'])(
    'does I/O only for included kind %s',
    async (kind) => {
      const f = fixture();
      f.project('D:\\p');
      f.entries('D:\\p', [dirent('.next')]);
      f.orphan('D:\\loose\\node_modules');
      expect(
        (await f.run({ includeKinds: [kind] })).map((c) => c.kind),
      ).toEqual([kind]);
      if (kind === 'build_cache') {
        expect(f.fs.lstat).not.toHaveBeenCalled();
        expect(f.fs.readdir.mock.calls).toEqual([['D:\\p']]);
        expect(f.trackedNames).toHaveBeenCalledTimes(1);
        expect(f.fs.readFile).toHaveBeenCalledTimes(1);
      } else {
        expect(f.fs.readdir).not.toHaveBeenCalled();
        expect(f.fs.readFile).not.toHaveBeenCalled();
        expect(f.trackedNames).not.toHaveBeenCalled();
        expect(f.fs.lstat.mock.calls).toEqual(
          kind === 'node_modules'
            ? [['D:\\p\\node_modules']]
            : [['D:\\loose\\node_modules'], ['D:\\loose\\package.json']],
        );
      }
    },
  );

  it.each<ICleanupDiscoveryOptions>([
    { includeKinds: [] },
    {
      includeKinds: ['node_modules', 'build_cache', 'orphan_node_modules'],
      projectPaths: [],
    },
  ])(
    'does no filesystem or git work for an empty selection: %#',
    async (options) => {
      const f = fixture();
      f.project('D:\\p');
      f.orphan('D:\\loose\\node_modules');
      expect(await f.run(options)).toEqual([]);
      expect(f.fs.lstat).not.toHaveBeenCalled();
      expect(f.fs.readdir).not.toHaveBeenCalled();
      expect(f.fs.readFile).not.toHaveBeenCalled();
      expect(f.trackedNames).not.toHaveBeenCalled();
    },
  );

  it('filters exact Windows project paths and includes only orphans inside selected projects', async () => {
    const f = fixture();
    f.project('D:\\p');
    f.project('D:\\p\\nested');
    f.project('D:\\q');
    f.orphan('D:\\p\\nested\\loose\\node_modules');
    f.orphan('D:\\p-other\\node_modules');
    f.orphan('D:\\q\\loose\\node_modules');
    const result = await f.run({
      includeKinds: ['node_modules', 'orphan_node_modules'],
      projectPaths: ['d:\\P'],
    });
    expect(result).toEqual([
      {
        path: 'D:\\p\\node_modules',
        kind: 'node_modules',
        ownerPath: 'D:\\p',
        frameworkVerified: null,
        trackedCheck: null,
      },
      {
        path: 'D:\\p\\nested\\loose\\node_modules',
        kind: 'orphan_node_modules',
        ownerPath: 'D:\\p\\nested',
        frameworkVerified: null,
        trackedCheck: null,
      },
    ]);
    expect(f.fs.lstat.mock.calls).toEqual([
      ['D:\\p\\node_modules'],
      ['D:\\p\\nested\\loose\\node_modules'],
      ['D:\\p\\nested\\loose\\package.json'],
    ]);
  });

  it('does not fold case for POSIX project filters', async () => {
    const f = fixture('posix');
    f.project('/p');
    expect(
      await f.run({ includeKinds: ['node_modules'], projectPaths: ['/P'] }),
    ).toEqual([]);
    expect(f.fs.lstat).not.toHaveBeenCalled();
  });

  it.each<IFileOpsStat | Error>([
    errno('ENOENT'),
    errno('ENOTDIR'),
    errno('EACCES'),
    stat('link'),
    stat('file'),
  ])('skips unavailable or non-directory node_modules: %#', async (entry) => {
    const f = fixture();
    f.project('D:\\p');
    f.put('D:\\p\\node_modules', entry);
    expect(await f.run({ includeKinds: ['node_modules'] })).toEqual([]);
  });

  it('does not synthesize node_modules paths or trust the scan exists flag', async () => {
    const f = fixture();
    f.project('D:\\p');
    f.scan.projects[0].nodeModules.path = 'D:\\p\\deps';
    f.put('D:\\p\\deps', stat());
    expect(await f.run({ includeKinds: ['node_modules'] })).toEqual([
      expect.objectContaining({ path: 'D:\\p\\deps', kind: 'node_modules' }),
    ]);
    expect(f.fs.lstat.mock.calls).toEqual([['D:\\p\\deps']]);
  });

  it.each<IFileOpsStat | Error>([
    stat('file'),
    stat('directory'),
    stat('link'),
    errno('EACCES'),
  ])(
    'skips orphan when parent package.json exists or cannot be checked: %#',
    async (entry) => {
      const f = fixture();
      f.orphan('D:\\loose\\node_modules');
      f.put('D:\\loose\\package.json', entry);
      expect(await f.run({ includeKinds: ['orphan_node_modules'] })).toEqual(
        [],
      );
    },
  );

  it.each(['ENOENT', 'ENOTDIR'])(
    'accepts orphan when parent package.json returns %s',
    async (code) => {
      const f = fixture();
      f.orphan('D:\\loose\\node_modules');
      f.put('D:\\loose\\package.json', errno(code));
      expect(await f.run({ includeKinds: ['orphan_node_modules'] })).toEqual([
        expect.objectContaining({
          path: 'D:\\loose\\node_modules',
          kind: 'orphan_node_modules',
        }),
      ]);
    },
  );

  it.each<IFileOpsStat | Error>([
    stat('link'),
    stat('file'),
    errno('ENOENT'),
    errno('EACCES'),
  ])(
    'skips an orphan target that is not a readable ordinary directory: %#',
    async (entry) => {
      const f = fixture();
      f.orphan('D:\\loose\\node_modules');
      f.put('D:\\loose\\node_modules', entry);
      expect(await f.run({ includeKinds: ['orphan_node_modules'] })).toEqual(
        [],
      );
      expect(f.fs.lstat).not.toHaveBeenCalledWith('D:\\loose\\package.json');
    },
  );

  it('preserves disk casing for cache paths and git arguments; excludes links, files and other names', async () => {
    const f = fixture();
    f.project('D:\\p');
    f.entries('D:\\p', [
      dirent('.NEXT'),
      dirent('.nuxt', 'link'),
      dirent('coverage', 'file'),
      dirent('dist'),
      dirent('.nextjs'),
    ]);
    f.manifest('D:\\p', '{"devDependencies":{"next":"1"}}');
    expect(await f.run({ includeKinds: ['build_cache'] })).toEqual([
      {
        path: 'D:\\p\\.NEXT',
        kind: 'build_cache',
        ownerPath: 'D:\\p',
        frameworkVerified: true,
        trackedCheck: 'clean',
      },
    ]);
    expect(f.trackedNames.mock.calls).toEqual([
      ['D:\\p', ['.NEXT'], f.controller.signal],
    ]);
    expect(f.fs.readdir).toHaveBeenCalledTimes(1);
  });

  it('does not recognize uppercase cache names on POSIX', async () => {
    const f = fixture('posix');
    f.project('/p');
    f.entries('/p', [dirent('.NEXT')]);
    expect(await f.run({ includeKinds: ['build_cache'] })).toEqual([]);
    expect(f.trackedNames).not.toHaveBeenCalled();
    expect(f.fs.readFile).not.toHaveBeenCalled();
  });

  it('removes tracked cache candidates and marks only the remainder clean', async () => {
    const f = fixture();
    f.project('D:\\p');
    f.entries('D:\\p', [dirent('coverage'), dirent('.next')]);
    f.trackedNames.mockResolvedValue({ state: 'ok', tracked: ['.next'] });
    expect(await f.run({ includeKinds: ['build_cache'] })).toEqual([
      expect.objectContaining({
        path: 'D:\\p\\coverage',
        trackedCheck: 'clean',
      }),
    ]);
    expect(f.fs.readFile).toHaveBeenCalledTimes(1);
  });

  it('does not read a manifest when git excludes every cache', async () => {
    const f = fixture();
    f.project('D:\\p');
    f.entries('D:\\p', [dirent('.next')]);
    f.trackedNames.mockResolvedValue({ state: 'ok', tracked: ['.next'] });
    expect(await f.run({ includeKinds: ['build_cache'] })).toEqual([]);
    expect(f.fs.readFile).not.toHaveBeenCalled();
  });

  it.each<GitTrackedResult>([
    { state: 'not_repo' },
    { state: 'unknown', reason: 'git_missing' },
    { state: 'unknown', reason: 'timeout' },
    { state: 'unknown', reason: 'failed' },
    { state: 'unknown', reason: 'cancelled' },
  ])(
    'retains candidates with git state $state / $reason',
    async (gitResult) => {
      const f = fixture();
      f.project('D:\\p');
      f.entries('D:\\p', [dirent('.next')]);
      f.trackedNames.mockResolvedValue(gitResult);
      expect(await f.run({ includeKinds: ['build_cache'] })).toEqual([
        expect.objectContaining({
          path: 'D:\\p\\.next',
          trackedCheck: gitResult.state,
        }),
      ]);
    },
  );

  it.each<[string, string, boolean]>([
    ['.next', '{"devDependencies":{"next":"1"}}', true],
    ['.nuxt', '{"dependencies":{"nuxt":"1"}}', true],
    ['.svelte-kit', '{"dependencies":{"@sveltejs/kit":"1"}}', true],
    ['.turbo', '{"dependencies":{"turbo":"1"}}', true],
    ['.parcel-cache', '{"devDependencies":{"@parcel/core":"1"}}', true],
    ['.parcel-cache', '{"dependencies":{"parcel":"1"}}', true],
    ['.angular', '{"dependencies":{"@angular/core":"1"}}', true],
    ['.angular', '{"devDependencies":{"@angular/cli":"1"}}', true],
    ['coverage', '{"dependencies":{"@vitest/coverage-v8":"1"}}', true],
    ['coverage', '{"dependencies":{"@vitest/coverage":"1"}}', false],
    ['coverage', '{"dependencies":{"jest-extra":"1"}}', false],
    ['coverage', '{"dependencies":{"jest":"1"}}', true],
    ['coverage', '{"devDependencies":{"vitest":"1"}}', true],
    ['.nyc_output', '{"dependencies":{"nyc":"1"}}', true],
    ['.nyc_output', '{"dependencies":{"c8":"1"}}', true],
    ['.nyc_output', '{"dependencies":{"@vitest/coverage-istanbul":"1"}}', true],
    ['.next', '{"peerDependencies":{"next":"1"}}', false],
    ['.next', '{"optionalDependencies":{"next":"1"}}', false],
    ['.next', '{"dependencies":{"Next":"1"}}', false],
    ['.next', '{"dependencies":["next"]}', false],
    ['.next', '{"dependencies":"next","devDependencies":null}', false],
    ['.next', '{"dependencies":null,"devDependencies":{"next":"1"}}', true],
    ['.next', 'null', false],
    ['.next', '[]', false],
    ['.next', 'broken JSON', false],
    ['.next', '\uFEFF{"dependencies":{"next":"1"}}', true],
  ])(
    'verifies %s using manifest %s as %s',
    async (name, manifest, expected) => {
      const f = fixture();
      f.project('D:\\p');
      f.entries('D:\\p', [dirent(name)]);
      f.manifest('D:\\p', manifest);
      expect(await f.run({ includeKinds: ['build_cache'] })).toEqual([
        expect.objectContaining({ frameworkVerified: expected }),
      ]);
      expect(f.fs.readFile.mock.calls).toEqual([['D:\\p\\package.json']]);
    },
  );

  it('merges dependency sections and reads the manifest once for all caches', async () => {
    const f = fixture();
    f.project('D:\\p');
    f.entries('D:\\p', [dirent('coverage'), dirent('.next')]);
    f.manifest(
      'D:\\p',
      '{"dependencies":{"next":"1"},"devDependencies":{"vitest":"1"}}',
    );
    expect(
      (await f.run({ includeKinds: ['build_cache'] })).map(
        (c) => c.frameworkVerified,
      ),
    ).toEqual([true, true]);
    expect(f.fs.readFile).toHaveBeenCalledTimes(1);
  });

  it('keeps a cache unverified after a manifest read error', async () => {
    const f = fixture();
    f.project('D:\\p');
    f.entries('D:\\p', [dirent('.next')]);
    f.manifest('D:\\p', errno('EACCES'));
    expect(await f.run({ includeKinds: ['build_cache'] })).toEqual([
      expect.objectContaining({ frameworkVerified: false }),
    ]);
  });

  it.each<IFileOpsDirent[] | Error>([[], [dirent('src')], errno('EACCES')])(
    'does not read manifests or invoke git without usable cache names: %#',
    async (entries) => {
      const f = fixture();
      f.project('D:\\p');
      f.entries('D:\\p', entries);
      expect(await f.run({ includeKinds: ['build_cache'] })).toEqual([]);
      expect(f.fs.readFile).not.toHaveBeenCalled();
      expect(f.trackedNames).not.toHaveBeenCalled();
    },
  );

  it('continues with later projects and orphans after readdir fails', async () => {
    const f = fixture();
    f.project('D:\\p');
    f.project('D:\\q');
    f.entries('D:\\p', errno('EACCES'));
    f.entries('D:\\q', [dirent('.next')]);
    f.orphan('D:\\loose\\node_modules');
    expect(
      (
        await f.run({ includeKinds: ['build_cache', 'orphan_node_modules'] })
      ).map((c) => c.path),
    ).toEqual(['D:\\q\\.next', 'D:\\loose\\node_modules']);
  });

  it('rejects a pre-aborted signal with its original reason and no I/O', async () => {
    const f = fixture();
    f.project('D:\\p');
    const reason = new Error('stop discovery');
    f.controller.abort(reason);
    await expect(f.run()).rejects.toBe(reason);
    expect(f.fs.lstat).not.toHaveBeenCalled();
    expect(f.fs.readdir).not.toHaveBeenCalled();
  });

  it('stops before the next project when cancelled during a project', async () => {
    const f = fixture();
    f.project('D:\\p');
    f.project('D:\\q');
    const reason = new Error('stop between projects');
    f.fs.lstat.mockImplementationOnce(() => {
      f.controller.abort(reason);
      return Promise.resolve(stat());
    });
    await expect(f.run({ includeKinds: ['node_modules'] })).rejects.toBe(
      reason,
    );
    expect(f.fs.lstat.mock.calls).toEqual([['D:\\p\\node_modules']]);
  });

  it('checks cancellation before the first orphan after project work', async () => {
    const f = fixture();
    f.project('D:\\p');
    f.orphan('D:\\loose\\node_modules');
    const reason = new Error('stop before orphan');
    f.fs.lstat.mockImplementationOnce(() => {
      f.controller.abort(reason);
      return Promise.resolve(stat());
    });
    await expect(
      f.run({ includeKinds: ['node_modules', 'orphan_node_modules'] }),
    ).rejects.toBe(reason);
    expect(f.fs.lstat.mock.calls).toEqual([['D:\\p\\node_modules']]);
  });

  it('checks cancellation before every orphan', async () => {
    const f = fixture();
    f.orphan('D:\\one\\node_modules');
    f.orphan('D:\\two\\node_modules');
    const reason = new Error('stop between orphans');
    f.fs.lstat
      .mockImplementationOnce(() => Promise.resolve(stat()))
      .mockImplementationOnce(() => {
        f.controller.abort(reason);
        return Promise.reject(errno('ENOENT'));
      });
    await expect(f.run({ includeKinds: ['orphan_node_modules'] })).rejects.toBe(
      reason,
    );
    expect(f.fs.lstat.mock.calls).toEqual([
      ['D:\\one\\node_modules'],
      ['D:\\one\\package.json'],
    ]);
  });
});
