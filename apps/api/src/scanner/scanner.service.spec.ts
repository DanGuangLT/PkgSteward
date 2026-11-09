import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { toPathPlatform, pathApi } from '@/common/utils/path.util';
import * as pathUtil from '@/common/utils/path.util';
import {
  AppException,
  NotFoundException,
} from '@/common/exceptions/app.exception';
import { MutationGateService } from '@/core/mutation-gate/mutation-gate.service';
import { PathGuardService } from '@/core/path-guard/path-guard.service';
import type { IDriveDetector } from '@/platform/interfaces/drive-detector.interface';
import { UnsupportedDriveDetector } from '@/platform/drives/unsupported-drive-detector';
import { ScannerCache, makeScanCacheKey } from '@/scanner/cache/scanner-cache';
import { parseScanRootPaths } from '@/config/environment/scan-roots';
import { ScannerService } from '@/scanner/scanner.service';
import { SCAN_WALKER, walkScan } from '@/scanner/discovery/scan-walker';
import { DRIVE_DETECTOR } from '@/platform/interfaces/drive-detector.interface';
import { DiskUsageService } from '@/disk-usage/disk-usage.service';
import type { ICompletedDiskSize } from '@/disk-usage/interfaces/disk-usage.types';
import type {
  IScanFs,
  IScanCacheEntry,
  IStoredScanResult,
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
        sizeMeasuredAt: null,
      },
    },
  ],
  orphanNodeModules: [
    {
      path: `${root}/old/node_modules`,
      mtime: '2026-10-20T00:00:00.000Z',
      sizeBytes: null,
      sizeMeasuredAt: null,
    },
  ],
  progress: { visitedDirs: 3, foundProjects: 1, skippedCount: 1 },
});
const tick = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

