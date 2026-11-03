import { Global, Logger, Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import type { BigIntStats, Dirent } from 'node:fs';
import type { Server } from 'node:http';
import * as nativeFs from 'node:fs/promises';
import { win32 } from 'node:path';
import request from 'supertest';
import { execa } from 'execa';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import { TransformInterceptor } from '@/common/interceptors/transform.interceptor';
import type { IApiResponse } from '@/common/interceptors/transform.interceptor';
import type {
  IGuardedPath,
  PathCheckResult,
} from '@/core/path-guard/interfaces/path-guard.types';
import { PathGuardService } from '@/core/path-guard/path-guard.service';
import { AuditLogService } from '@/core/audit-log/audit-log.service';
import type { IAuditRecord } from '@/core/audit-log/interfaces/audit-log.types';
import { MutationGateService } from '@/core/mutation-gate/mutation-gate.service';
import { ScannerService } from '@/scanner/scanner.service';
import { ScannerCache } from '@/scanner/scanner-cache';
import { SCAN_WALKER } from '@/scanner/scan-walker';
import type {
  IScanCacheEntry,
  IStoredScanResult,
  IWalkSnapshot,
  ScanWalker,
} from '@/scanner/interfaces/scanner.types';
import { DiskUsageService } from '@/disk-usage/disk-usage.service';
import { DISK_FS, DISK_WALKER } from '@/disk-usage/disk-usage-walker';
import type {
  DiskWalker,
  IDiskFs,
  IDiskUsageJob,
} from '@/disk-usage/interfaces/disk-usage.types';
import { FileOpsService } from '@/file-ops/file-ops.service';
import { GitProbe } from '@/file-ops/git-probe';
import { FILE_OPS_FS } from '@/file-ops/interfaces/file-ops.types';
import type {
  IExecuteInput,
  IFileOpsFsBundle,
} from '@/file-ops/interfaces/file-ops.types';
import { ProjectsService, PROJECT_RUNTIME } from '@/projects/projects.service';
import type {
  IProjectsRuntime,
  ProjectAnalyzer,
} from '@/projects/interfaces/projects.runtime';
import type { IAnalysisResult } from '@/projects/interfaces/projects.types';
import { DRIVE_DETECTOR } from '@/platform/interfaces/drive-detector.interface';
import { PROCESS_SNAPSHOT } from '@/platform/interfaces/process-snapshot.interface';
import { RECYCLE_BIN } from '@/platform/interfaces/recycle-bin.interface';
import { NpmRunnerModule } from '@/npm-runner/npm-runner.module';
import { NpmRunnerService } from '@/npm-runner/npm-runner.service';
import { NPM_RUNNER_RUNTIME } from '@/npm-runner/interfaces/npm-runner.runtime';
import type { INpmRunnerRuntime } from '@/npm-runner/interfaces/npm-runner.runtime';
import type {
  IRunJob,
  IRunStart,
} from '@/npm-runner/interfaces/npm-runner.types';
import type {
  IRunProcessCallbacks,
  IRunProcessExit,
} from '@/npm-runner/runner-process';
import { resolveRunnerTool } from '@/npm-runner/runner-tool';
import {
  fsFixture,
  key,
  nodeFile,
  npmDir,
  root,
} from '@/npm-runner/__fixtures__/runner-test.fixture';

jest.mock('execa', () => ({ execa: jest.fn() }));
jest.mock('@/common/utils/path.util', () => ({
  ...jest.requireActual<typeof import('@/common/utils/path.util')>(
    '@/common/utils/path.util',
  ),
  toPathPlatform: () => 'win32',
}));
jest.mock('node:fs/promises', () => {
  const blocked = () =>
    jest.fn(() => {
      throw new Error('TEST native filesystem IO forbidden');
    });
  return {
    lstat: blocked(),
    stat: blocked(),
    realpath: blocked(),
    readdir: blocked(),
    opendir: blocked(),
    access: blocked(),
    readFile: blocked(),
    open: blocked(),
    writeFile: blocked(),
    appendFile: blocked(),
    mkdir: blocked(),
    rm: blocked(),
    unlink: blocked(),
    rename: blocked(),
    copyFile: blocked(),
    readlink: blocked(),
  };
});

@Global()
@Module({
  providers: [
    { provide: ConfigService, useValue: {} },
    { provide: PathGuardService, useValue: {} },
    { provide: AuditLogService, useValue: {} },
  ],
  exports: [ConfigService, PathGuardService, AuditLogService],
})
class ContentionTestAdaptersModule {}

// TEST only; không phải yêu cầu nghiệp vụ. Real admission services; every external boundary is fake.
const id = '00000000-0000-4000-8000-000000000010';
const requestId = '00000000-0000-4000-8000-000000000020';
const other = 'D:\\TEST\\other';
const target = win32.join(root, 'node_modules');
const tick = async () => {
  for (let turn = 0; turn < 300; turn++) await Promise.resolve();
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const allowed = (path: string): IGuardedPath => ({
  inputPath: path,
  resolvedPath: path,
  realPath: path,
  isSymbolicLink: false,
});

function fixture() {
  const input = fsFixture();
  input.put(nodeFile, 'TEST never executed');
  input.put(
    win32.join(npmDir, 'package.json'),
    JSON.stringify({
      name: 'npm',
      version: '11.17.0',
      bin: { npm: 'bin/npm-cli.js' },
    }),
  );
  input.put(win32.join(npmDir, 'bin', 'npm-cli.js'), '// TEST inert entry');
  input.put(
    win32.join(root, 'package-lock.json'),
    JSON.stringify({
      name: 'TEST-project',
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { alpha: '^1.0.0' } },
        'node_modules/alpha': { version: '1.0.0' },
      },
    }),
  );
  input.put(
    win32.join(other, 'package.json'),
    JSON.stringify({ name: 'TEST-other', scripts: { dev: 'echo TEST' } }),
  );
  input.directory(target);
  input.scan.projects = [root, other].map((path) => ({
    path,
    name: 'TEST-old',
    packageManager: 'npm' as const,
    hasLockfile: path === root,
    lastActivityAt: '2020-01-01T00:00:00.000Z',
    nodeModules: {
      exists: path === root,
      path: win32.join(path, 'node_modules'),
      sizeBytes: null,
      sizeMeasuredAt: null,
    },
  }));
  input.deps.resolveTool = (manager) =>
    resolveRunnerTool(manager, input.snapshot, input.fs);
  const result: IStoredScanResult = {
    ...input.scan,
    status: 'completed',
    partial: false,
    roots: ['D:\\TEST'],
    maxDepth: 0,
    startedAt: '2026-11-03T03:00:00.000Z',
    finishedAt: '2026-11-03T03:00:00.000Z',
    skippedCount: 0,
    orphanNodeModules: [],
  };
  let persisted: IScanCacheEntry = {
    schemaVersion: 1,
    key: { roots: ['d:\\test'], maxDepth: 0 },
    result,
  };
  const load = jest.fn(() => Promise.resolve(structuredClone(persisted)));
  const save = jest.fn((entry: IScanCacheEntry) => {
    persisted = structuredClone(entry);
    return Promise.resolve();
  });
  const scanWait = deferred<IWalkSnapshot>();
  const diskWait = deferred<IDiskUsageJob>();
  const analysisWait = deferred<IAnalysisResult>();
  const scanWalker = jest.fn<ReturnType<ScanWalker>, Parameters<ScanWalker>>(
    () => scanWait.promise,
  );
  const diskWalker = jest.fn<ReturnType<DiskWalker>, Parameters<DiskWalker>>(
    () => diskWait.promise,
  );
  const analyze = jest.fn<
    ReturnType<ProjectAnalyzer>,
    Parameters<ProjectAnalyzer>
  >(() => analysisWait.promise);
  const guard = {
    assertAllowed: jest.fn((path: string) => Promise.resolve(allowed(path))),
    checkMany: jest.fn((paths: readonly string[]): Promise<PathCheckResult[]> =>
      Promise.resolve(
        paths.map((path) => ({ allowed: true, path: allowed(path) })),
      ),
    ),
    createProtectedTreeMatcher: jest.fn(() => Promise.resolve(() => false)),
    createOperationChecker: () => (paths: readonly string[]) =>
      guard.checkMany(paths),
    isInsideProtectedTree: () => Promise.resolve(false),
  };
  const entries = (directory: string): Dirent[] => {
    const children = [...input.stats.keys()].filter(
      (file) => key(win32.dirname(file)) === key(directory),
    );
    return children.map(
      (file) =>
        ({
          name: win32.basename(file),
          isFile: () => input.stats.get(file)!.isFile(),
          isDirectory: () => input.stats.get(file)!.isDirectory?.() ?? false,
          isSymbolicLink: () => false,
        }) as Dirent,
    );
  };
  const readFile = (path: string): Promise<string> => {
    const bytes = input.files.get(key(path));
    return bytes
      ? Promise.resolve(bytes.toString())
      : Promise.reject(
          Object.assign(new Error('TEST missing'), { code: 'ENOENT' }),
        );
  };
  const scanFs: IFileOpsFsBundle['scan'] = {
    readdir: (path) => Promise.resolve(entries(path)),
    readFile,
    lstat: async (path) => {
      const stat = await input.fs.lstat(path);
      return { ...stat, isDirectory: () => stat.isDirectory?.() ?? false };
    },
    realpath: (path) => input.fs.realpath(path),
  };
  const bigintStat = async (path: string): Promise<BigIntStats> => {
    const stat = await input.fs.lstat(path);
    return {
      dev: 1n,
      ino: BigInt([...input.stats.keys()].indexOf(key(path)) + 1),
      mode: 0n,
      nlink: 1n,
      uid: 0n,
      gid: 0n,
      rdev: 0n,
      size: BigInt(stat.size),
      blksize: 4096n,
      blocks: 0n,
      atimeMs: 1n,
      mtimeMs: 1n,
      ctimeMs: 1n,
      birthtimeMs: 1n,
      atimeNs: 1n,
      mtimeNs: 1n,
      ctimeNs: 1n,
      birthtimeNs: 1n,
      atime: new Date(1),
      mtime: new Date(1),
      ctime: new Date(1),
      birthtime: new Date(1),
      isFile: () => stat.isFile(),
      isDirectory: () => stat.isDirectory?.() ?? false,
      isSymbolicLink: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isFIFO: () => false,
      isSocket: () => false,
    };
  };
  const diskFs: IDiskFs = {
    lstat: jest.fn(bigintStat),
    realpath: (path) => Promise.resolve(path),
    async *entries(path, signal) {
      signal.throwIfAborted();
      for (const entry of entries(path)) yield await Promise.resolve(entry);
    },
  };
  const remove = jest.fn<
    ReturnType<IFileOpsFsBundle['remove']>,
    Parameters<IFileOpsFsBundle['remove']>
  >(() => Promise.resolve());
  const fsBundle: IFileOpsFsBundle = {
    scan: scanFs,
    remove,
    files: {
      lstat: bigintStat,
      readdir: (path) => Promise.resolve(entries(path)),
      readFile,
    },
  };
  const audit = jest.fn<Promise<void>, [IAuditRecord]>(() => Promise.resolve());
  const exit = deferred<IRunProcessExit>();
  let callbacks: IRunProcessCallbacks | undefined;
  const stop = jest.fn(() =>
    Promise.resolve<'verified' | 'unconfirmed'>('verified'),
  );
  const launch = jest.fn<
    ReturnType<INpmRunnerRuntime['launch']>,
    Parameters<INpmRunnerRuntime['launch']>
  >((_c, _e, listener) => {
    callbacks = listener;
    return { pid: 123, settled: exit.promise, stop };
  });
  const finish = async (
    termination: IRunProcessExit['termination'] = 'verified',
    overrides: Partial<IRunProcessExit> = {},
  ) => {
    const outcome: IRunProcessExit = {
      exitCode: 0,
      signal: null,
      failureCode: null,
      termination,
      outputTruncated: false,
      ...overrides,
    };
    exit.resolve(outcome);
    callbacks?.onExit(outcome);
    await tick();
  };
  const finishAnalysis = async () => {
    analysisWait.resolve({
      outdated: {
        state: 'complete',
        items: [],
        warningCodes: [],
        failureCode: null,
        checkedCount: 0,
        totalCount: 0,
      },
      audit: {
        state: 'complete',
        items: [],
        warningCodes: [],
        failureCode: null,
        checkedCount: 0,
        totalCount: 0,
      },
      partial: false,
      warningCodes: [],
    });
    await tick();
  };
  return {
    input,
    load,
    save,
    persisted: () => persisted,
    scanWalker,
    diskWalker,
    analyze,
    guard,
    entries,
    scanFs,
    diskFs,
    fsBundle,
    remove,
    audit,
    launch,
    stop,
    finish,
    finishAnalysis,
  };
}