describe('ScannerService D15 cached measurement enrichment', () => {
  const measuredAt = '2026-10-27T00:00:00.000Z';
  const modules: TestingModule[] = [];

  async function measurementFixture() {
    const f = fixture();
    const disk = {
      peekCompletedSize: jest.fn<ICompletedDiskSize | null, [string]>(
        () => null,
      ),
      start: jest.fn(),
    };
    const module = await Test.createTestingModule({
      providers: [
        ScannerService,
        { provide: ConfigService, useValue: f.config },
        { provide: PathGuardService, useValue: f.guard },
        { provide: DRIVE_DETECTOR, useValue: f.detector },
        { provide: SCAN_WALKER, useValue: f.walker },
        { provide: ScannerCache, useValue: f.cache },
        { provide: DiskUsageService, useValue: disk },
        { provide: MutationGateService, useValue: f.gate },
      ],
    }).compile();
    const service = module.get(ScannerService);
    await module.init();
    const scan = service.startScan();
    await tick();
    const value = snapshot();
    value.projects[0].nodeModules.exists = true;
    value.projects.push({
      ...structuredClone(value.projects[0]),
      path: `${root}/absent`,
      nodeModules: {
        exists: false,
        path: `${root}/absent/node_modules`,
        sizeBytes: null,
        sizeMeasuredAt: null,
      },
    });
    f.walks[0].task.resolve(value);
    await tick();
    expect(service.getScan(scan.scanId).status).toBe('completed');
    const result = { ...f, service, module, disk, scan, value };
    modules.push(module);
    return result;
  }

  afterEach(async () => {
    jest.restoreAllMocks();
    for (const module of modules.splice(0)) await module.close();
  });

  it('adds cached project and orphan sizes and their original measurement timestamps', async () => {
    const f = await measurementFixture();
    f.disk.peekCompletedSize.mockImplementation((path) => ({
      sizeBytes: path === f.value.projects[0].nodeModules.path ? 0 : 2048,
      measuredAt,
    }));
    const result = f.service.getLatest();
    expect(result.projects[0].nodeModules).toMatchObject({
      sizeBytes: 0,
      sizeMeasuredAt: measuredAt,
    });
    expect(result.orphanNodeModules[0]).toMatchObject({
      sizeBytes: 2048,
      sizeMeasuredAt: measuredAt,
    });
    expect(result.projects[1].nodeModules).toMatchObject({
      exists: false,
      sizeBytes: null,
      sizeMeasuredAt: null,
    });
    expect(f.disk.peekCompletedSize).not.toHaveBeenCalledWith(
      f.value.projects[1].nodeModules.path,
    );
    expect(f.disk.peekCompletedSize).toHaveBeenCalledWith(
      f.value.projects[0].nodeModules.path,
    );
    expect(f.disk.peekCompletedSize).toHaveBeenCalledWith(
      f.value.orphanNodeModules[0].path,
    );
    // A caller changing an enriched response must not alter the next response.
    result.projects[0].nodeModules.path = '/changed-by-caller';
    expect(f.service.getLatest().projects[0].nodeModules.path).toBe(
      f.value.projects[0].nodeModules.path,
    );
    f.disk.peekCompletedSize.mockReturnValue(null);
    expect(f.service.getLatest().projects[0].nodeModules).toMatchObject({
      sizeBytes: null,
      sizeMeasuredAt: null,
    });
  });

  it('keeps missing measurements and absent node_modules null, without peeking absent paths', async () => {
    const f = await measurementFixture();
    f.disk.peekCompletedSize.mockClear();
    const result = f.service.getLatest();
    for (const project of result.projects)
      expect(project.nodeModules).toMatchObject({
        sizeBytes: null,
        sizeMeasuredAt: null,
      });
    expect(result.orphanNodeModules[0]).toMatchObject({
      sizeBytes: null,
      sizeMeasuredAt: null,
    });
    expect(f.disk.peekCompletedSize).not.toHaveBeenCalledWith(
      f.value.projects[1].nodeModules.path,
    );
    expect(f.disk.peekCompletedSize).toHaveBeenCalledTimes(2);
  });

  it('does only RAM peeks on getLatest, without filesystem calls, guard calls or starting measurements', async () => {
    const f = await measurementFixture();
    f.disk.peekCompletedSize.mockClear();
    f.guard.createProtectedTreeMatcher.mockClear();
    f.guard.isInsideProtectedTree.mockClear();
    f.walker.mockClear();
    f.load.mockClear();
    f.save.mockClear();
    const reads = [
      jest.spyOn(fs, 'readFile'),
      jest.spyOn(fs, 'readdir'),
      jest.spyOn(fs, 'lstat'),
      jest.spyOn(fs, 'realpath'),
      jest.spyOn(fs, 'stat'),
      jest.spyOn(fs, 'opendir'),
    ];
    f.service.getLatest();
    expect(f.disk.peekCompletedSize).toHaveBeenCalledTimes(2);
    expect(f.disk.start).not.toHaveBeenCalled();
    expect(f.walker).not.toHaveBeenCalled();
    expect(f.guard.createProtectedTreeMatcher).not.toHaveBeenCalled();
    expect(f.guard.isInsideProtectedTree).not.toHaveBeenCalled();
    expect(f.load).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
    for (const read of reads) expect(read).not.toHaveBeenCalled();
  });

  it('keeps scan cache and walker data null while repeatedly enriching cloned responses', async () => {
    const f = await measurementFixture();
    f.disk.peekCompletedSize.mockReturnValue({ sizeBytes: 123, measuredAt });
    expect(f.service.getLatest().orphanNodeModules[0]).toMatchObject({
      sizeBytes: 123,
      sizeMeasuredAt: measuredAt,
    });
    f.service.getLatest();
    expect(f.save).toHaveBeenCalledTimes(1);
    const saved = f.save.mock.calls[0][0];
    for (const project of saved.result.projects) {
      expect(project.nodeModules.sizeBytes).toBeNull();
      expect(project.nodeModules).not.toHaveProperty(
        'sizeMeasuredAt',
        measuredAt,
      );
    }
    expect(saved.result.orphanNodeModules[0].sizeBytes).toBeNull();
    expect(f.value.projects[0].nodeModules.sizeBytes).toBeNull();
    expect(f.value.orphanNodeModules[0].sizeBytes).toBeNull();
  });

  it('loads an older last-scan result without sizeMeasuredAt and supplies null timestamps', async () => {
    const f = await measurementFixture();
    const saved = structuredClone(f.save.mock.calls[0][0]);
    for (const project of saved.result.projects)
      delete project.nodeModules.sizeMeasuredAt;
    for (const orphan of saved.result.orphanNodeModules)
      delete orphan.sizeMeasuredAt;
    f.load.mockResolvedValue(saved);
    await f.service.onModuleInit();
    const result = f.service.getLatest();
    expect(result.projects[0].nodeModules).toMatchObject({
      sizeBytes: null,
      sizeMeasuredAt: null,
    });
    expect(result.orphanNodeModules[0]).toMatchObject({
      sizeBytes: null,
      sizeMeasuredAt: null,
    });
    expect(saved.result.projects[0].nodeModules).not.toHaveProperty(
      'sizeMeasuredAt',
    );
    expect(f.disk.start).not.toHaveBeenCalled();
  });
});

function fixture(
  options: {
    roots?: string | null;
    depth?: number;
    timeout?: number;
    detector?: IDriveDetector;
  } = {},
) {
  const settings: Record<string, unknown> = {
    ...(options.roots === null
      ? {}
      : { SCAN_ROOT_PATHS: options.roots ?? root }),
    MAX_SCAN_DEPTH: options.depth ?? 0,
    ...(options.timeout === undefined
      ? {}
      : { SCAN_TIMEOUT_MS: options.timeout }),
  };
  const config = new ConfigService();
  jest.spyOn(config, 'get').mockImplementation((key: string) => settings[key]);
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
  const gate = new MutationGateService();
  const service = new ScannerService(
    config,
    guard as unknown as PathGuardService,
    detector,
    walker,
    cache,
    { peekCompletedSize: () => null } as unknown as DiskUsageService,
    gate,
  );
  return {
    service,
    gate,
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

describe('ScannerService.refreshProject', () => {
  const projectPath = 'D:\\TEST-refresh\\app';
  const siblingPath = 'D:\\TEST-refresh\\app-other';
  const entry = (name: string, directory = false, link = false): Dirent =>
    ({
      name,
      isFile: () => !directory,
      isDirectory: () => directory,
      isSymbolicLink: () => link,
    }) as Dirent;

  beforeEach(() => {
    jest.spyOn(pathUtil, 'toPathPlatform').mockReturnValue('win32');
  });
  afterEach(() => jest.restoreAllMocks());

  async function refreshFixture() {
    const f = fixture({ roots: 'D:\\TEST-refresh', depth: 4 });
    const result: IStoredScanResult = {
      scanId: 'TEST-refresh-scan',
      status: 'timed_out',
      partial: true,
      roots: ['D:\\TEST-refresh'],
      maxDepth: 4,
      startedAt: '2026-11-03T00:00:00.000Z',
      finishedAt: '2026-11-03T00:01:00.000Z',
      skippedCount: 3,
      projects: [projectPath, siblingPath].map((path) => ({
        path,
        name: 'TEST-old',
        packageManager: 'npm',
        hasLockfile: true,
        lastActivityAt: '2026-11-02T00:00:00.000Z',
        nodeModules: {
          exists: true,
          path: `${path}\\node_modules`,
          sizeBytes: null,
        },
      })),
      orphanNodeModules: [
        {
          path: 'D:\\TEST-refresh\\old\\node_modules',
          mtime: '2026-11-01T00:00:00.000Z',
          sizeBytes: null,
        },
      ],
    };
    const key = makeScanCacheKey(
      parseScanRootPaths('D:\\TEST-refresh', 'win32'),
      4,
      'win32',
    );
    f.load.mockResolvedValue({ schemaVersion: 1, key, result });
    await f.service.onModuleInit();
    let entries = [entry('package.json')];
    const readdir = jest
      .spyOn(fs, 'readdir')
      .mockImplementation(() =>
        Promise.resolve(
          entries as unknown as Awaited<ReturnType<typeof fs.readdir>>,
        ),
      );
    const lstat = jest.spyOn(fs, 'lstat').mockImplementation((path) =>
      Promise.resolve({
        mtimeMs: String(path).endsWith('index') ? 6000 : 1000,
        isFile: () =>
          !['node_modules', '.git'].some((name) => String(path).endsWith(name)),
        isDirectory: () =>
          ['node_modules', '.git'].some((name) => String(path).endsWith(name)),
        isSymbolicLink: () => false,
      } as unknown as Awaited<ReturnType<typeof fs.lstat>>),
    );
    const readFile = jest
      .spyOn(fs, 'readFile')
      .mockResolvedValue('{"name":"TEST-refreshed"}');
    return {
      ...f,
      result,
      key,
      readdir,
      lstat,
      readFile,
      setEntries: (value: Dirent[]) => {
        entries = value;
      },
    };
  }

  it('does nothing before a latest scan exists, without reading or saving', async () => {
    const f = await refreshFixture();
    const empty = fixture();
    await expect(
      empty.service.refreshProject(projectPath),
    ).resolves.toBeUndefined();
    expect(() => empty.service.getLatest()).toThrow(NotFoundException);
    expect(f.readdir).not.toHaveBeenCalled();
    expect(f.lstat).not.toHaveBeenCalled();
    expect(f.readFile).not.toHaveBeenCalled();
    expect(empty.save).not.toHaveBeenCalled();
  });

  it.each([
    'D:\\TEST-refresh',
    `${projectPath}\\child`,
    `${projectPath}-unknown`,
  ])('does not refresh an unscanned path %s', async (path) => {
    const f = await refreshFixture();
    const before = f.service.getLatest();
    await expect(f.service.refreshProject(path)).resolves.toBeUndefined();
    expect(f.service.getLatest()).toEqual(before);
    expect(f.readdir).not.toHaveBeenCalled();
    expect(f.lstat).not.toHaveBeenCalled();
    expect(f.readFile).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
  });

  it('rebuilds only the matching Windows project with scanner metadata rules while the gate is held', async () => {
    const f = await refreshFixture();
    const before = f.service.getLatest();
    f.setEntries([
      entry('PACKAGE.JSON'),
      entry('node_modules', true),
      entry('pnpm-lock.yaml'),
      entry('yarn.lock'),
      entry('package-lock.json'),
      entry('.git', true),
    ]);
    f.readFile.mockResolvedValue('\uFEFF{"name":"TEST-refreshed"}');
    const token = f.gate.tryEnter()!;
    await f.service.refreshProject('d:\\test-refresh\\APP');
    const after = f.service.getLatest();
    expect(after).toEqual({
      ...before,
      projects: [
        {
          path: projectPath,
          name: 'TEST-refreshed',
          packageManager: 'pnpm',
          hasLockfile: true,
          lastActivityAt: '1970-01-01T00:00:06.000Z',
          nodeModules: {
            exists: true,
            path: `${projectPath}\\node_modules`,
            sizeBytes: null,
            sizeMeasuredAt: null,
          },
        },
        before.projects[1],
      ],
    });
    expect(f.readdir).toHaveBeenCalledTimes(1);
    expect(f.readdir).toHaveBeenCalledWith(projectPath, {
      withFileTypes: true,
    });
    expect(f.readFile).toHaveBeenCalledWith(
      `${projectPath}\\PACKAGE.JSON`,
      expect.objectContaining({ encoding: 'utf8' }),
    );
    expect(f.walker).not.toHaveBeenCalled();
    expect(f.detect).not.toHaveBeenCalled();
    expect(f.gate.isBusy()).toBe(true);
    expect(f.gate.tryEnter()).toBeNull();
    f.gate.leave(token);
    expect(f.save).toHaveBeenCalledTimes(1);
    const saved = f.save.mock.calls[0][0];
    expect(saved.schemaVersion).toBe(1);
    expect(saved.key).toEqual(f.key);
    expect(saved.result).toMatchObject({
      ...f.result,
      projects: [
        { name: 'TEST-refreshed', packageManager: 'pnpm' },
        f.result.projects[1],
      ],
    });
    saved.result.projects[0].name = 'TEST-mutated-cache-copy';
    after.projects[0].name = 'TEST-mutated-response';
    expect(f.service.getLatest().projects[0].name).toBe('TEST-refreshed');
    expect(before.projects[0].name).toBe('TEST-old');
  });

  it('drops the project when a run removed its whole directory', async () => {
    const f = await refreshFixture();
    f.readdir.mockRejectedValue(
      Object.assign(new Error('TEST gone'), { code: 'ENOENT' }),
    );
    await f.service.refreshProject(projectPath);
    expect(f.service.getLatest().projects.map(({ path }) => path)).toEqual([
      f.result.projects[1].path,
    ]);
    expect(f.save).toHaveBeenCalledTimes(1);
  });

  it('keeps invalid JSON as a project and clears removed lockfile and modules metadata', async () => {
    const f = await refreshFixture();
    f.readFile.mockResolvedValue('{broken');
    await f.service.refreshProject(projectPath);
    expect(f.service.getLatest().projects[0]).toEqual({
      path: projectPath,
      name: null,
      packageManager: null,
      hasLockfile: false,
      lastActivityAt: '1970-01-01T00:00:01.000Z',
      nodeModules: {
        exists: false,
        path: `${projectPath}\\node_modules`,
        sizeBytes: null,
        sizeMeasuredAt: null,
      },
    });
  });

  it('does not follow symlinked node_modules or lockfiles', async () => {
    const f = await refreshFixture();
    f.setEntries([
      entry('package.json'),
      entry('node_modules', true, true),
      entry('pnpm-lock.yaml', false, true),
    ]);
    await f.service.refreshProject(projectPath);
    expect(f.service.getLatest().projects[0]).toMatchObject({
      packageManager: null,
      hasLockfile: false,
      nodeModules: { exists: false },
    });
    expect(f.lstat).toHaveBeenCalledTimes(1);
    expect(f.lstat).toHaveBeenCalledWith(`${projectPath}\\package.json`);
  });

  it('drops only the project when its manifest is gone, preserving existing orphans', async () => {
    const f = await refreshFixture();
    const before = f.service.getLatest();
    f.setEntries([entry('node_modules', true)]);
    await f.service.refreshProject(projectPath);
    expect(f.service.getLatest()).toEqual({
      ...before,
      projects: [before.projects[1]],
    });
    expect(f.save).toHaveBeenCalledWith({
      schemaVersion: 1,
      key: f.key,
      result: { ...f.result, projects: [f.result.projects[1]] },
    });
    expect(f.readFile).not.toHaveBeenCalled();
  });

  it.each(['readdir', 'lstat', 'readFile'] as const)(
    'propagates %s failure without changing RAM or saving',
    async (operation) => {
      const f = await refreshFixture();
      const before = f.service.getLatest();
      const error = Object.assign(new Error(`TEST ${operation} unavailable`), {
        code: operation === 'readdir' ? 'EACCES' : 'ENOENT',
      });
      f[operation].mockRejectedValueOnce(error);
      await expect(f.service.refreshProject(projectPath)).rejects.toBe(error);
      expect(f.service.getLatest()).toEqual(before);
      expect(f.save).not.toHaveBeenCalled();
    },
  );

  it('does not resolve until the refreshed cache has been saved', async () => {
    const f = await refreshFixture();
    const saving = deferred<void>();
    f.save.mockReturnValueOnce(saving.promise);
    let settled = false;
    const refresh = f.service.refreshProject(projectPath).then(() => {
      settled = true;
    });
    await tick();
    expect(f.save).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    saving.resolve();
    await refresh;
    expect(settled).toBe(true);
  });

  it('propagates cache-save failure while retaining the refreshed RAM entry', async () => {
    const f = await refreshFixture();
    const error = new Error('TEST cache unavailable');
    f.save.mockRejectedValueOnce(error);
    await expect(f.service.refreshProject(projectPath)).rejects.toBe(error);
    expect(f.service.getLatest().projects[0].name).toBe('TEST-refreshed');
    expect(f.save).toHaveBeenCalledTimes(1);
  });
});

describe('ScannerService.applyDeletions', () => {
  const paths = [
    'D:\\mono',
    'D:\\mono\\packages\\a',
    'D:\\mono\\packages\\b',
    'D:\\p',
    'D:\\ab',
  ];
  const orphanPaths = [
    'D:\\old\\node_modules',
    'D:\\older\\node_modules',
    'D:\\last\\node_modules',
  ];
  const measuredAt = '2026-10-30T00:00:00.000Z';

  beforeEach(() => {
    jest.spyOn(pathUtil, 'toPathPlatform').mockReturnValue('win32');
  });
  afterEach(() => jest.restoreAllMocks());

  // TEST metadata is loaded through the cache mock; no real scan or filesystem IO.
  async function deletionFixture(
    status: 'completed' | 'timed_out' = 'completed',
  ) {
    const f = fixture({ roots: 'D:\\', depth: 4 });
    const result: IStoredScanResult = {
      scanId: 'TEST-deletions',
      status,
      partial: status === 'timed_out',
      roots: ['D:\\'],
      maxDepth: 4,
      startedAt: '2026-10-29T00:00:00.000Z',
      finishedAt: '2026-10-29T00:01:00.000Z',
      skippedCount: 7,
      projects: paths.map((path, index) => ({
        path,
        name: `TEST-project-${index}`,
        packageManager: 'pnpm',
        hasLockfile: true,
        lastActivityAt: '2026-10-28T00:00:00.000Z',
        nodeModules: {
          exists: true,
          path: `${path}\\node_modules`,
          sizeBytes: null,
          sizeMeasuredAt: null,
        },
      })),
      orphanNodeModules: orphanPaths.map((path) => ({
        path,
        mtime: '2026-10-27T00:00:00.000Z',
        sizeBytes: null,
        sizeMeasuredAt: null,
      })),
    };
    const disk = {
      peekCompletedSize: jest.fn<ICompletedDiskSize | null, [string]>(
        () => null,
      ),
      clearCache: jest.fn(),
    };
    const service = new ScannerService(
      f.config,
      f.guard as unknown as PathGuardService,
      f.detector,
      f.walker,
      f.cache,
      disk as unknown as DiskUsageService,
      f.gate,
    );
    const key = makeScanCacheKey(
      parseScanRootPaths('D:\\', 'win32'),
      4,
      'win32',
    );
    f.load.mockResolvedValue({ schemaVersion: 1, key, result });
    await service.onModuleInit();
    return { ...f, service, disk, result, key };
  }

  it.each<[string, string, number[]]>([
    ['project root', 'D:\\p', [0, 1, 2, 4]],
    ['monorepo ancestor', 'D:\\mono', [3, 4]],
    ['nested project only', 'D:\\mono\\packages\\a', [0, 2, 3, 4]],
    ['package.json', 'D:\\p\\package.json', [0, 1, 2, 4]],
    ['case-insensitive package.json', 'd:\\P\\PACKAGE.JSON', [0, 1, 2, 4]],
  ])(
    'removes %s and preserves surviving project order',
    async (_label, deleted, survivors) => {
      const f = await deletionFixture();
      const before = f.service.getLatest();
      const original = structuredClone(before);
      f.service.applyDeletions([deleted]);
      const after = f.service.getLatest();
      expect(after).toEqual({
        ...original,
        projects: survivors.map((index) => original.projects[index]),
      });
      expect(before).toEqual(original);
      expect(f.save).toHaveBeenCalledTimes(1);
      expect(f.save).toHaveBeenCalledWith({
        schemaVersion: 1,
        key: f.key,
        result: after,
      });
      expect(f.result.projects).toHaveLength(5);
      expect(f.disk.clearCache).not.toHaveBeenCalled();
      expect(f.walker).not.toHaveBeenCalled();
    },
  );

  it.each(['D:\\p\\node_modules', 'd:\\P\\NODE_MODULES'])(
    'marks deleted modules %s absent without changing other project metadata',
    async (deleted) => {
      const f = await deletionFixture();
      const before = f.service.getLatest();
      f.service.applyDeletions([deleted]);
      const expected = structuredClone(before);
      expected.projects[3].nodeModules.exists = false;
      expect(f.service.getLatest()).toEqual(expected);
      expect(before.projects[3].nodeModules.exists).toBe(true);
      expect(f.save).toHaveBeenCalledTimes(1);
      expect(f.save).toHaveBeenCalledWith({
        schemaVersion: 1,
        key: f.key,
        result: expected,
      });
    },
  );

  it('marks modules absent when their ancestor is deleted but their project survives', async () => {
    const f = await deletionFixture();
    f.result.projects[3].nodeModules.path = 'D:\\p\\vendor\\node_modules';
    await f.service.onModuleInit();
    const before = f.service.getLatest();
    f.service.applyDeletions(['D:\\p\\vendor']);
    const expected = structuredClone(before);
    expected.projects[3].nodeModules.exists = false;
    expect(f.service.getLatest()).toEqual(expected);
    expect(f.save).toHaveBeenCalledTimes(1);
  });

  it.each(['D:\\old\\node_modules', 'D:\\old'])(
    'removes an orphan through %s, preserving sibling prefix and order',
    async (deleted) => {
      const f = await deletionFixture();
      const before = f.service.getLatest();
      f.service.applyDeletions([deleted]);
      expect(f.service.getLatest()).toEqual({
        ...before,
        orphanNodeModules: before.orphanNodeModules.slice(1),
      });
      expect(f.save).toHaveBeenCalledTimes(1);
    },
  );

  it.each<[string, readonly string[]]>([
    ['empty batch', []],
    ['ordinary project content', ['D:\\p\\src']],
    ['sibling prefix', ['D:\\a']],
    ['descendant of node_modules', ['D:\\p\\node_modules\\pkg']],
    ['descendant of orphan', ['D:\\old\\node_modules\\pkg']],
    ['unrelated path', ['D:\\unknown']],
  ])('does not save or change latest for %s', async (_label, deleted) => {
    const f = await deletionFixture();
    const before = f.service.getLatest();
    expect(() => f.service.applyDeletions(deleted)).not.toThrow();
    expect(f.service.getLatest()).toEqual(before);
    expect(f.save).not.toHaveBeenCalled();
  });

  it('does nothing without a latest result', () => {
    const f = fixture({ roots: 'D:\\' });
    expect(() => f.service.applyDeletions(['D:\\p'])).not.toThrow();
    expect(f.save).not.toHaveBeenCalled();
    expect(() => f.service.getLatest()).toThrow(NotFoundException);
  });

  it('does not save again when modules are already absent', async () => {
    const f = await deletionFixture();
    f.result.projects[3].nodeModules.exists = false;
    await f.service.onModuleInit();
    const before = f.service.getLatest();
    f.service.applyDeletions(['D:\\p\\node_modules']);
    expect(f.service.getLatest()).toEqual(before);
    expect(f.save).not.toHaveBeenCalled();
  });

  it('applies a mixed duplicate batch once and preserves partial scan metadata', async () => {
    const f = await deletionFixture('timed_out');
    const before = f.service.getLatest();
    const deleted: readonly string[] = Object.freeze([
      'D:\\mono\\packages',
      'D:\\p\\node_modules',
      'D:\\older',
      'D:\\p\\node_modules',
    ]);
    f.service.applyDeletions(deleted);
    const expected = structuredClone(before);
    expected.projects = [
      expected.projects[0],
      expected.projects[3],
      expected.projects[4],
    ];
    expected.projects[1].nodeModules.exists = false;
    expected.orphanNodeModules = [
      expected.orphanNodeModules[0],
      expected.orphanNodeModules[2],
    ];
    expect(f.service.getLatest()).toEqual(expected);
    expect(f.save).toHaveBeenCalledTimes(1);
    expect(f.save).toHaveBeenCalledWith({
      schemaVersion: 1,
      key: f.key,
      result: expected,
    });
    f.save.mockClear();
    f.service.applyDeletions(deleted);
    expect(f.save).not.toHaveBeenCalled();
  });

  it('warns on rejected cache persistence but keeps the updated RAM result', async () => {
    const f = await deletionFixture();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const failure = new Error('TEST cache unavailable');
    f.save.mockRejectedValueOnce(failure);
    expect(() => f.service.applyDeletions(['D:\\p'])).not.toThrow();
    expect(
      f.service.getLatest().projects.map((project) => project.path),
    ).toEqual([paths[0], paths[1], paths[2], paths[4]]);
    await tick();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('Could not save scan cache', failure);
    expect(f.service.getLatest().projects).toHaveLength(4);
  });

  it('returns null sizes for deleted modules despite stale disk cache and preserves prior responses', async () => {
    const f = await deletionFixture();
    f.disk.peekCompletedSize.mockReturnValue({ sizeBytes: 123, measuredAt });
    const before = f.service.getLatest();
    const original = structuredClone(before);
    f.disk.peekCompletedSize.mockClear();
    f.service.applyDeletions(['D:\\p\\node_modules']);
    expect(f.disk.peekCompletedSize).not.toHaveBeenCalled();
    expect(f.disk.clearCache).not.toHaveBeenCalled();
    expect(f.service.getLatest().projects[3].nodeModules).toEqual({
      path: 'D:\\p\\node_modules',
      exists: false,
      sizeBytes: null,
      sizeMeasuredAt: null,
    });
    expect(f.disk.peekCompletedSize).not.toHaveBeenCalledWith(
      'D:\\p\\node_modules',
    );
    expect(before).toEqual(original);
    expect(before.projects[3].nodeModules.sizeBytes).toBe(123);
    const saved = f.save.mock.calls[0][0];
    expect(saved.result.projects[3].nodeModules.exists).toBe(false);
    expect(
      saved.result.projects.every(
        (project) => project.nodeModules.sizeBytes === null,
      ),
    ).toBe(true);
    expect(
      saved.result.orphanNodeModules.every(
        (orphan) => orphan.sizeBytes === null,
      ),
    ).toBe(true);
  });

  it('does not cancel or change an active scan while updating latest', async () => {
    const f = await deletionFixture();
    const scan = f.service.startScan();
    await tick();
    const before = f.service.getScan(scan.scanId);
    try {
      f.service.applyDeletions(['D:\\p']);
      expect(f.service.getScan(scan.scanId)).toEqual(before);
      expect(f.service.hasRunningScan()).toBe(true);
      expect(f.walks[0].signal.aborted).toBe(false);
      expect(f.service.getLatest().projects).toHaveLength(4);
    } finally {
      f.service.cancelScan(scan.scanId);
    }
  });
});

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

  describe('mutation gate', () => {
    it('rejects a held gate before creating a job and starts after release', async () => {
      const f = fixture();
      const token = f.gate.tryEnter()!;
      let thrown: unknown;
      try {
        f.service.startScan();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(AppException);
      expect(thrown).toMatchObject({
        statusCode: 409,
        code: 'CONFLICT',
        message: 'A file operation or command run is in progress',
      });
      expect(f.service.hasRunningScan()).toBe(false);
      await tick();
      expect(f.walker).not.toHaveBeenCalled();
      expect(f.guard.createProtectedTreeMatcher).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);

      f.gate.leave(token);
      const start = f.service.startScan();
      expect(start.status).toBe('running');
      expect(f.service.hasRunningScan()).toBe(true);
      await tick();
      expect(f.walker).toHaveBeenCalledTimes(1);
      f.service.cancelScan(start.scanId);
    });

    it('checks the gate before reusing a running job and preserves that job', async () => {
      const f = fixture();
      const start = f.service.startScan();
      await tick();
      const before = f.service.getScan(start.scanId);
      const token = f.gate.tryEnter()!;
      let thrown: unknown;
      try {
        f.service.startScan();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(AppException);
      expect(thrown).toMatchObject({
        statusCode: 409,
        code: 'CONFLICT',
        message: 'A file operation or command run is in progress',
      });
      expect(f.service.getScan(start.scanId)).toEqual(before);
      expect(f.service.hasRunningScan()).toBe(true);
      expect(f.walker).toHaveBeenCalledTimes(1);
      f.gate.leave(token);
      expect(f.service.startScan()).toEqual(start);
      f.service.cancelScan(start.scanId);
    });

    it('reports idle initially, running synchronously, and idle after completion', async () => {
      const f = fixture();
      expect(f.service.hasRunningScan()).toBe(false);
      const start = f.service.startScan();
      expect(f.service.hasRunningScan()).toBe(true);
      await tick();
      f.walks[0].task.resolve(snapshot());
      await tick();
      expect(f.service.getScan(start.scanId).status).toBe('completed');
      expect(f.service.hasRunningScan()).toBe(false);
    });

    it('reports idle after cancellation even while the walker is unsettled', async () => {
      const f = fixture();
      const start = f.service.startScan();
      expect(f.service.hasRunningScan()).toBe(true);
      await tick();
      f.service.cancelScan(start.scanId);
      expect(f.service.hasRunningScan()).toBe(false);
      f.walks[0].task.resolve(snapshot());
      await tick();
      expect(f.service.hasRunningScan()).toBe(false);
    });

    it.each(['failed', 'timed_out'] as const)(
      'reports idle after a scan becomes %s',
      async (status) => {
        const f = fixture({ timeout: 1000 });
        const start = f.service.startScan();
        expect(f.service.hasRunningScan()).toBe(true);
        await tick();
        if (status === 'failed')
          f.walks[0].task.reject(new Error('TEST failure'));
        else jest.advanceTimersByTime(1000);
        await tick();
        expect(f.service.getScan(start.scanId).status).toBe(status);
        expect(f.service.hasRunningScan()).toBe(false);
      },
    );
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
    const f = fixture({ roots: null, detector, timeout: 1000 });
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

  it('keeps running beyond 900000 ms without a configured timeout and completes normally', async () => {
    const f = fixture();
    const scan = f.service.startScan();
    await tick();
    jest.advanceTimersByTime(900001);
    await tick();
    expect(f.service.getScan(scan.scanId)).toEqual(
      expect.objectContaining({
        status: 'running',
        partial: false,
        finishedAt: undefined,
      }),
    );
    expect(f.walks[0].signal.aborted).toBe(false);
    expect(() => f.service.getLatest()).toThrow(NotFoundException);
    const value = snapshot();
    f.walks[0].task.resolve(value);
    await tick();
    expect(f.service.getScan(scan.scanId).status).toBe('completed');
    expect(f.service.getLatest()).toEqual(
      expect.objectContaining({
        status: 'completed',
        partial: false,
        projects: value.projects,
        finishedAt: '2026-10-21T00:15:00.001Z',
      }),
    );
    expect(f.save).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps waiting for drive discovery beyond 900000 ms without a configured timeout', async () => {
    const discovery = deferred<string[]>();
    const f = fixture({
      roots: '*',
      detector: { listFixedDrives: () => discovery.promise },
    });
    const scan = f.service.startScan();
    jest.advanceTimersByTime(900001);
    await tick();
    expect(f.service.getScan(scan.scanId).status).toBe('running');
    discovery.resolve([root]);
    await tick();
    expect(f.walker).toHaveBeenCalledTimes(1);
    expect(f.service.cancelScan(scan.scanId)).toEqual(
      expect.objectContaining({ status: 'cancelled', partial: true }),
    );
    expect(f.walks[0].signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('timeout captures the walker snapshot resolved on abort, then freezes it', async () => {
    const f = fixture({ timeout: 1000 });
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
    const f = fixture({ timeout: 1000 });
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
        timeout: action === 'timeout' ? 1000 : undefined,
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
    const f = fixture({ roots: '*', timeout: 1000 });
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
    const f = fixture({ timeout: 1000 });
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
      const f = fixture({ timeout: 1000 });
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
    const result: IStoredScanResult = {
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