describe('NpmRunner contention (real shared services, mocked IO)', () => {
  let f: ReturnType<typeof fixture>;
  let app: INestApplication<Server> | undefined;
  let scanner: ScannerService;
  let disk: DiskUsageService;
  let projects: ProjectsService;
  let fileOps: FileOpsService;
  let runner: NpmRunnerService;
  let gate: MutationGateService;
  let leave: jest.SpyInstance<void, [symbol]>;
  let runtime: INpmRunnerRuntime;

  beforeEach(async () => {
    f = fixture();
    jest.mocked(execa).mockClear();
    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() =>
        Promise.reject(new Error('TEST network forbidden')),
      );
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const native = nativeFs as unknown as {
      readdir: jest.Mock<Promise<Dirent[]>, [string]>;
      lstat: jest.Mock<ReturnType<typeof f.scanFs.lstat>, [string]>;
      realpath: jest.Mock<Promise<string>, [string]>;
      readFile: jest.Mock<Promise<string>, [string]>;
    };
    native.readdir.mockImplementation((path) =>
      Promise.resolve(f.entries(path)),
    );
    native.lstat.mockImplementation((path) => f.scanFs.lstat(path));
    native.realpath.mockImplementation((path) => f.scanFs.realpath(path));
    native.readFile.mockImplementation((path) =>
      f.scanFs.readFile(path, new AbortController().signal),
    );
    const projectRuntime: IProjectsRuntime = {
      input: {
        platform: 'win32',
        fs: f.input.fs,
        assertAllowed: async (path) =>
          (await f.guard.assertAllowed(path)).realPath,
        now: () => new Date(),
      },
      lifecycle: {
        getLatest: () => scanner.getLatest(),
        assertIdle: () => gate.assertIdle(),
        peekCompletedSize: (path) => disk.peekCompletedSize(path),
        now: () => new Date(),
        timeoutMs: undefined,
      },
      registry: {
        getPackageMetadata: () =>
          Promise.reject(new Error('TEST registry unused')),
        getBulkAdvisories: () =>
          Promise.reject(new Error('TEST registry unused')),
      },
      analyze: f.analyze,
    };
    const module = await Test.createTestingModule({
      imports: [ContentionTestAdaptersModule, NpmRunnerModule],
      providers: [
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
      ],
    })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({ SCAN_ROOT_PATHS: 'D:\\TEST', MAX_SCAN_DEPTH: 0 }),
      )
      .overrideProvider(PathGuardService)
      .useValue(f.guard)
      .overrideProvider(AuditLogService)
      .useValue({ append: f.audit })
      .overrideProvider(ScannerCache)
      .useValue({ load: f.load, save: f.save })
      .overrideProvider(SCAN_WALKER)
      .useValue(f.scanWalker)
      .overrideProvider(DISK_WALKER)
      .useValue(f.diskWalker)
      .overrideProvider(DISK_FS)
      .useValue(f.diskFs)
      .overrideProvider(FILE_OPS_FS)
      .useValue(f.fsBundle)
      .overrideProvider(GitProbe)
      .useValue({
        status: () => Promise.resolve({ state: 'not_repo' }),
        trackedNames: () => Promise.resolve({ state: 'not_repo' }),
      })
      .overrideProvider(DRIVE_DETECTOR)
      .useValue({ listFixedDrives: () => Promise.resolve(['D:\\']) })
      .overrideProvider(PROCESS_SNAPSHOT)
      .useValue({
        capture: () => Promise.resolve({ status: 'ok', processes: [] }),
      })
      .overrideProvider(RECYCLE_BIN)
      .useValue({
        recycle: () => Promise.reject(new Error('TEST recycle forbidden')),
      })
      .overrideProvider(PROJECT_RUNTIME)
      .useValue(projectRuntime)
      .overrideProvider(NPM_RUNNER_RUNTIME)
      .useFactory({
        inject: [
          ScannerService,
          DiskUsageService,
          FileOpsService,
          ProjectsService,
          MutationGateService,
        ],
        factory: (
          scan: ScannerService,
          sizes: DiskUsageService,
          files: FileOpsService,
          analysis: ProjectsService,
          mutation: MutationGateService,
        ) => {
          runtime = {
            input: { ...f.input.deps, getScanSnapshot: () => scan.getLatest() },
            env: f.input.snapshot.env,
            timeoutMs: undefined,
            processes: {
              capture: () => Promise.resolve({ status: 'unknown' }),
              descendants: () => Promise.resolve({ status: 'unknown' }),
              stopTree: () => Promise.resolve('attempted'),
              verifyGone: () => Promise.resolve('verified'),
            },
            gate: mutation,
            readers: {
              hasRunningScan: () => scan.hasRunningScan(),
              hasRunningMeasurement: () => sizes.hasRunningMeasurement(),
              hasRunningPreview: () => files.hasRunningPreview(),
              hasRunningAnalysis: () => analysis.hasRunningAnalysis(),
            },
            audit: {
              writeIntent: () => Promise.resolve(),
              writeResult: () => Promise.resolve(),
            },
            invalidation: {
              refreshProject: (path) => scan.refreshProject(path),
              clearDiskUsage: () => sizes.clearCache(),
              staleAnalysis: (path) => analysis.invalidateAfterMutation(path),
            },
            launch: f.launch,
            now: () => new Date(),
            uuid: () => id,
            setTimer: (callback, ms) => setTimeout(callback, ms),
            clearTimer: (timer) => clearTimeout(timer),
          };
          return runtime;
        },
      })
      .compile();
    app = module.createNestApplication<INestApplication<Server>>();
    app.setGlobalPrefix('api/v1');
    scanner = app.get(ScannerService);
    disk = app.get(DiskUsageService);
    projects = app.get(ProjectsService);
    fileOps = app.get(FileOpsService);
    runner = app.get(NpmRunnerService);
    gate = app.get(MutationGateService);
    leave = jest.spyOn(gate, 'leave');
    await app.listen(0, '127.0.0.1');
  });
  afterEach(async () => {
    try {
      if (app) {
        jest.spyOn(runner, 'onModuleDestroy').mockResolvedValue();
        await app.close();
      }
      expect(execa).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      app = undefined;
      jest.restoreAllMocks();
    }
  });
  const startRun = async (path = root) => {
    if (!app) throw new Error('TEST app unavailable');
    const context = await runner.context(path);
    const response = await request(app.getHttpServer())
      .post('/api/v1/npm-runs')
      .send({
        path,
        requestId,
        inputHash: context.inputHash,
        action: 'install_all',
      })
      .expect(202);
    return (response.body as IApiResponse<IRunStart>).data!;
  };
  const rejectRun = async () => {
    if (!app) throw new Error('TEST app unavailable');
    const response = await request(app.getHttpServer())
      .post('/api/v1/npm-runs')
      .send({
        path: root,
        requestId,
        inputHash: 'a'.repeat(64),
        action: 'install_all',
      })
      .expect(409);
    expect(
      (response.body as { details: { reason: string } }).details.reason,
    ).toBe('READERS_RUNNING');
    expect(f.launch).not.toHaveBeenCalled();
  };
  const preparedDelete = async (): Promise<IExecuteInput> => {
    const preview = fileOps.startDeletePreview({ paths: [target] });
    await tick();
    expect(fileOps.getPreview(preview.previewId).status).toBe('completed');
    const summary = fileOps.summarizePreview(preview.previewId, [target]);
    return {
      previewId: preview.previewId,
      paths: [target],
      confirm: true,
      acknowledgedRisks: summary.risk.reasons.map((reason) => reason.code),
      ...(summary.confirmText === null
        ? {}
        : { confirmText: summary.confirmText }),
    };
  };

  it('scan first reserves its slot before walker IO and rejects the run', async () => {
    const scan = scanner.startScan();
    await rejectRun();
    expect(scanner.hasRunningScan()).toBe(true);
    scanner.cancelScan(scan.scanId);
  });
  it('measurement first reserves its slot and rejects the run', async () => {
    const size = await disk.start({ path: target });
    await rejectRun();
    disk.cancel(size.jobId);
    expect(f.diskWalker).toHaveBeenCalledTimes(1);
  });
  it('analysis first reserves its slot and rejects the run', async () => {
    const analysis = await projects.start({ path: root });
    await rejectRun();
    projects.cancel(analysis.jobId);
    expect(f.analyze).toHaveBeenCalledTimes(1);
  });
  it('FileOps preview first rejects the run while its guard IO is paused', async () => {
    const barrier = deferred<PathCheckResult[]>();
    f.guard.checkMany.mockReturnValueOnce(barrier.promise);
    const preview = fileOps.startDeletePreview({ paths: [target] });
    await rejectRun();
    expect(fileOps.hasRunningPreview()).toBe(true);
    fileOps.cancelPreview(preview.previewId);
    barrier.resolve([{ allowed: true, path: allowed(target) }]);
    await tick();
  });

  it('a run in paused preflight rejects scan, measurement, analysis and preview before work starts', async () => {
    const context = await runner.context(root);
    const barrier = deferred<string>();
    runtime.input.assertAllowed = () => barrier.promise;
    await runner.start({
      path: root,
      requestId,
      inputHash: context.inputHash,
      action: 'install_all',
    });
    expect(() => scanner.startScan()).toThrow();
    await expect(disk.start({ path: target })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await expect(projects.start({ path: other })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(() => fileOps.startDeletePreview({ paths: [target] })).toThrow();
    expect(f.scanWalker).not.toHaveBeenCalled();
    expect(f.diskWalker).not.toHaveBeenCalled();
    expect(f.analyze).not.toHaveBeenCalled();
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.launch).not.toHaveBeenCalled();
    barrier.resolve(root);
    await tick();
    await f.finish();
  });

  it.each(['measurement', 'analysis'] as const)(
    'a %s preflight begun earlier loses its final reservation to a run',
    async (reader) => {
      const barrier = deferred<IGuardedPath>();
      f.guard.assertAllowed.mockReturnValueOnce(barrier.promise);
      const pending =
        reader === 'measurement'
          ? disk.start({ path: target })
          : projects.start({ path: other });
      const observed = expect(pending).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      await startRun();
      await tick();
      barrier.resolve(allowed(reader === 'measurement' ? target : other));
      await observed;
      expect(f.diskWalker).not.toHaveBeenCalled();
      expect(f.analyze).not.toHaveBeenCalled();
      await f.finish();
    },
  );

  it('a run at another project still blocks FileOps execute without delete/audit IO', async () => {
    const input = await preparedDelete();
    const auditCalls = f.audit.mock.calls.length;
    await startRun(other);
    await tick();
    await expect(fileOps.startExecute(input)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(f.audit.mock.calls).toHaveLength(auditCalls);
    expect(f.remove).not.toHaveBeenCalled();
    await f.finish();
  });

  it('FileOps execute reserves before awaited intent and rejects a run without disturbing its lease', async () => {
    const input = await preparedDelete();
    const audit = deferred<void>();
    f.audit.mockReturnValueOnce(audit.promise);
    const execute = fileOps.startExecute(input);
    await tick();
    expect(gate.isBusy()).toBe(true);
    await expect(
      runner.start({
        path: other,
        action: 'install_all',
        requestId,
        inputHash: 'a'.repeat(64),
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'RUNNING' },
    });
    expect(f.launch).not.toHaveBeenCalled();
    expect(leave).not.toHaveBeenCalled();
    audit.resolve();
    await execute;
    await tick();
    expect(f.remove).toHaveBeenCalledTimes(1);
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it.each([0, 7])(
    'spawned exit %i refreshes persisted metadata before release; completed analysis becomes stale',
    async (exitCode) => {
      const analysis = await projects.start({ path: root });
      await f.finishAnalysis();
      expect(projects.get(analysis.jobId).status).toBe('completed');
      const stale = jest.spyOn(projects, 'invalidateAfterMutation');
      const refresh = jest.spyOn(scanner, 'refreshProject');
      const clear = jest.spyOn(disk, 'clearCache');
      await startRun();
      await tick();
      f.input.put(
        win32.join(root, 'package.json'),
        JSON.stringify({
          name: 'TEST-new-name',
          scripts: { dev: 'echo TEST' },
        }),
      );
      await f.finish('verified', {
        exitCode,
        failureCode: exitCode === 0 ? null : 'COMMAND_FAILED',
      });
      expect(
        scanner.getLatest().projects.find((project) => project.path === root)
          ?.name,
      ).toBe('TEST-new-name');
      expect(
        f.persisted().result.projects.find((project) => project.path === root)
          ?.name,
      ).toBe('TEST-new-name');
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(clear).toHaveBeenCalledTimes(1);
      expect(stale).toHaveBeenCalledTimes(1);
      const staleJob = projects.get(analysis.jobId);
      expect(staleJob.stale).toBe(true);
      expect(staleJob.warningCodes).toContain('INPUT_CHANGED');
      expect(f.load).toHaveBeenCalledTimes(1);
      expect(leave.mock.invocationCallOrder[0]).toBeGreaterThan(
        f.save.mock.invocationCallOrder.at(-1)!,
      );
      expect(runner.get(id)).toMatchObject({
        status: exitCode === 0 ? 'completed' : 'failed',
        exitCode,
        gateHeld: false,
      });
    },
  );

  it('failed cache persistence holds every reader, retry repeats only failed cleanup and releases once', async () => {
    f.save.mockRejectedValueOnce(new Error('TEST cache save failure'));
    const clear = jest.spyOn(disk, 'clearCache');
    const stale = jest.spyOn(projects, 'invalidateAfterMutation');
    await startRun();
    await tick();
    await f.finish();
    expect(runner.get(id)).toMatchObject({
      gateHeld: true,
      refreshRequired: true,
    });
    expect(() => scanner.startScan()).toThrow();
    expect(() => fileOps.startDeletePreview({ paths: [target] })).toThrow();
    await expect(disk.start({ path: target })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await expect(projects.start({ path: other })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(leave).not.toHaveBeenCalled();
    await runner.cancel(id);
    await tick();
    expect(runner.get(id).gateHeld).toBe(false);
    expect(f.save).toHaveBeenCalledTimes(2);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(stale).toHaveBeenCalledTimes(1);
    expect(f.launch).toHaveBeenCalledTimes(1);
    expect(f.stop).not.toHaveBeenCalled();
    expect(leave).toHaveBeenCalledTimes(1);
    scanner.startScan();
    expect(scanner.hasRunningScan()).toBe(true);
  });

  it('unconfirmed tree + result audit failure retry stays serialized and never respawns', async () => {
    const written = jest.fn(() => Promise.resolve());
    written.mockRejectedValueOnce(new Error('TEST audit fail'));
    runtime.audit.writeResult = written;
    await startRun();
    await tick();
    await f.finish('unconfirmed');
    expect(runner.get(id)).toMatchObject({
      gateHeld: true,
      auditWritten: false,
    });
    const stop = deferred<'verified' | 'unconfirmed'>();
    f.stop.mockReturnValueOnce(stop.promise);
    await runner.cancel(id);
    await runner.cancel(id);
    expect(f.stop).toHaveBeenCalledTimes(1);
    expect(written).toHaveBeenCalledTimes(1);
    expect(leave).not.toHaveBeenCalled();
    stop.resolve('verified');
    await tick();
    const snapshot: IRunJob = runner.get(id);
    expect(snapshot).toMatchObject({
      gateHeld: false,
      terminationVerified: true,
      auditWritten: true,
    });
    expect(written).toHaveBeenCalledTimes(2);
    expect(f.launch).toHaveBeenCalledTimes(1);
    expect(leave).toHaveBeenCalledTimes(1);
  });
});
