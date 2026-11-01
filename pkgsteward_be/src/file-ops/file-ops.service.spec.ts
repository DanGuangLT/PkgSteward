import { Logger } from '@nestjs/common';
import {
  AppException,
  NotFoundException,
  ValidationException,
} from '@/common/exceptions/app.exception';
import * as paths from '@/common/utils/path.util';
import type { AuditLogService } from '@/core/audit-log/audit-log.service';
import type { IAuditRecord } from '@/core/audit-log/interfaces/audit-log.types';
import type { MutationGateService } from '@/core/mutation-gate/mutation-gate.service';
import type { PathGuardService } from '@/core/path-guard/path-guard.service';
import type { PathCheckResult } from '@/core/path-guard/interfaces/path-guard.types';
import type { IRisk } from '@/core/risk/interfaces/risk.types';
import type { DiskUsageService } from '@/disk-usage/disk-usage.service';
import type { IDiskFs } from '@/disk-usage/interfaces/disk-usage.types';
import * as discovery from '@/file-ops/cleanup-discovery';
import * as deleter from '@/file-ops/file-deleter';
import * as assessment from '@/file-ops/file-ops-assessment';
import * as measurement from '@/file-ops/file-ops-measure';
import type { ITargetMeasurement } from '@/file-ops/file-ops-measure';
import { FileOpsService } from '@/file-ops/file-ops.service';
import * as tree from '@/file-ops/file-tree';
import type { GitProbe } from '@/file-ops/git-probe';
import type {
  DeleteOutcome,
  IExecuteInput,
  IFileOpsFsBundle,
  IFileOpsFs,
  IFileOpsStat,
  IGitProbe,
  ITargetSize,
} from '@/file-ops/interfaces/file-ops.types';
import { OperationStore } from '@/file-ops/operation-store';
import { PreviewStore } from '@/file-ops/preview-store';
import type { IProcessSnapshot } from '@/platform/interfaces/process-snapshot.interface';
import type { IRecycleBin } from '@/platform/interfaces/recycle-bin.interface';
import type { IScanResult } from '@/scanner/interfaces/scanner.types';
import type { ScannerService } from '@/scanner/scanner.service';

jest.mock('execa', () => ({
  execa: jest.fn(() => {
    throw new Error('Unexpected external command');
  }),
}));
jest.mock('node:fs/promises', () => ({
  lstat: jest
    .fn()
    .mockRejectedValue(new Error('Unexpected real filesystem access')),
  readdir: jest
    .fn()
    .mockRejectedValue(new Error('Unexpected real filesystem access')),
  readFile: jest
    .fn()
    .mockRejectedValue(new Error('Unexpected real filesystem access')),
  realpath: jest
    .fn()
    .mockRejectedValue(new Error('Unexpected real filesystem access')),
  opendir: jest
    .fn()
    .mockRejectedValue(new Error('Unexpected real filesystem access')),
  rm: jest
    .fn()
    .mockRejectedValue(new Error('Unexpected real filesystem access')),
  appendFile: jest
    .fn()
    .mockRejectedValue(new Error('Unexpected real filesystem access')),
}));

// TEST fixtures only; not business requirements.
const NOW = new Date('2026-10-29T05:00:00.000Z');
const OLD = '2026-09-01T00:00:00.000Z';
const LOW: IRisk = { level: 'low', reasons: [] };
const HIGH: IRisk = {
  level: 'high',
  reasons: [
    {
      code: 'DELETE_WHOLE_PROJECT',
      level: 'high',
      message: 'TEST whole project',
    },
  ],
};
const emptySize = (status: ITargetSize['status']): ITargetSize => ({
  status,
  apparentBytes: null,
  sizeBytes: null,
  reclaimableBytes: null,
  sharedBytes: null,
  fileCount: null,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const measured = (
  sizeBytes = 100,
  reclaimableBytes = 70,
): measurement.MeasureResult => ({
  status: 'done',
  size: {
    apparentBytes: sizeBytes + 20,
    sizeBytes,
    reclaimableBytes,
    sharedBytes: sizeBytes - reclaimableBytes,
    fileCount: 2,
  },
});
const target = (
  path: string,
  overrides: Partial<assessment.IAssessedTarget> = {},
): assessment.IAssessedTarget => ({
  inputPath: path,
  path,
  kind: 'node_modules',
  method: 'permanent',
  valid: true,
  failureCode: null,
  owner: { path: 'D:\\TEST-app', name: 'TEST-app' },
  nestedProjects: [],
  identity: { dev: '7', ino: '9007199254740993', type: 'directory' },
  hasLockfile: true,
  lastActivityAt: OLD,
  risk: structuredClone(LOW),
  defaultSelected: true,
  ...overrides,
});
const invalid = (path: string) =>
  target(path, {
    kind: null,
    method: null,
    valid: false,
    failureCode: 'DENYLISTED',
    owner: null,
    identity: null,
    hasLockfile: null,
    lastActivityAt: null,
    defaultSelected: false,
  });
const candidate = (
  path: string,
  kind: discovery.ICleanupCandidate['kind'] = 'node_modules',
): discovery.ICleanupCandidate => ({
  path,
  kind,
  ownerPath: 'D:\\TEST-app',
  trackedCheck: kind === 'build_cache' ? 'clean' : null,
  frameworkVerified: kind === 'build_cache' ? true : null,
});

function fixture() {
  jest.spyOn(paths, 'toPathPlatform').mockReturnValue('win32');
  const scan: IScanResult = {
    scanId: 'TEST-scan',
    status: 'completed',
    partial: false,
    roots: ['D:\\'],
    maxDepth: 0,
    startedAt: OLD,
    finishedAt: OLD,
    skippedCount: 0,
    projects: [
      {
        path: 'D:\\TEST-app',
        name: 'TEST-app',
        packageManager: 'pnpm',
        hasLockfile: true,
        lastActivityAt: OLD,
        nodeModules: {
          exists: true,
          path: 'D:\\TEST-app\\node_modules',
          sizeBytes: 999,
          sizeMeasuredAt: OLD,
        },
      },
    ],
    orphanNodeModules: [
      {
        path: 'D:\\TEST-loose\\node_modules',
        sizeBytes: 888,
        sizeMeasuredAt: OLD,
        mtime: OLD,
      },
    ],
  };
  const scanner = {
    getLatest: jest.fn(() => structuredClone(scan)),
    hasRunningScan: jest.fn(() => false),
    applyDeletions: jest.fn<void, [readonly string[]]>(),
  };
  const gateToken = Symbol('TEST-mutation');
  const gate = {
    assertIdle: jest.fn(),
    tryEnter: jest.fn<symbol | null, []>(() => gateToken),
    leave: jest.fn<void, [symbol]>(),
  };
  const diskUsage = {
    hasRunningMeasurement: jest.fn(() => false),
    clearCache: jest.fn<void, []>(),
  };
  const audit = {
    append: jest
      .fn<Promise<void>, [IAuditRecord]>()
      .mockResolvedValue(undefined),
  };
  const recycle = jest
    .fn<
      ReturnType<IRecycleBin['recycle']>,
      Parameters<IRecycleBin['recycle']>
    >()
    .mockRejectedValue(new Error('Unexpected recycling'));
  const recycleBin: jest.Mocked<IRecycleBin> = { recycle };
  const guard = { checkMany: jest.fn().mockResolvedValue([]) };
  const fileLstat = jest
    .fn<ReturnType<IFileOpsFs['lstat']>, Parameters<IFileOpsFs['lstat']>>()
    .mockRejectedValue(new Error('Unexpected file I/O'));
  const fs: IFileOpsFsBundle = {
    remove: jest.fn().mockRejectedValue(new Error('Unexpected removal')),
    files: {
      lstat: fileLstat,
      readdir: jest.fn().mockRejectedValue(new Error('Unexpected file I/O')),
      readFile: jest.fn().mockRejectedValue(new Error('Unexpected file I/O')),
    },
    scan: {
      lstat: jest.fn().mockRejectedValue(new Error('Unexpected scan I/O')),
      readdir: jest.fn().mockRejectedValue(new Error('Unexpected scan I/O')),
      readFile: jest.fn().mockRejectedValue(new Error('Unexpected scan I/O')),
      realpath: jest.fn().mockRejectedValue(new Error('Unexpected scan I/O')),
    },
  };
  const diskEntries = jest.fn<
    ReturnType<IDiskFs['entries']>,
    Parameters<IDiskFs['entries']>
  >(() => {
    throw new Error('Unexpected disk I/O');
  });
  const diskFs: jest.Mocked<IDiskFs> = {
    entries: diskEntries,
    lstat: jest.fn().mockRejectedValue(new Error('Unexpected disk I/O')),
    realpath: jest.fn().mockRejectedValue(new Error('Unexpected disk I/O')),
  };
  const gitStatus = jest
    .fn<ReturnType<IGitProbe['status']>, Parameters<IGitProbe['status']>>()
    .mockResolvedValue({ state: 'clean' });
  const git: jest.Mocked<IGitProbe> = {
    status: gitStatus,
    trackedNames: jest.fn().mockResolvedValue({ state: 'ok', tracked: [] }),
  };
  const capture = jest
    .fn<
      ReturnType<IProcessSnapshot['capture']>,
      Parameters<IProcessSnapshot['capture']>
    >()
    .mockResolvedValue({ status: 'ok', processes: [] });
  const processes: jest.Mocked<IProcessSnapshot> = { capture };
  const assess = jest.spyOn(assessment, 'assessTargets').mockResolvedValue([]);
  const discover = jest
    .spyOn(discovery, 'discoverCleanupCandidates')
    .mockResolvedValue([]);
  const measure = jest
    .spyOn(measurement, 'measureTarget')
    .mockResolvedValue(measured());
  const readTree = jest.spyOn(tree, 'readTreeLevel').mockResolvedValue({
    path: 'D:\\TEST-app',
    owner: { path: 'D:\\TEST-app', name: 'TEST-app' },
    entries: [],
    truncated: false,
  });
  const log = jest
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);
  const service = new FileOpsService(
    scanner as unknown as ScannerService,
    gate as unknown as MutationGateService,
    guard as unknown as PathGuardService,
    fs,
    diskFs,
    git as unknown as GitProbe,
    processes,
    diskUsage as unknown as DiskUsageService,
    audit as unknown as AuditLogService,
    recycleBin,
  );
  return {
    service,
    scan,
    scanner,
    gate,
    guard,
    fs,
    diskFs,
    git,
    processes,
    assess,
    discover,
    measure,
    readTree,
    log,
    fileLstat,
    diskEntries,
    gitStatus,
    capture,
    diskUsage,
    audit,
    recycle,
    recycleBin,
    gateToken,
  };
}

// Fake timers drain queued work and promise continuations without real sleeping.
const flush = () => jest.advanceTimersByTimeAsync(0);
function failure(action: () => unknown): AppException {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AppException);
  return caught as AppException;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

// Execute tests use the real preview/store/confirmation flow and mock I/O boundaries.
const EXEC_A = 'D:\\TEST-app\\node_modules';
const EXEC_B = 'D:\\TEST-app\\.next';
const EXEC_C = 'D:\\TEST-app\\src';
const MANIFEST = 'D:\\TEST-app\\package.json';
const PRIVATE_ERROR =
  'TEST private filesystem path / command line --token=secret';
const MEDIUM: IRisk = {
  level: 'medium',
  reasons: [
    { code: 'NO_LOCKFILE', level: 'medium', message: 'TEST no lockfile' },
  ],
};
const CONTENT_RISK: IRisk = {
  level: 'high',
  reasons: [
    { code: 'DELETE_PROJECT_CONTENT', level: 'high', message: 'TEST content' },
  ],
};
const ioError = (code: string) =>
  Object.assign(new Error(PRIVATE_ERROR), { code });
const executeStat = (file = false, ino = '9007199254740993'): IFileOpsStat => ({
  dev: 7n,
  ino: BigInt(ino),
  size: 100n,
  isFile: () => file,
  isDirectory: () => !file,
  isSymbolicLink: () => false,
});
const allowedPath = (path: string): PathCheckResult => ({
  allowed: true,
  path: {
    inputPath: path,
    resolvedPath: path,
    realPath: path,
    isSymbolicLink: false,
  },
});

async function executeFixture(
  rows = [target(EXEC_A), target(EXEC_B, { kind: 'build_cache' })],
  configure?: (f: ReturnType<typeof fixture>) => void,
) {
  const f = fixture();
  const events: string[] = [];
  const nodes = new Map<string, IFileOpsStat | Error>();
  for (const row of rows) {
    if (row.identity) {
      nodes.set(paths.toComparable(row.path, 'win32'), {
        ...executeStat(row.identity.type === 'file', row.identity.ino),
        dev: BigInt(row.identity.dev),
      });
    }
    if (row.owner)
      nodes.set(
        paths.toComparable(
          paths.pathApi('win32').join(row.owner.path, 'package.json'),
          'win32',
        ),
        executeStat(true),
      );
  }
  f.fileLstat.mockImplementation((path) => {
    events.push(`stat:${path}`);
    const value =
      nodes.get(paths.toComparable(path, 'win32')) ?? ioError('ENOENT');
    return value instanceof Error
      ? Promise.reject(value)
      : Promise.resolve(value);
  });
  f.guard.checkMany.mockImplementation((selected: readonly string[]) => {
    events.push(`guard:${selected.join('|')}`);
    return Promise.resolve(selected.map(allowedPath));
  });
  f.assess.mockImplementation(() => Promise.resolve(structuredClone(rows)));
  const deleteOne = jest
    .spyOn(deleter, 'deleteTarget')
    .mockImplementation((input) => {
      events.push(`delete:${input.path}`);
      return Promise.resolve({
        status: 'success',
        method:
          input.kind === 'project' || input.kind === 'project_content'
            ? 'recycle'
            : 'permanent',
      });
    });
  f.audit.append.mockImplementation((record) => {
    events.push(`audit:${record.phase}:${record.targets.join('|')}`);
    return Promise.resolve();
  });
  f.gate.tryEnter.mockImplementation(() => {
    events.push('enter');
    return f.gateToken;
  });
  f.gate.leave.mockImplementation(() => {
    events.push('leave');
  });
  f.scanner.applyDeletions.mockImplementation(() => {
    events.push('apply');
  });
  f.diskUsage.clearCache.mockImplementation(() => {
    events.push('clear');
  });
  configure?.(f);
  const { previewId } = f.service.startDeletePreview({
    paths: rows.map(({ path }) => path),
  });
  await flush();
  f.assess.mockClear();
  f.measure.mockClear();
  f.scanner.getLatest.mockClear();
  events.length = 0;
  const input: IExecuteInput = {
    previewId,
    paths: rows.filter((row) => row.valid).map(({ path }) => path),
    confirm: true,
  };
  return { ...f, previewId, input, rows, nodes, deleteOne, events };
}
type ExecuteFixture = Awaited<ReturnType<typeof executeFixture>>;

function expectNoDeletion(f: ExecuteFixture) {
  expect(f.deleteOne).not.toHaveBeenCalled();
  expect(f.fs.remove).not.toHaveBeenCalled();
  expect(f.recycle).not.toHaveBeenCalled();
}
async function expectExecuteError(
  f: ExecuteFixture,
  input: IExecuteInput,
  statusCode: number,
  code: string,
  entered = false,
  details?: object,
) {
  await expect(f.service.startExecute(input)).rejects.toMatchObject({
    statusCode,
    code,
    ...(details ? { details } : {}),
  });
  expectNoDeletion(f);
  expect(f.audit.append).not.toHaveBeenCalled();
  expect(f.service.getPreview(f.previewId).operationId).toBeNull();
  if (entered) {
    expect(f.gate.leave).toHaveBeenCalledTimes(1);
    expect(f.gate.leave).toHaveBeenCalledWith(f.gateToken);
  } else {
    expect(f.gate.tryEnter).not.toHaveBeenCalled();
    expect(f.gate.leave).not.toHaveBeenCalled();
    expect(f.assess).not.toHaveBeenCalled();
  }
}

describe('FileOpsService execute validation and concurrency', () => {
  it.each([
    ['empty', [], []],
    ['duplicate', [EXEC_A, EXEC_A], [EXEC_A]],
    ['outside preview', [EXEC_A, 'D:\\TEST-outside'], ['D:\\TEST-outside']],
    ['different spelling', [EXEC_A.toLowerCase()], [EXEC_A.toLowerCase()]],
  ] satisfies [string, string[], string[]][])(
    'rejects %s paths before acquiring the gate',
    async (_name, selected, invalidPaths) => {
      const f = await executeFixture();
      await expectExecuteError(
        f,
        { ...f.input, paths: selected },
        400,
        'VALIDATION_ERROR',
        false,
        { paths: invalidPaths },
      );
      expect(f.scanner.getLatest).not.toHaveBeenCalled();
    },
  );

  it('validates empty paths before looking up an unknown preview', async () => {
    const f = await executeFixture();
    await expectExecuteError(
      f,
      { ...f.input, previewId: 'TEST-missing', paths: [] },
      400,
      'VALIDATION_ERROR',
      false,
      { paths: [] },
    );
  });

  it('returns 404 for a missing preview', async () => {
    const f = await executeFixture();
    await expectExecuteError(
      f,
      { ...f.input, previewId: 'TEST-missing' },
      404,
      'NOT_FOUND',
    );
  });

  it('rejects a running preview', async () => {
    const f = await executeFixture(undefined, (base) => {
      base.measure.mockReturnValue(
        deferred<measurement.MeasureResult>().promise,
      );
    });
    await expectExecuteError(f, f.input, 409, 'CONFLICT');
    f.service.cancelPreview(f.previewId);
  });

  it('rejects a failed preview', async () => {
    const f = await executeFixture(undefined, (base) => {
      base.assess.mockRejectedValue(new Error(PRIVATE_ERROR));
    });
    expect(f.service.getPreview(f.previewId).status).toBe('failed');
    await expectExecuteError(f, f.input, 409, 'CONFLICT');
  });

  it('rejects an invalid preview target', async () => {
    const f = await executeFixture([target(EXEC_A), invalid(EXEC_B)]);
    await expectExecuteError(
      f,
      { ...f.input, paths: [EXEC_B] },
      400,
      'VALIDATION_ERROR',
      false,
      { paths: [EXEC_B] },
    );
  });

  it.each(['failed', 'cancelled'] as const)(
    'rejects a target whose size is %s',
    async (status) => {
      const f = await executeFixture(undefined, (base) => {
        if (status === 'failed')
          base.measure.mockResolvedValue({
            status: 'failed',
            reason: 'read_error',
          });
        else
          base.measure.mockReturnValue(
            deferred<measurement.MeasureResult>().promise,
          );
      });
      if (status === 'cancelled') f.service.cancelPreview(f.previewId);
      await expectExecuteError(
        f,
        { ...f.input, paths: [EXEC_A] },
        400,
        'VALIDATION_ERROR',
        false,
        { paths: [EXEC_A] },
      );
    },
  );

  it.each(['identities', 'measurements', 'record'] as const)(
    'rejects missing server-side %s before entering the gate',
    async (missing) => {
      const f = await executeFixture();
      const { identity } = target(EXEC_A);
      const size: ITargetMeasurement = {
        apparentBytes: 120,
        sizeBytes: 100,
        reclaimableBytes: 70,
        sharedBytes: 30,
        fileCount: 2,
      };
      jest.spyOn(PreviewStore.prototype, 'getFacts').mockImplementation(() =>
        missing === 'record'
          ? undefined
          : {
              identities: new Map(
                missing === 'identities' ? [] : [[EXEC_A, identity!]],
              ),
              measurements: new Map(
                missing === 'measurements' ? [] : [[EXEC_A, size]],
              ),
            },
      );
      await expectExecuteError(
        f,
        { ...f.input, paths: [EXEC_A] },
        400,
        'VALIDATION_ERROR',
        false,
        { paths: [EXEC_A] },
      );
    },
  );

  it.each(['scan', 'measurement', 'preview'] as const)(
    'rejects a running %s before preflight',
    async (busy) => {
      const f = await executeFixture();
      if (busy === 'scan') f.scanner.hasRunningScan.mockReturnValue(true);
      if (busy === 'measurement')
        f.diskUsage.hasRunningMeasurement.mockReturnValue(true);
      let otherPreview: string | undefined;
      if (busy === 'preview') {
        f.assess.mockReturnValue(
          deferred<assessment.IAssessedTarget[]>().promise,
        );
        otherPreview = f.service.startDeletePreview({
          paths: [EXEC_C],
        }).previewId;
        f.assess.mockClear();
      }
      await expectExecuteError(f, f.input, 409, 'CONFLICT');
      if (otherPreview) f.service.cancelPreview(otherPreview);
    },
  );

  it("does not release another operation's busy gate", async () => {
    const f = await executeFixture();
    f.gate.tryEnter.mockReturnValue(null);
    await expect(f.service.startExecute(f.input)).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
    });
    expect(f.gate.tryEnter).toHaveBeenCalledTimes(1);
    expect(f.gate.leave).not.toHaveBeenCalled();
    expect(f.assess).not.toHaveBeenCalled();
    expect(f.audit.append).not.toHaveBeenCalled();
    expectNoDeletion(f);
  });

  it('checks readers and acquires the gate synchronously before awaiting preflight', async () => {
    const f = await executeFixture();
    const waiting = deferred<assessment.IAssessedTarget[]>();
    f.scanner.hasRunningScan.mockImplementation(() => {
      f.events.push('scan-idle');
      return false;
    });
    f.diskUsage.hasRunningMeasurement.mockImplementation(() => {
      f.events.push('disk-idle');
      return false;
    });
    f.assess.mockImplementation(() => {
      f.events.push('assess');
      return waiting.promise;
    });
    f.gate.tryEnter
      .mockImplementationOnce(() => {
        f.events.push('enter');
        return f.gateToken;
      })
      .mockReturnValue(null);
    const first = f.service.startExecute(f.input);
    // Attach a rejection observer immediately so the phase-1 stub cannot leak an unhandled rejection.
    const observed = first.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    expect(f.scanner.hasRunningScan).toHaveBeenCalledTimes(1);
    expect(f.diskUsage.hasRunningMeasurement).toHaveBeenCalledTimes(1);
    expect(f.gate.tryEnter).toHaveBeenCalledTimes(1);
    expect(f.events).toEqual(['scan-idle', 'disk-idle', 'enter', 'assess']);
    await expect(f.service.startExecute(f.input)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(f.assess).toHaveBeenCalledTimes(1);
    waiting.resolve(f.rows);
    expect(await observed).toHaveProperty('value');
    await flush();
    expect(f.gate.leave).toHaveBeenCalledTimes(1);
  });
});

describe('FileOpsService execute preflight', () => {
  it('rejects a changed latest scan before reassessment', async () => {
    const f = await executeFixture();
    f.scanner.getLatest.mockReturnValue({
      ...f.scan,
      scanId: 'TEST-replacement',
    });
    await expectExecuteError(f, f.input, 409, 'SCAN_CHANGED', true);
    expect(f.assess).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid', { valid: false, failureCode: 'PROJECT_CHANGED' }],
    ['real path', { path: 'D:\\TEST-redirected' }],
    ['kind', { kind: 'project_content' }],
    ['method', { method: 'recycle' }],
    [
      'device',
      { identity: { dev: '8', ino: '9007199254740993', type: 'directory' } },
    ],
    [
      'inode',
      { identity: { dev: '7', ino: '9007199254740994', type: 'directory' } },
    ],
    ['type', { identity: { dev: '7', ino: '9007199254740993', type: 'file' } }],
    ['missing identity', { identity: null }],
    ['wrong input path', { inputPath: EXEC_C }],
  ] satisfies [string, Partial<assessment.IAssessedTarget>][])(
    'rejects changed %s without consuming the preview',
    async (_name, override) => {
      const f = await executeFixture();
      f.assess.mockResolvedValue([target(EXEC_A, override), f.rows[1]]);
      await expectExecuteError(f, f.input, 409, 'TARGET_CHANGED', true, {
        paths: [EXEC_A],
      });
    },
  );

  it('rejects a target omitted by reassessment', async () => {
    const f = await executeFixture();
    f.assess.mockResolvedValue([f.rows[1]]);
    await expectExecuteError(f, f.input, 409, 'TARGET_CHANGED', true, {
      paths: [EXEC_A],
    });
  });

  it.each(['level increase', 'new code at same level'])(
    'rejects risk %s even when the caller acknowledges it',
    async (change) => {
      const f = await executeFixture([target(EXEC_A, { risk: MEDIUM })]);
      const risk: IRisk =
        change === 'level increase'
          ? HIGH
          : {
              level: 'medium',
              reasons: [
                ...MEDIUM.reasons,
                {
                  code: 'RECENTLY_ACTIVE',
                  level: 'medium',
                  message: 'TEST recent',
                },
              ],
            };
      f.assess.mockResolvedValue([target(EXEC_A, { risk })]);
      await expectExecuteError(
        f,
        {
          ...f.input,
          acknowledgedRisks: [
            'NO_LOCKFILE',
            'RECENTLY_ACTIVE',
            'DELETE_WHOLE_PROJECT',
          ],
          confirmText: 'DELETE 1',
        },
        409,
        'RISK_CHANGED',
        true,
        { paths: [EXEC_A] },
      );
    },
  );

  it.each([undefined, false, 'true', null])(
    'rejects confirm=%s with current low risk',
    async (confirm) => {
      const f = await executeFixture();
      await expectExecuteError(
        f,
        { ...f.input, confirm },
        400,
        'VALIDATION_ERROR',
        true,
        { field: 'confirm' },
      );
    },
  );

  it('requires all medium-risk codes', async () => {
    const f = await executeFixture([target(EXEC_A, { risk: MEDIUM })]);
    await expectExecuteError(
      f,
      { ...f.input, acknowledgedRisks: [] },
      400,
      'VALIDATION_ERROR',
      true,
      { field: 'acknowledgedRisks', missingRisks: ['NO_LOCKFILE'] },
    );
  });

  it('requires the exact project folder name for a single high-risk project', async () => {
    const f = await executeFixture([
      target('D:\\TEST-app', {
        kind: 'project',
        method: 'recycle',
        risk: HIGH,
      }),
    ]);
    await expectExecuteError(
      f,
      {
        ...f.input,
        acknowledgedRisks: ['DELETE_WHOLE_PROJECT'],
        confirmText: 'DELETE 1',
      },
      400,
      'VALIDATION_ERROR',
      true,
      { field: 'confirmText' },
    );
  });

  it('requires LARGE_BATCH for the selected bytes, using retained measurements', async () => {
    const f = await executeFixture(undefined, (base) => {
      base.measure.mockResolvedValue(measured(5_000_000_000, 70));
    });
    await expectExecuteError(
      f,
      { ...f.input, paths: [EXEC_A], acknowledgedRisks: [] },
      400,
      'VALIDATION_ERROR',
      true,
      { field: 'acknowledgedRisks', missingRisks: ['LARGE_BATCH'] },
    );
    expect(f.measure).not.toHaveBeenCalled();
  });

  it('does not inherit LARGE_BATCH from unselected targets', async () => {
    const f = await executeFixture(undefined, (base) => {
      base.measure.mockImplementation((path) =>
        Promise.resolve(measured(path === EXEC_A ? 100 : 5_000_000_000)),
      );
    });
    f.assess.mockResolvedValue([f.rows[0]]);
    const started = await f.service.startExecute({
      ...f.input,
      paths: [EXEC_A],
    });
    await flush();
    expect(f.service.getOperation(started.operationId).status).toBe(
      'completed',
    );
    expect(f.audit.append.mock.calls[0][0].risk).toEqual({
      level: 'low',
      codes: [],
    });
    expect(f.deleteOne).toHaveBeenCalledTimes(1);
  });

  it('requires LARGE_BATCH at twenty selected targets even when their bytes are small', async () => {
    const rows = Array.from({ length: 21 }, (_, index) =>
      target(`D:\\TEST-app\\TEST-cache-${index}`, { kind: 'build_cache' }),
    );
    const f = await executeFixture(rows);
    const selected = rows.slice(0, 20);
    f.assess.mockResolvedValue(selected);
    await expectExecuteError(
      f,
      {
        ...f.input,
        paths: selected.map(({ path }) => path),
        acknowledgedRisks: [],
      },
      400,
      'VALIDATION_ERROR',
      true,
      {
        field: 'acknowledgedRisks',
        missingRisks: ['LARGE_BATCH'],
      },
    );
  });

  it('accepts a single high-risk project with the exact folder name and all codes', async () => {
    const f = await executeFixture([
      target('D:\\TEST-app', {
        kind: 'project',
        method: 'recycle',
        risk: HIGH,
      }),
    ]);
    const started = await f.service.startExecute({
      ...f.input,
      acknowledgedRisks: ['DELETE_WHOLE_PROJECT'],
      confirmText: 'TEST-app',
    });
    await flush();
    expect(f.service.getOperation(started.operationId)).toMatchObject({
      status: 'completed',
      results: [
        { status: 'success', method: 'recycle', reclaimableBytes: null },
      ],
    });
  });

  it('accepts decreased risk and case-equivalent canonical paths', async () => {
    const f = await executeFixture([target(EXEC_A, { risk: MEDIUM })]);
    f.assess.mockResolvedValue([
      target(EXEC_A, { path: EXEC_A.toLowerCase() }),
    ]);
    const started = await f.service.startExecute(f.input);
    await flush();
    expect(f.service.getOperation(started.operationId).status).toBe(
      'completed',
    );
    expect(f.audit.append.mock.calls[0][0].risk).toEqual({
      level: 'low',
      codes: [],
    });
    expect(f.audit.append.mock.calls[1][0].risk).toEqual({
      level: 'low',
      codes: [],
    });
  });

  it('reassesses with fresh dependencies and scan metadata without cleanup facts or cached sizes', async () => {
    const f = await executeFixture();
    f.scanner.getLatest.mockReturnValue({
      ...f.scan,
      projects: [{ ...f.scan.projects[0], name: 'TEST-latest-metadata' }],
    });
    await f.service.startExecute(f.input);
    await flush();
    expect(f.assess).toHaveBeenCalledTimes(1);
    const call = f.assess.mock.calls[0];
    expect(call).toHaveLength(3);
    expect(call[0]).toEqual([EXEC_A, EXEC_B]);
    expect(call[1].projects[0]).toMatchObject({
      name: 'TEST-latest-metadata',
      nodeModules: {
        sizeBytes: null,
        sizeMeasuredAt: null,
      },
    });
    expect(call[1].orphanNodeModules[0]).toMatchObject({
      sizeBytes: null,
      sizeMeasuredAt: null,
    });
    expect(call[2]).toMatchObject({
      fs: f.fs,
      git: f.git,
      processes: f.processes,
      selfPid: process.pid,
      platform: 'win32',
      now: NOW,
    });
    expect(call[2].signal).toBeInstanceOf(AbortSignal);
    expect(f.measure).not.toHaveBeenCalled();
  });

  it.each(['latest', 'assessment'] as const)(
    'releases the gate when %s unexpectedly throws',
    async (where) => {
      const f = await executeFixture();
      const error = new Error('TEST preflight failure');
      if (where === 'latest')
        f.scanner.getLatest.mockImplementation(() => {
          throw error;
        });
      else f.assess.mockRejectedValue(error);
      await expect(f.service.startExecute(f.input)).rejects.toBe(error);
      expect(f.gate.leave).toHaveBeenCalledWith(f.gateToken);
      expect(f.audit.append).not.toHaveBeenCalled();
      expectNoDeletion(f);
      expect(f.service.getPreview(f.previewId).operationId).toBeNull();
    },
  );

  it('maps intent audit failure to a safe 500 and allows a later attempt', async () => {
    const f = await executeFixture();
    f.audit.append.mockRejectedValueOnce(new Error(PRIVATE_ERROR));
    await expect(f.service.startExecute(f.input)).rejects.toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Audit log is unavailable',
    });
    expectNoDeletion(f);
    expect(f.gate.leave).toHaveBeenCalledWith(f.gateToken);
    expect(f.service.getPreview(f.previewId).operationId).toBeNull();
    const started = await f.service.startExecute(f.input);
    await flush();
    expect(f.service.getOperation(started.operationId).status).toBe(
      'completed',
    );
    expect(f.deleteOne).toHaveBeenCalledTimes(2);
    expect(f.gate.leave).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(f.log.mock.calls)).not.toContain(PRIVATE_ERROR);
  });

  it.each(['create', 'attach'] as const)(
    'releases the gate when operation %s throws after intent',
    async (where) => {
      const f = await executeFixture();
      const error = new Error('TEST store failure');
      if (where === 'create')
        jest
          .spyOn(OperationStore.prototype, 'create')
          .mockImplementation(() => {
            throw error;
          });
      else
        jest
          .spyOn(PreviewStore.prototype, 'attachOperation')
          .mockImplementation(() => {
            throw error;
          });
      await expect(f.service.startExecute(f.input)).rejects.toBe(error);
      expect(f.audit.append).toHaveBeenCalledTimes(1);
      expectNoDeletion(f);
      expect(f.gate.leave).toHaveBeenCalledWith(f.gateToken);
      expect(f.service.getPreview(f.previewId).operationId).toBeNull();
    },
  );
});

describe('FileOpsService execute operations and replay', () => {
  it('waits for intent durability before attaching an operation or starting deletion', async () => {
    const f = await executeFixture();
    const intent = deferred<void>();
    f.audit.append.mockReturnValueOnce(intent.promise);
    const pending = f.service.startExecute(f.input);
    const observed = pending.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await flush();
    expect(f.audit.append).toHaveBeenCalledTimes(1);
    expect(f.service.getPreview(f.previewId).operationId).toBeNull();
    expectNoDeletion(f);
    expect(f.gate.leave).not.toHaveBeenCalled();
    intent.resolve(undefined);
    const result = await observed;
    expect(result).toHaveProperty('value');
    await flush();
    expect(f.service.getPreview(f.previewId).operationId).not.toBeNull();
    expect(f.deleteOne).toHaveBeenCalledTimes(2);
  });

  it('waits for each result audit before deleting the next target', async () => {
    const f = await executeFixture();
    const resultAudit = deferred<void>();
    f.audit.append
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(resultAudit.promise);
    const started = await f.service.startExecute(f.input);
    await flush();
    expect(f.deleteOne).toHaveBeenCalledTimes(1);
    expect(f.service.getOperation(started.operationId).status).toBe('running');
    expect(f.gate.leave).not.toHaveBeenCalled();
    resultAudit.resolve(undefined);
    await flush();
    expect(f.deleteOne).toHaveBeenCalledTimes(2);
    expect(f.service.getOperation(started.operationId).status).toBe(
      'completed',
    );
  });

  it('publishes progress and deletes sequentially in preview order with matching audits', async () => {
    const f = await executeFixture([
      target(EXEC_A),
      target(EXEC_C, {
        kind: 'project_content',
        method: 'recycle',
        risk: CONTENT_RISK,
      }),
      target(EXEC_B, { kind: 'build_cache' }),
    ]);
    const waiting = deferred<DeleteOutcome>();
    f.deleteOne.mockImplementationOnce((input) => {
      f.events.push(`delete:${input.path}`);
      return waiting.promise;
    });
    const started = await f.service.startExecute({
      ...f.input,
      paths: [EXEC_B, EXEC_C, EXEC_A],
      acknowledgedRisks: ['DELETE_PROJECT_CONTENT'],
      confirmText: 'DELETE 3',
    });
    expect(started).toEqual({
      operationId: expect.any(String) as unknown,
      status: 'running',
    });
    expect(f.service.getPreview(f.previewId).operationId).toBe(
      started.operationId,
    );
    await flush();
    const running = f.service.getOperation(started.operationId);
    expect(running).toMatchObject({
      previewId: f.previewId,
      status: 'running',
      currentPath: EXEC_A,
      startedAt: NOW.toISOString(),
      results: [
        {
          path: EXEC_A,
          status: 'running',
          errorCode: null,
          mayBePartial: false,
          reclaimableBytes: 70,
        },
        {
          path: EXEC_C,
          status: 'pending',
          errorCode: null,
          mayBePartial: false,
          reclaimableBytes: null,
        },
        {
          path: EXEC_B,
          status: 'pending',
          errorCode: null,
          mayBePartial: false,
          reclaimableBytes: 70,
        },
      ],
    });
    expect(running.finishedAt).toBeUndefined();
    expect(f.deleteOne).toHaveBeenCalledTimes(1);
    expect(f.gate.leave).not.toHaveBeenCalled();
    expect(f.audit.append).toHaveBeenCalledTimes(1);
    expect(f.audit.append.mock.calls[0][0]).toEqual({
      operation: 'file-ops.delete',
      operationId: started.operationId,
      phase: 'intent',
      targets: [EXEC_A, EXEC_C, EXEC_B],
      method: 'permanent+recycle',
      risk: { level: 'high', codes: ['DELETE_PROJECT_CONTENT'] },
      result: 'pending',
      errorCode: null,
    });
    waiting.resolve({ method: 'permanent', status: 'success' });
    await flush();
    const completed = f.service.getOperation(started.operationId);
    expect(completed).toMatchObject({
      status: 'completed',
      currentPath: null,
      finishedAt: NOW.toISOString(),
      results: [
        {
          path: EXEC_A,
          status: 'success',
          kind: 'node_modules',
          method: 'permanent',
          reclaimableBytes: 70,
        },
        {
          path: EXEC_C,
          status: 'success',
          kind: 'project_content',
          method: 'recycle',
          reclaimableBytes: null,
        },
        {
          path: EXEC_B,
          status: 'success',
          kind: 'build_cache',
          method: 'permanent',
          reclaimableBytes: 70,
        },
      ],
    });
    expect(f.deleteOne.mock.calls.map(([input]) => input)).toEqual([
      { path: EXEC_A, kind: 'node_modules', apparentBytes: 120 },
      { path: EXEC_C, kind: 'project_content', apparentBytes: 120 },
      { path: EXEC_B, kind: 'build_cache', apparentBytes: 120 },
    ]);
    for (const [, deps] of f.deleteOne.mock.calls) {
      expect(deps).toEqual({ rm: f.fs.remove, recycleBin: f.recycleBin });
    }
    expect(
      f.audit.append.mock.calls.slice(1).map(([record]) => record),
    ).toEqual([
      {
        operation: 'file-ops.delete',
        operationId: started.operationId,
        phase: 'result',
        targets: [EXEC_A],
        method: 'permanent',
        risk: { level: 'low', codes: [] },
        result: 'success',
        errorCode: null,
      },
      {
        operation: 'file-ops.delete',
        operationId: started.operationId,
        phase: 'result',
        targets: [EXEC_C],
        method: 'recycle',
        risk: { level: 'high', codes: ['DELETE_PROJECT_CONTENT'] },
        result: 'success',
        errorCode: null,
      },
      {
        operation: 'file-ops.delete',
        operationId: started.operationId,
        phase: 'result',
        targets: [EXEC_B],
        method: 'permanent',
        risk: { level: 'low', codes: [] },
        result: 'success',
        errorCode: null,
      },
    ]);
    expect(f.events.filter((event) => /^(audit|delete):/.test(event))).toEqual([
      `audit:intent:${EXEC_A}|${EXEC_C}|${EXEC_B}`,
      `delete:${EXEC_A}`,
      `audit:result:${EXEC_A}`,
      `delete:${EXEC_C}`,
      `audit:result:${EXEC_C}`,
      `delete:${EXEC_B}`,
      `audit:result:${EXEC_B}`,
    ]);
    expect(f.scanner.applyDeletions).toHaveBeenCalledWith([
      EXEC_A,
      EXEC_C,
      EXEC_B,
    ]);
    expect(f.diskUsage.clearCache).toHaveBeenCalledTimes(1);
    expect(f.gate.leave).toHaveBeenCalledWith(f.gateToken);
    expect(f.events.slice(-3)).toEqual(['apply', 'clear', 'leave']);
    expect(running.results[0].status).toBe('running');
    expect(f.measure).not.toHaveBeenCalled();
  });

  it('executes measured targets from a cancelled preview', async () => {
    const f = await executeFixture(undefined, (base) => {
      base.measure.mockImplementation((path) =>
        path === EXEC_A
          ? Promise.resolve(measured())
          : deferred<measurement.MeasureResult>().promise,
      );
    });
    f.service.cancelPreview(f.previewId);
    f.assess.mockResolvedValue([f.rows[0]]);
    const started = await f.service.startExecute({
      ...f.input,
      paths: [EXEC_A],
    });
    await flush();
    expect(f.service.getOperation(started.operationId).results).toEqual([
      expect.objectContaining({ path: EXEC_A, status: 'success' }),
    ]);
  });

  it.each(['running', 'stopping', 'completed'] as const)(
    'replays the same set in reverse order with the current %s status and no new work',
    async (status) => {
      const f = await executeFixture();
      const waiting = deferred<DeleteOutcome>();
      f.deleteOne.mockReturnValueOnce(waiting.promise);
      const started = await f.service.startExecute(f.input);
      await flush();
      if (status === 'stopping') f.service.cancelOperation(started.operationId);
      if (status === 'completed') {
        waiting.resolve({ method: 'permanent', status: 'success' });
        await flush();
      }
      const before = {
        gate: f.gate.tryEnter.mock.calls.length,
        audit: f.audit.append.mock.calls.length,
        deletes: f.deleteOne.mock.calls.length,
        assess: f.assess.mock.calls.length,
      };
      // Replay bypasses new confirmation and reader conflicts, since it cannot delete again.
      f.scanner.hasRunningScan.mockReturnValue(true);
      f.diskUsage.hasRunningMeasurement.mockReturnValue(true);
      const replay = await f.service.startExecute({
        previewId: f.previewId,
        paths: [EXEC_B, EXEC_A],
        confirm: false,
      });
      expect(replay).toEqual({ operationId: started.operationId, status });
      expect(f.gate.tryEnter).toHaveBeenCalledTimes(before.gate);
      expect(f.audit.append).toHaveBeenCalledTimes(before.audit);
      expect(f.deleteOne).toHaveBeenCalledTimes(before.deletes);
      expect(f.assess).toHaveBeenCalledTimes(before.assess);
      if (status !== 'completed') {
        waiting.resolve({ method: 'permanent', status: 'success' });
        await flush();
      }
    },
  );

  it.each([
    { name: 'subset', selected: [EXEC_A] },
    { name: 'different spelling', selected: [EXEC_A.toLowerCase(), EXEC_B] },
  ])(
    'rejects replay with a different exact path set: $name',
    async ({ selected }) => {
      const f = await executeFixture();
      await f.service.startExecute(f.input);
      await flush();
      f.gate.tryEnter.mockClear();
      f.audit.append.mockClear();
      f.deleteOne.mockClear();
      f.assess.mockClear();
      await expect(
        f.service.startExecute({ ...f.input, paths: selected }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'CONFLICT',
      });
      expect(f.gate.tryEnter).not.toHaveBeenCalled();
      expect(f.audit.append).not.toHaveBeenCalled();
      expect(f.assess).not.toHaveBeenCalled();
      expectNoDeletion(f);
    },
  );

  it('refuses replay after the operation was evicted instead of deleting again', async () => {
    const f = await executeFixture();
    await f.service.startExecute(f.input);
    await flush();
    jest.spyOn(OperationStore.prototype, 'get').mockReturnValue(undefined);
    f.gate.tryEnter.mockClear();
    f.audit.append.mockClear();
    f.deleteOne.mockClear();
    await expect(f.service.startExecute(f.input)).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
    });
    expect(f.gate.tryEnter).not.toHaveBeenCalled();
    expect(f.audit.append).not.toHaveBeenCalled();
    expectNoDeletion(f);
  });

  it.each(['getOperation', 'cancelOperation'] as const)(
    'returns 404 from %s for an unknown ID',
    (method) => {
      const f = fixture();
      expect(failure(() => f.service[method]('TEST-missing'))).toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
      });
    },
  );
});

describe('FileOpsService immediate target checks', () => {
  it.each([
    ['changed inode', 'TARGET_CHANGED'],
    ['changed device', 'TARGET_CHANGED'],
    ['changed type', 'TARGET_CHANGED'],
    ['symbolic link', 'TARGET_CHANGED'],
    ['ENOENT', 'TARGET_GONE'],
    ['ENOTDIR', 'TARGET_GONE'],
    ['EACCES', 'TARGET_CHANGED'],
    ['guard denied', 'TARGET_CHANGED'],
    ['guard not found', 'TARGET_GONE'],
    ['guard throws', 'TARGET_CHANGED'],
    ['guard link', 'TARGET_CHANGED'],
    ['guard redirected', 'TARGET_CHANGED'],
    ['guard empty', 'TARGET_CHANGED'],
  ])(
    'skips %s and continues with the next target',
    async (problem, errorCode) => {
      const f = await executeFixture();
      const key = paths.toComparable(EXEC_A, 'win32');
      if (problem === 'changed inode')
        f.nodes.set(key, executeStat(false, '9007199254740994'));
      if (problem === 'changed device')
        f.nodes.set(key, { ...executeStat(), dev: 8n });
      if (problem === 'changed type') f.nodes.set(key, executeStat(true));
      if (problem === 'symbolic link')
        f.nodes.set(key, { ...executeStat(), isSymbolicLink: () => true });
      if (['ENOENT', 'ENOTDIR', 'EACCES'].includes(problem))
        f.nodes.set(key, ioError(problem));
      if (problem === 'guard denied')
        f.guard.checkMany.mockResolvedValueOnce([
          { allowed: false, code: 'DENYLISTED', message: PRIVATE_ERROR },
        ]);
      if (problem === 'guard not found')
        f.guard.checkMany.mockResolvedValueOnce([
          { allowed: false, code: 'NOT_FOUND', message: PRIVATE_ERROR },
        ]);
      if (problem === 'guard throws')
        f.guard.checkMany.mockRejectedValueOnce(ioError('ENOENT'));
      if (problem === 'guard empty')
        f.guard.checkMany.mockResolvedValueOnce([]);
      if (problem === 'guard link' || problem === 'guard redirected') {
        f.guard.checkMany.mockResolvedValueOnce([
          {
            allowed: true,
            path: {
              inputPath: EXEC_A,
              resolvedPath: EXEC_A,
              realPath: problem === 'guard redirected' ? EXEC_C : EXEC_A,
              isSymbolicLink: problem === 'guard link',
            },
          },
        ]);
      }
      const started = await f.service.startExecute(f.input);
      await flush();
      const operation = f.service.getOperation(started.operationId);
      expect(operation).toMatchObject({
        status: 'completed',
        currentPath: null,
        results: [
          { path: EXEC_A, status: 'failed', errorCode, mayBePartial: false },
          { path: EXEC_B, status: 'success', errorCode: null },
        ],
      });
      expect(f.deleteOne.mock.calls.map(([input]) => input.path)).toEqual([
        EXEC_B,
      ]);
      expect(f.guard.checkMany.mock.calls).toEqual([[[EXEC_A]], [[EXEC_B]]]);
      expect(
        f.audit.append.mock.calls.slice(1).map(([record]) => record),
      ).toMatchObject([
        { phase: 'result', targets: [EXEC_A], result: 'failed', errorCode },
        {
          phase: 'result',
          targets: [EXEC_B],
          result: 'success',
          errorCode: null,
        },
      ]);
      expect(f.scanner.applyDeletions).toHaveBeenCalledWith([EXEC_B]);
      expect(f.gate.leave).toHaveBeenCalledWith(f.gateToken);
      expect(JSON.stringify(operation)).not.toContain(PRIVATE_ERROR);
      expect(JSON.stringify(f.log.mock.calls)).not.toContain(PRIVATE_ERROR);
    },
  );

  it('refuses a special file whose device and inode still match', async () => {
    const f = await executeFixture([
      target(EXEC_C, {
        kind: 'project_content',
        method: 'recycle',
        risk: CONTENT_RISK,
        identity: { dev: '7', ino: '9007199254740993', type: 'file' },
      }),
    ]);
    f.nodes.set(paths.toComparable(EXEC_C, 'win32'), {
      ...executeStat(true),
      isFile: () => false,
    });
    const started = await f.service.startExecute({
      ...f.input,
      acknowledgedRisks: ['DELETE_PROJECT_CONTENT'],
      confirmText: 'DELETE 1',
    });
    await flush();
    expect(
      f.service.getOperation(started.operationId).results[0],
    ).toMatchObject({ status: 'failed', errorCode: 'TARGET_CHANGED' });
    expectNoDeletion(f);
  });

  it('checks the manifest of the owner found by preflight, not the preview owner', async () => {
    const f = await executeFixture([target(EXEC_A)]);
    f.assess.mockResolvedValue([
      target(EXEC_A, { owner: { path: 'D:\\TEST-moved', name: 'TEST-moved' } }),
    ]);
    const started = await f.service.startExecute(f.input);
    await flush();
    expect(
      f.service.getOperation(started.operationId).results[0],
    ).toMatchObject({ status: 'failed', errorCode: 'TARGET_CHANGED' });
    expectNoDeletion(f);
  });

  it('accepts case-equivalent guard real paths immediately before deletion', async () => {
    const f = await executeFixture([target(EXEC_A)]);
    f.guard.checkMany.mockResolvedValueOnce([
      {
        allowed: true,
        path: {
          inputPath: EXEC_A,
          resolvedPath: EXEC_A,
          realPath: EXEC_A.toLowerCase(),
          isSymbolicLink: false,
        },
      },
    ]);
    const started = await f.service.startExecute(f.input);
    await flush();
    expect(f.service.getOperation(started.operationId).results[0].status).toBe(
      'success',
    );
    expect(f.deleteOne).toHaveBeenCalledTimes(1);
  });

  it.each(['missing', 'directory', 'link', 'unreadable'])(
    'refuses a target when its owner manifest is %s',
    async (problem) => {
      const f = await executeFixture([target(EXEC_A)]);
      f.nodes.set(
        paths.toComparable(MANIFEST, 'win32'),
        problem === 'missing'
          ? ioError('ENOENT')
          : problem === 'unreadable'
            ? ioError('EACCES')
            : {
                ...executeStat(problem === 'link'),
                isSymbolicLink: () => problem === 'link',
              },
      );
      const started = await f.service.startExecute(f.input);
      await flush();
      expect(
        f.service.getOperation(started.operationId).results[0],
      ).toMatchObject({
        status: 'failed',
        errorCode: 'TARGET_CHANGED',
        mayBePartial: false,
      });
      expectNoDeletion(f);
      expect(f.scanner.applyDeletions).toHaveBeenCalledWith([]);
      expect(f.diskUsage.clearCache).toHaveBeenCalledTimes(1);
    },
  );

  it('allows later targets when this operation successfully removed their owner manifest', async () => {
    const f = await executeFixture([
      target(MANIFEST, {
        kind: 'project_content',
        method: 'recycle',
        risk: CONTENT_RISK,
        identity: { dev: '7', ino: '9007199254740993', type: 'file' },
      }),
      target(EXEC_A, { owner: { path: 'd:\\test-app', name: 'TEST-app' } }),
    ]);
    f.deleteOne.mockImplementationOnce(() => {
      f.nodes.set(paths.toComparable(MANIFEST, 'win32'), ioError('ENOENT'));
      return Promise.resolve({ status: 'success', method: 'recycle' });
    });
    const started = await f.service.startExecute({
      ...f.input,
      acknowledgedRisks: ['DELETE_PROJECT_CONTENT'],
      confirmText: 'DELETE 2',
    });
    await flush();
    expect(
      f.service
        .getOperation(started.operationId)
        .results.map(({ status }) => status),
    ).toEqual(['success', 'success']);
    expect(f.deleteOne.mock.calls.map(([input]) => input.path)).toEqual([
      MANIFEST,
      EXEC_A,
    ]);
    expect(f.scanner.applyDeletions).toHaveBeenCalledWith([MANIFEST, EXEC_A]);
  });

  it('does not grant the D12 exemption after a failed manifest deletion', async () => {
    const f = await executeFixture([
      target(MANIFEST, {
        kind: 'project_content',
        method: 'recycle',
        risk: CONTENT_RISK,
        identity: { dev: '7', ino: '9007199254740993', type: 'file' },
      }),
      target(EXEC_A),
    ]);
    f.deleteOne.mockImplementationOnce(() => {
      f.nodes.set(paths.toComparable(MANIFEST, 'win32'), ioError('ENOENT'));
      return Promise.resolve({
        status: 'failed',
        method: 'recycle',
        errorCode: 'RECYCLE_FAILED',
        mayBePartial: false,
      });
    });
    const started = await f.service.startExecute({
      ...f.input,
      acknowledgedRisks: ['DELETE_PROJECT_CONTENT'],
      confirmText: 'DELETE 2',
    });
    await flush();
    expect(
      f.service.getOperation(started.operationId).results[1],
    ).toMatchObject({ status: 'failed', errorCode: 'TARGET_CHANGED' });
    expect(f.deleteOne).toHaveBeenCalledTimes(1);
  });

  it.each(['file', 'link', 'EACCES', 'ENOENT', 'ENOTDIR'])(
    'checks an orphan parent manifest (%s)',
    async (manifest) => {
      const orphan = 'D:\\TEST-loose\\node_modules';
      const f = await executeFixture([
        target(orphan, { kind: 'orphan_node_modules', owner: null }),
      ]);
      f.nodes.set(
        paths.toComparable('D:\\TEST-loose\\package.json', 'win32'),
        manifest === 'file' || manifest === 'link'
          ? { ...executeStat(true), isSymbolicLink: () => manifest === 'link' }
          : ioError(manifest),
      );
      const started = await f.service.startExecute(f.input);
      await flush();
      const success = manifest === 'ENOENT' || manifest === 'ENOTDIR';
      expect(
        f.service.getOperation(started.operationId).results[0],
      ).toMatchObject({
        status: success ? 'success' : 'failed',
        errorCode: success ? null : 'TARGET_CHANGED',
        mayBePartial: false,
      });
      expect(f.deleteOne).toHaveBeenCalledTimes(success ? 1 : 0);
    },
  );
});

describe('FileOpsService stopping and finalization', () => {
  it('lets the current target finish, then marks the rest not_started on cancellation', async () => {
    const f = await executeFixture();
    const waiting = deferred<DeleteOutcome>();
    f.deleteOne.mockReturnValueOnce(waiting.promise);
    const started = await f.service.startExecute(f.input);
    await flush();
    const stopping = f.service.cancelOperation(started.operationId);
    expect(stopping).toMatchObject({
      status: 'stopping',
      currentPath: EXEC_A,
      results: [{ status: 'running' }, { status: 'pending' }],
    });
    expect(f.service.cancelOperation(started.operationId)).toEqual(stopping);
    expect(f.gate.leave).not.toHaveBeenCalled();
    waiting.resolve({ method: 'permanent', status: 'success' });
    await flush();
    const final = f.service.getOperation(started.operationId);
    expect(final).toMatchObject({
      status: 'cancelled',
      currentPath: null,
      finishedAt: NOW.toISOString(),
      results: [
        { status: 'success', errorCode: null },
        { status: 'not_started', errorCode: null, mayBePartial: false },
      ],
    });
    expect(f.deleteOne).toHaveBeenCalledTimes(1);
    expect(f.scanner.applyDeletions).toHaveBeenCalledWith([EXEC_A]);
    expect(f.diskUsage.clearCache).toHaveBeenCalledTimes(1);
    expect(f.gate.leave).toHaveBeenCalledWith(f.gateToken);
    expect(f.service.cancelOperation(started.operationId)).toEqual(final);
    await expect(
      f.service.startExecute({ ...f.input, confirm: false }),
    ).resolves.toEqual({
      operationId: started.operationId,
      status: 'cancelled',
    });
  });

  it('does not delete a target when cancellation arrives during its pre-delete check', async () => {
    const f = await executeFixture();
    const check = deferred<PathCheckResult[]>();
    f.guard.checkMany.mockReturnValueOnce(check.promise);
    const started = await f.service.startExecute(f.input);
    await flush();
    expect(f.service.cancelOperation(started.operationId).status).toBe(
      'stopping',
    );
    check.resolve([allowedPath(EXEC_A)]);
    await flush();
    expect(f.service.getOperation(started.operationId)).toMatchObject({
      status: 'cancelled',
      results: [
        { status: 'not_started', errorCode: null },
        { status: 'not_started', errorCode: null },
      ],
    });
    expectNoDeletion(f);
    expect(f.scanner.applyDeletions).toHaveBeenCalledWith([]);
    expect(f.gate.leave).toHaveBeenCalledWith(f.gateToken);
  });

  it('exposes only the running operation as active', async () => {
    const f = await executeFixture();
    expect(f.service.getActiveOperation()).toBeNull();
    const waiting = deferred<DeleteOutcome>();
    f.deleteOne.mockReturnValueOnce(waiting.promise);
    const started = await f.service.startExecute(f.input);
    await flush();
    expect(f.service.getActiveOperation()).toMatchObject({
      operationId: started.operationId,
      status: 'running',
      currentPath: EXEC_A,
    });
    waiting.resolve({ method: 'permanent', status: 'success' });
    await flush();
    expect(f.service.getActiveOperation()).toBeNull();
  });

  it('stays completed when cancellation arrives during the last target', async () => {
    const f = await executeFixture([target(EXEC_A)]);
    const waiting = deferred<DeleteOutcome>();
    f.deleteOne.mockReturnValueOnce(waiting.promise);
    const started = await f.service.startExecute(f.input);
    await flush();
    expect(f.service.cancelOperation(started.operationId).status).toBe(
      'stopping',
    );
    waiting.resolve({ method: 'permanent', status: 'success' });
    await flush();
    expect(f.service.getOperation(started.operationId)).toMatchObject({
      status: 'completed',
      results: [{ status: 'success' }],
    });
  });

  it.each([
    {
      method: 'permanent',
      status: 'failed',
      errorCode: 'ACCESS_DENIED',
      mayBePartial: true,
    },
    {
      method: 'permanent',
      status: 'failed',
      errorCode: 'TARGET_GONE',
      mayBePartial: false,
    },
    {
      method: 'recycle',
      status: 'failed',
      errorCode: 'RECYCLE_FAILED',
      mayBePartial: false,
    },
  ] satisfies DeleteOutcome[])(
    'retains $errorCode and partial state while completing other targets',
    async (outcome) => {
      const recycle = outcome.method === 'recycle';
      const f = await executeFixture([
        target(
          EXEC_A,
          recycle
            ? { kind: 'project_content', method: 'recycle', risk: CONTENT_RISK }
            : {},
        ),
        target(EXEC_B, { kind: 'build_cache' }),
      ]);
      f.deleteOne.mockResolvedValueOnce(outcome);
      const started = await f.service.startExecute({
        ...f.input,
        ...(recycle
          ? {
              acknowledgedRisks: ['DELETE_PROJECT_CONTENT'],
              confirmText: 'DELETE 2',
            }
          : {}),
      });
      await flush();
      const final = f.service.getOperation(started.operationId);
      expect(final).toMatchObject({
        status: 'completed',
        results: [
          { ...outcome, reclaimableBytes: recycle ? null : 70 },
          { status: 'success' },
        ],
      });
      expect(f.scanner.applyDeletions).toHaveBeenCalledWith([EXEC_B]);
      expect(f.deleteOne).toHaveBeenCalledTimes(2);
      expect(f.audit.append.mock.calls[1][0]).toMatchObject({
        phase: 'result',
        targets: [EXEC_A],
        result: 'failed',
        errorCode: outcome.errorCode,
      });
      expect(f.service.cancelOperation(started.operationId)).toEqual(final);
      expect(f.gate.leave).toHaveBeenCalledWith(f.gateToken);
    },
  );

  it('stops after a result audit fails, preserving successful deletion and failing remaining rows', async () => {
    const f = await executeFixture();
    f.audit.append
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error(PRIVATE_ERROR));
    const started = await f.service.startExecute(f.input);
    await flush();
    const final = f.service.getOperation(started.operationId);
    expect(final).toMatchObject({
      status: 'failed',
      currentPath: null,
      finishedAt: NOW.toISOString(),
      results: [
        { path: EXEC_A, status: 'success', errorCode: null },
        {
          path: EXEC_B,
          status: 'not_started',
          errorCode: 'AUDIT_WRITE_FAILED',
          mayBePartial: false,
        },
      ],
    });
    expect(f.deleteOne).toHaveBeenCalledTimes(1);
    expect(f.audit.append).toHaveBeenCalledTimes(2);
    expect(f.scanner.applyDeletions).toHaveBeenCalledWith([EXEC_A]);
    expect(f.diskUsage.clearCache).toHaveBeenCalledTimes(1);
    expect(f.gate.leave).toHaveBeenCalledWith(f.gateToken);
    expect(f.service.cancelOperation(started.operationId)).toEqual(final);
    await expect(f.service.startExecute(f.input)).resolves.toEqual({
      operationId: started.operationId,
      status: 'failed',
    });
    expect(JSON.stringify(final)).not.toContain(PRIVATE_ERROR);
    expect(JSON.stringify(f.log.mock.calls)).not.toContain(PRIVATE_ERROR);
  });

  it('contains unexpected deleter exceptions and never retries or exposes their details', async () => {
    const f = await executeFixture();
    f.deleteOne.mockRejectedValueOnce(new Error(PRIVATE_ERROR));
    const started = await f.service.startExecute(f.input);
    await flush();
    const final = f.service.getOperation(started.operationId);
    expect(final).toMatchObject({
      status: 'failed',
      currentPath: null,
      finishedAt: NOW.toISOString(),
      results: [{ status: 'not_started' }, { status: 'not_started' }],
    });
    expect(f.deleteOne).toHaveBeenCalledTimes(1);
    expect(f.scanner.applyDeletions).toHaveBeenCalledWith([]);
    expect(f.diskUsage.clearCache).toHaveBeenCalledTimes(1);
    expect(f.gate.leave).toHaveBeenCalledWith(f.gateToken);
    expect(f.log).toHaveBeenCalledWith('File operation failed');
    expect(JSON.stringify(final)).not.toContain(PRIVATE_ERROR);
    expect(JSON.stringify(f.log.mock.calls)).not.toContain(PRIVATE_ERROR);
  });

  it.each(['applyDeletions', 'clearCache'] as const)(
    'still finalizes and leaves the gate when %s throws',
    async (step) => {
      const f = await executeFixture();
      const fail = () => {
        throw new Error(PRIVATE_ERROR);
      };
      if (step === 'applyDeletions')
        f.scanner.applyDeletions.mockImplementation(fail);
      else f.diskUsage.clearCache.mockImplementation(fail);
      const started = await f.service.startExecute(f.input);
      await flush();
      expect(f.scanner.applyDeletions).toHaveBeenCalledWith([EXEC_A, EXEC_B]);
      expect(f.diskUsage.clearCache).toHaveBeenCalledTimes(1);
      expect(f.gate.leave).toHaveBeenCalledTimes(1);
      expect(f.gate.leave).toHaveBeenCalledWith(f.gateToken);
      const final = f.service.getOperation(started.operationId);
      expect(['completed', 'failed']).toContain(final.status);
      expect(final.currentPath).toBeNull();
      expect(final.finishedAt).toBe(NOW.toISOString());
      expect(JSON.stringify(f.log.mock.calls)).not.toContain(PRIVATE_ERROR);
    },
  );

  it('still leaves the gate when publishing the terminal operation throws', async () => {
    const f = await executeFixture();
    jest
      .spyOn(OperationStore.prototype, 'update')
      .mockImplementation((_id, operation) => {
        if (operation.finishedAt) throw new Error(PRIVATE_ERROR);
      });
    await f.service.startExecute(f.input);
    await flush();
    expect(f.scanner.applyDeletions).toHaveBeenCalledWith([EXEC_A, EXEC_B]);
    expect(f.diskUsage.clearCache).toHaveBeenCalledTimes(1);
    expect(f.gate.leave).toHaveBeenCalledWith(f.gateToken);
    expect(JSON.stringify(f.log.mock.calls)).not.toContain(PRIVATE_ERROR);
  });
});

describe('FileOpsService preview start', () => {
  it.each(['cleanup', 'delete'] as const)(
    'rejects %s start when the mutation gate is busy, without reserving a slot',
    async (source) => {
      const f = fixture();
      f.gate.assertIdle.mockImplementationOnce(() => {
        throw new AppException(409, 'TEST busy', 'CONFLICT');
      });
      const start = () =>
        source === 'cleanup'
          ? f.service.startCleanupPreview({})
          : f.service.startDeletePreview({ paths: [] });
      expect(failure(start)).toMatchObject({
        statusCode: 409,
        code: 'CONFLICT',
      });
      expect(f.scanner.getLatest).not.toHaveBeenCalled();
      expect(f.assess).not.toHaveBeenCalled();
      expect(f.discover).not.toHaveBeenCalled();
      const next = start();
      expect(next.status).toBe('running');
      await flush();
      expect(f.service.getPreview(next.previewId).status).toBe('completed');
    },
  );

  it.each(['cleanup', 'delete'] as const)(
    'preserves missing-scan 404 for %s and leaves no running slot',
    async (source) => {
      const f = fixture();
      const absent = new NotFoundException('Latest scan');
      f.scanner.getLatest.mockImplementationOnce(() => {
        throw absent;
      });
      const start = () =>
        source === 'cleanup'
          ? f.service.startCleanupPreview({})
          : f.service.startDeletePreview({ paths: [] });
      expect(failure(start)).toBe(absent);
      expect(f.assess).not.toHaveBeenCalled();
      expect(f.discover).not.toHaveBeenCalled();
      expect(start().status).toBe('running');
      await flush();
    },
  );

  it.each(['cleanup', 'delete'] as const)(
    'reserves a running slot synchronously against a second %s start',
    async (secondSource) => {
      const f = fixture();
      const waiting = deferred<assessment.IAssessedTarget[]>();
      f.assess.mockReturnValue(waiting.promise);
      const first = f.service.startDeletePreview({ paths: ['D:\\TEST-a'] });
      expect(first.previewId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(first).toEqual({
        previewId: first.previewId,
        status: 'running',
      });
      const startAgain = () =>
        secondSource === 'cleanup'
          ? f.service.startCleanupPreview({})
          : f.service.startDeletePreview({ paths: ['D:\\TEST-b'] });
      expect(failure(startAgain)).toMatchObject({
        statusCode: 409,
        code: 'CONFLICT',
      });
      expect(f.scanner.getLatest).toHaveBeenCalledTimes(1);
      expect(f.service.getPreview(first.previewId)).toMatchObject({
        previewId: first.previewId,
        source: 'delete',
        status: 'running',
        scanId: 'TEST-scan',
        startedAt: NOW.toISOString(),
        operationId: null,
        failureCode: null,
      });
      waiting.resolve([]);
      await flush();
      const second = startAgain();
      expect(second.previewId).not.toBe(first.previewId);
      await flush();
    },
  );

  it('uses the scan captured at start even if the scanner later changes', async () => {
    const f = fixture();
    const waiting = deferred<discovery.ICleanupCandidate[]>();
    f.discover.mockReturnValue(waiting.promise);
    const result = f.service.startCleanupPreview({});
    f.scanner.getLatest.mockReturnValue({
      ...f.scan,
      scanId: 'TEST-new-scan',
      projects: [],
    });
    waiting.resolve([]);
    await flush();
    expect(f.scanner.getLatest).toHaveBeenCalledTimes(1);
    expect(f.service.getPreview(result.previewId).scanId).toBe('TEST-scan');
    expect(f.assess.mock.calls[0][1].projects[0].path).toBe('D:\\TEST-app');
  });
});

describe('FileOpsService measurement jobs', () => {
  it('publishes targets while measuring, exposes pending work and progresses one completion at a time', async () => {
    const f = fixture();
    const targets = Array.from({ length: 5 }, (_, i) =>
      target(`D:\\TEST-${i}`),
    );
    const work = targets.map(() => deferred<measurement.MeasureResult>());
    f.assess.mockResolvedValue(targets);
    f.measure.mockImplementation(
      (path) => work[targets.findIndex((row) => row.path === path)].promise,
    );
    const start = f.service.startDeletePreview({
      paths: targets.map(({ path }) => path),
    });
    expect(start.status).toBe('running');
    await flush();
    const initial = f.service.getPreview(start.previewId);
    expect(initial.progress).toEqual({ measuredTargets: 0, totalTargets: 5 });
    expect(initial.targets.map(({ size }) => size.status)).toEqual([
      'measuring',
      'measuring',
      'measuring',
      'measuring',
      'pending',
    ]);
    expect(initial.targets[4].size).toEqual(emptySize('pending'));
    expect(initial.targets[0].size).toEqual(emptySize('measuring'));
    expect(initial.targets[0]).not.toHaveProperty('identity');
    expect(initial.targets[0]).not.toHaveProperty('inputPath');
    expect(initial).not.toHaveProperty('controller');
    expect(f.measure.mock.calls[0][1]).toMatchObject({
      platform: 'win32',
      fs: f.diskFs,
    });
    expect(f.measure.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    work[0].resolve(measured(100, 70));
    await flush();
    const partial = f.service.getPreview(start.previewId);
    expect(partial.status).toBe('running');
    expect(partial.progress).toEqual({ measuredTargets: 1, totalTargets: 5 });
    expect(partial.targets[0].size).toEqual({
      status: 'done',
      apparentBytes: 120,
      sizeBytes: 100,
      reclaimableBytes: 70,
      sharedBytes: 30,
      fileCount: 2,
    });
    expect(partial.targets[4].size.status).toBe('measuring');
    work.slice(1).forEach((item) => item.resolve(measured()));
    await flush();
    expect(f.service.getPreview(start.previewId)).toMatchObject({
      status: 'completed',
      finishedAt: NOW.toISOString(),
      progress: { measuredTargets: 5, totalTargets: 5 },
      failureCode: null,
    });
    expect(initial.progress.measuredTargets).toBe(0);
  });

  it('measures at most four concurrently, oldest first, ties stable and null last', async () => {
    const f = fixture();
    const targets = [
      target('D:\\TEST-null', { lastActivityAt: null }),
      target('D:\\TEST-new', { lastActivityAt: '2026-10-10T00:00:00.000Z' }),
      target('D:\\TEST-old-a', { lastActivityAt: '2026-01-01T00:00:00.000Z' }),
      target('D:\\TEST-middle', { lastActivityAt: '2026-09-01T00:00:00.000Z' }),
      target('D:\\TEST-old-b', { lastActivityAt: '2026-01-01T00:00:00.000Z' }),
      target('D:\\TEST-newer', { lastActivityAt: '2026-10-20T00:00:00.000Z' }),
    ];
    const work = new Map(
      targets.map(({ path }) => [path, deferred<measurement.MeasureResult>()]),
    );
    let active = 0;
    let peak = 0;
    f.assess.mockResolvedValue(targets);
    f.measure.mockImplementation((path) => {
      active++;
      peak = Math.max(peak, active);
      return work.get(path)!.promise.finally(() => {
        active--;
      });
    });
    const { previewId } = f.service.startDeletePreview({
      paths: targets.map(({ path }) => path),
    });
    await flush();
    expect(f.measure.mock.calls.map(([path]) => path)).toEqual([
      'D:\\TEST-old-a',
      'D:\\TEST-old-b',
      'D:\\TEST-middle',
      'D:\\TEST-new',
    ]);
    work.get('D:\\TEST-old-b')!.resolve(measured());
    await flush();
    expect(f.measure.mock.calls[4][0]).toBe('D:\\TEST-newer');
    work.get('D:\\TEST-old-a')!.resolve(measured());
    await flush();
    expect(f.measure.mock.calls[5][0]).toBe('D:\\TEST-null');
    work.forEach((item) => item.resolve(measured()));
    await flush();
    expect(peak).toBe(4);
    expect(active).toBe(0);
    expect(f.service.getPreview(previewId).status).toBe('completed');
  });

  it('keeps invalid delete targets as failed sizes and never measures them', async () => {
    const f = fixture();
    f.assess.mockResolvedValue([
      invalid('D:\\TEST-denied'),
      target('D:\\TEST-good'),
    ]);
    const { previewId } = f.service.startDeletePreview({
      paths: ['D:\\TEST-denied', 'D:\\TEST-good'],
    });
    await flush();
    const preview = f.service.getPreview(previewId);
    expect(preview.targets[0]).toMatchObject({
      valid: false,
      failureCode: 'DENYLISTED',
      size: emptySize('failed'),
      defaultSelected: false,
    });
    expect(preview.targets[1].size.status).toBe('done');
    expect(f.measure.mock.calls.map(([path]) => path)).toEqual([
      'D:\\TEST-good',
    ]);
    expect(preview.progress).toEqual({ totalTargets: 2, measuredTargets: 2 });
    expect(preview.status).toBe('completed');
  });

  it('keeps a measurement failure local and continues measuring other targets', async () => {
    const f = fixture();
    f.assess.mockResolvedValue([
      target('D:\\TEST-failed'),
      target('D:\\TEST-good'),
    ]);
    f.measure.mockResolvedValueOnce({ status: 'failed', reason: 'read_error' });
    const { previewId } = f.service.startDeletePreview({
      paths: ['D:\\TEST-failed', 'D:\\TEST-good'],
    });
    await flush();
    const preview = f.service.getPreview(previewId);
    expect(preview).toMatchObject({
      status: 'completed',
      failureCode: null,
      progress: { totalTargets: 2, measuredTargets: 2 },
    });
    expect(preview.targets[0].size).toEqual(emptySize('failed'));
    expect(preview.targets[1].size.status).toBe('done');
  });

  it('recomputes aggregate risk as bytes cross the large-batch threshold', async () => {
    const f = fixture();
    const work = deferred<measurement.MeasureResult>();
    f.assess.mockResolvedValue([target('D:\\TEST-big')]);
    f.measure.mockReturnValue(work.promise);
    const { previewId } = f.service.startDeletePreview({
      paths: ['D:\\TEST-big'],
    });
    await flush();
    expect(f.service.getPreview(previewId).risk).toEqual(LOW);
    work.resolve(measured(5_000_000_000, 1));
    await flush();
    expect(
      f.service.getPreview(previewId).risk.reasons.map(({ code }) => code),
    ).toEqual(['LARGE_BATCH']);
    expect(f.service.getPreview(previewId).confirmText).toBeNull();
  });

  it('aggregates risk and confirmation from valid targets before measurements finish', async () => {
    const f = fixture();
    f.assess.mockResolvedValue([
      invalid('D:\\TEST-denied'),
      target('D:\\TEST-app', {
        kind: 'project',
        method: 'recycle',
        risk: HIGH,
        defaultSelected: false,
      }),
    ]);
    const work = deferred<measurement.MeasureResult>();
    f.measure.mockReturnValue(work.promise);
    const { previewId } = f.service.startDeletePreview({
      paths: ['D:\\TEST-denied', 'D:\\TEST-app'],
    });
    await flush();
    expect(f.service.getPreview(previewId)).toMatchObject({
      risk: { level: 'high' },
      confirmText: 'TEST-app',
    });
    work.resolve(measured());
    await flush();
  });

  it('returns clones so polling cannot change the job or selected-path eligibility', async () => {
    const f = fixture();
    f.assess.mockResolvedValue([target('D:\\TEST-one')]);
    const { previewId } = f.service.startDeletePreview({
      paths: ['D:\\TEST-one'],
    });
    await flush();
    const original = f.service.getPreview(previewId);
    const copy = f.service.getPreview(previewId);
    copy.targets[0].path = 'D:\\TEST-injected';
    copy.targets[0].size.reclaimableBytes = 999;
    copy.progress.measuredTargets = 999;
    expect(f.service.getPreview(previewId)).toEqual(original);
    expect(
      failure(() =>
        f.service.summarizePreview(previewId, ['D:\\TEST-injected']),
      ),
    ).toBeInstanceOf(ValidationException);
  });
});

describe('FileOpsService cleanup filters', () => {
  it('defaults discovery to all cleanup kinds and forwards its facts to assessment', async () => {
    const f = fixture();
    const rows = [
      candidate('D:\\TEST-app\\.next', 'build_cache'),
      candidate('D:\\TEST-app\\node_modules'),
    ];
    f.discover.mockResolvedValue(rows);
    f.assess.mockResolvedValue([
      target(rows[0].path, { kind: 'build_cache' }),
      target(rows[1].path),
    ]);
    const { previewId } = f.service.startCleanupPreview({});
    await flush();
    const [, options, deps] = f.discover.mock.calls[0];
    expect(options.includeKinds).toHaveLength(3);
    expect(options.includeKinds).toEqual(
      expect.arrayContaining([
        'node_modules',
        'orphan_node_modules',
        'build_cache',
      ]),
    );
    expect(deps).toMatchObject({
      platform: 'win32',
      fs: f.fs.files,
      git: f.git,
    });
    expect(deps.signal).toBeInstanceOf(AbortSignal);
    const [inputs, , assessDeps, cleanupFacts] = f.assess.mock.calls[0];
    expect(inputs).toEqual(rows.map(({ path }) => path));
    expect(cleanupFacts?.get(rows[0].path)).toMatchObject({
      trackedCheck: 'clean',
      frameworkVerified: true,
    });
    expect(assessDeps).toMatchObject({
      platform: 'win32',
      fs: f.fs,
      git: f.git,
      processes: f.processes,
      selfPid: process.pid,
      now: NOW,
    });
    expect(assessDeps.signal).toBe(deps.signal);
    await assessDeps.checkMany(['D:\\TEST-check']);
    expect(f.guard.checkMany).toHaveBeenCalledWith(['D:\\TEST-check']);
    expect(f.service.getPreview(previewId).source).toBe('cleanup');
  });

  it('forwards explicit kinds and project paths, including an empty kinds list', async () => {
    const f = fixture();
    const projectPaths = ['D:\\TEST-app'];
    f.service.startCleanupPreview({ includeKinds: [], projectPaths });
    await flush();
    expect(f.discover.mock.calls[0][1]).toEqual({
      includeKinds: [],
      projectPaths,
    });
  });

  it('filters invalid and reclassified non-cleanup targets before measurement', async () => {
    const f = fixture();
    const rows = [
      candidate('D:\\TEST-invalid'),
      candidate('D:\\TEST-tracked', 'build_cache'),
      candidate('D:\\TEST-good'),
    ];
    f.discover.mockResolvedValue(rows);
    f.assess.mockResolvedValue([
      invalid(rows[0].path),
      target(rows[1].path, {
        kind: 'project_content',
        method: 'recycle',
        risk: HIGH,
      }),
      target(rows[2].path),
    ]);
    const { previewId } = f.service.startCleanupPreview({});
    await flush();
    const preview = f.service.getPreview(previewId);
    expect(preview.targets.map(({ path }) => path)).toEqual(['D:\\TEST-good']);
    expect(f.measure.mock.calls.map(([path]) => path)).toEqual([
      'D:\\TEST-good',
    ]);
    expect(preview.risk).toEqual(LOW);
  });

  it('applies a strict older-than cutoff before measurement and excludes unknown activity', async () => {
    const f = fixture();
    const cutoff = NOW.getTime() - 30 * 86_400_000;
    const rows = [
      target('D:\\TEST-before', {
        lastActivityAt: new Date(cutoff - 1).toISOString(),
      }),
      target('D:\\TEST-boundary', {
        lastActivityAt: new Date(cutoff).toISOString(),
      }),
      target('D:\\TEST-after', {
        lastActivityAt: new Date(cutoff + 1).toISOString(),
      }),
      target('D:\\TEST-unknown', { lastActivityAt: null }),
    ];
    f.discover.mockResolvedValue(rows.map(({ path }) => candidate(path)));
    f.assess.mockResolvedValue(rows);
    const { previewId } = f.service.startCleanupPreview({ olderThanDays: 30 });
    await flush();
    expect(
      f.service.getPreview(previewId).targets.map(({ path }) => path),
    ).toEqual(['D:\\TEST-before']);
    expect(f.measure.mock.calls.map(([path]) => path)).toEqual([
      'D:\\TEST-before',
    ]);
  });

  it('keeps unknown activity when no age filter is requested', async () => {
    const f = fixture();
    f.discover.mockResolvedValue([candidate('D:\\TEST-unknown')]);
    f.assess.mockResolvedValue([
      target('D:\\TEST-unknown', { lastActivityAt: null }),
    ]);
    const { previewId } = f.service.startCleanupPreview({});
    await flush();
    expect(f.service.getPreview(previewId).targets).toHaveLength(1);
  });

  it('applies minSizeBytes after measurement, keeps the boundary and retains failed measurements', async () => {
    const f = fixture();
    const rows = ['small', 'boundary', 'failed'].map((name) =>
      target(`D:\\TEST-${name}`),
    );
    const work = rows.map(() => deferred<measurement.MeasureResult>());
    f.discover.mockResolvedValue(rows.map(({ path }) => candidate(path)));
    f.assess.mockResolvedValue(rows);
    f.measure.mockImplementation(
      (path) => work[rows.findIndex((row) => row.path === path)].promise,
    );
    const { previewId } = f.service.startCleanupPreview({ minSizeBytes: 100 });
    await flush();
    expect(f.service.getPreview(previewId).targets).toHaveLength(3);
    work[0].resolve(measured(99, 99));
    await flush();
    expect(f.service.getPreview(previewId).progress.totalTargets).toBe(2);
    work[1].resolve(measured(100, 1));
    work[2].resolve({ status: 'failed', reason: 'read_error' });
    await flush();
    const preview = f.service.getPreview(previewId);
    expect(preview.targets.map(({ path }) => path)).toEqual([
      'D:\\TEST-boundary',
      'D:\\TEST-failed',
    ]);
    expect(preview.targets.map(({ size }) => size.status)).toEqual([
      'done',
      'failed',
    ]);
    expect(preview.progress).toEqual({ totalTargets: 2, measuredTargets: 2 });
    expect(preview.status).toBe('completed');
  });
});

describe('FileOpsService cancellation and failure', () => {
  it.each(['resolve', 'reject'] as const)(
    'cancels immediately and ignores a late assessment %s',
    async (outcome) => {
      const f = fixture();
      const work = deferred<assessment.IAssessedTarget[]>();
      f.assess.mockReturnValueOnce(work.promise);
      const { previewId } = f.service.startDeletePreview({
        paths: ['D:\\TEST-one'],
      });
      await flush();
      const signal = f.assess.mock.calls[0][2].signal;
      const cancelled = f.service.cancelPreview(previewId);
      expect(cancelled).toMatchObject({
        status: 'cancelled',
        finishedAt: NOW.toISOString(),
        failureCode: null,
      });
      expect(signal.aborted).toBe(true);
      const next = f.service.startDeletePreview({ paths: [] });
      if (outcome === 'resolve') work.resolve([target('D:\\TEST-one')]);
      else work.reject(new Error('TEST late private failure'));
      await flush();
      expect(f.service.getPreview(previewId)).toEqual(cancelled);
      expect(f.service.getPreview(next.previewId).status).toBe('completed');
      expect(f.measure).not.toHaveBeenCalled();
      expect(f.log).not.toHaveBeenCalled();
    },
  );

  it('cancels discovery before assessment or measurement can start', async () => {
    const f = fixture();
    const work = deferred<discovery.ICleanupCandidate[]>();
    f.discover.mockReturnValue(work.promise);
    const { previewId } = f.service.startCleanupPreview({});
    await flush();
    const cancelled = f.service.cancelPreview(previewId);
    work.resolve([candidate('D:\\TEST-one')]);
    await flush();
    expect(f.service.getPreview(previewId)).toEqual(cancelled);
    expect(f.assess).not.toHaveBeenCalled();
    expect(f.measure).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)(
    'preserves finished targets, cancels pending work, and ignores late measurement %s',
    async (outcome) => {
      const f = fixture();
      const rows = Array.from({ length: 6 }, (_, i) => target(`D:\\TEST-${i}`));
      const work = rows.map(() => deferred<measurement.MeasureResult>());
      f.assess.mockResolvedValue(rows);
      f.measure.mockImplementation(
        (path) => work[rows.findIndex((row) => row.path === path)].promise,
      );
      const { previewId } = f.service.startDeletePreview({
        paths: rows.map(({ path }) => path),
      });
      await flush();
      work[0].resolve(measured());
      await flush();
      const cancelled = f.service.cancelPreview(previewId);
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.targets.map(({ size }) => size.status)).toEqual([
        'done',
        'cancelled',
        'cancelled',
        'cancelled',
        'cancelled',
        'cancelled',
      ]);
      expect(cancelled.progress.measuredTargets).toBe(1);
      expect(
        f.measure.mock.calls.every(([, deps]) => deps.signal.aborted),
      ).toBe(true);
      expect(f.measure).toHaveBeenCalledTimes(5);
      for (const item of work.slice(1, 5)) {
        if (outcome === 'resolve') item.resolve(measured(999, 999));
        else item.reject(new Error('TEST late private failure'));
      }
      await flush();
      expect(f.service.getPreview(previewId)).toEqual(cancelled);
      expect(f.measure).toHaveBeenCalledTimes(5);
      expect(f.log).not.toHaveBeenCalled();
      const summary = f.service.summarizePreview(previewId, [rows[0].path]);
      expect(summary.totals).toEqual({
        targetCount: 1,
        reclaimableBytes: 70,
        recycleBytes: 0,
      });
      expect(
        failure(() => f.service.summarizePreview(previewId, [rows[1].path])),
      ).toBeInstanceOf(ValidationException);
      const copy = f.service.cancelPreview(previewId);
      copy.targets.length = 0;
      expect(f.service.getPreview(previewId)).toEqual(cancelled);
    },
  );

  it.each(['assessment', 'discovery', 'measurement'] as const)(
    'records unexpected %s failures without exposing raw errors',
    async (stage) => {
      const f = fixture();
      const error = new Error('TEST private path / raw command / stack');
      if (stage === 'assessment') f.assess.mockRejectedValue(error);
      if (stage === 'discovery') f.discover.mockRejectedValue(error);
      if (stage === 'measurement') {
        f.assess.mockResolvedValue([target('D:\\TEST-one')]);
        f.measure.mockRejectedValue(error);
      }
      const { previewId } =
        stage === 'discovery'
          ? f.service.startCleanupPreview({})
          : f.service.startDeletePreview({ paths: ['D:\\TEST-one'] });
      await flush();
      const preview = f.service.getPreview(previewId);
      expect(preview).toMatchObject({
        status: 'failed',
        failureCode: 'INTERNAL_ERROR',
        finishedAt: NOW.toISOString(),
      });
      expect(JSON.stringify(preview)).not.toContain('TEST private');
      expect(preview).not.toHaveProperty('stack');
      expect(f.log).toHaveBeenCalled();
      expect(f.service.cancelPreview(previewId)).toEqual(preview);
      expect(
        failure(() => f.service.summarizePreview(previewId, ['D:\\TEST-one'])),
      ).toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    },
  );

  it('does not let sibling measurements overwrite a failed job', async () => {
    const f = fixture();
    const a = deferred<measurement.MeasureResult>();
    const b = deferred<measurement.MeasureResult>();
    f.assess.mockResolvedValue([target('D:\\TEST-a'), target('D:\\TEST-b')]);
    f.measure.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const { previewId } = f.service.startDeletePreview({
      paths: ['D:\\TEST-a', 'D:\\TEST-b'],
    });
    await flush();
    a.reject(new Error('TEST failure'));
    await flush();
    const failed = f.service.getPreview(previewId);
    expect(failed.status).toBe('failed');
    b.resolve(measured(999, 999));
    await flush();
    expect(f.service.getPreview(previewId)).toEqual(failed);
  });

  it('leaves an already completed job unchanged on cancel', async () => {
    const f = fixture();
    const { previewId } = f.service.startDeletePreview({ paths: [] });
    await flush();
    const completed = f.service.getPreview(previewId);
    jest.setSystemTime(new Date(NOW.getTime() + 1000));
    expect(f.service.cancelPreview(previewId)).toEqual(completed);
    expect(completed.status).toBe('completed');
  });

  it.each(['get', 'cancel', 'summary'] as const)(
    'returns NotFoundException for unknown id in %s',
    (method) => {
      const f = fixture();
      const action = () =>
        method === 'get'
          ? f.service.getPreview('TEST-missing')
          : method === 'cancel'
            ? f.service.cancelPreview('TEST-missing')
            : f.service.summarizePreview('TEST-missing', []);
      expect(failure(action)).toBeInstanceOf(NotFoundException);
    },
  );
});

describe('FileOpsService summary and tree', () => {
  it('rejects summary while the preview is running', async () => {
    const f = fixture();
    const work = deferred<assessment.IAssessedTarget[]>();
    f.assess.mockReturnValue(work.promise);
    const { previewId } = f.service.startDeletePreview({
      paths: ['D:\\TEST-one'],
    });
    expect(
      failure(() => f.service.summarizePreview(previewId, ['D:\\TEST-one'])),
    ).toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    work.resolve([]);
    await flush();
  });

  it.each([
    { name: 'empty', selected: [], bad: [] },
    {
      name: 'outside',
      selected: ['D:\\TEST-outside'],
      bad: ['D:\\TEST-outside'],
    },
    {
      name: 'invalid',
      selected: ['D:\\TEST-invalid'],
      bad: ['D:\\TEST-invalid'],
    },
    {
      name: 'failed size',
      selected: ['D:\\TEST-failed'],
      bad: ['D:\\TEST-failed'],
    },
    {
      name: 'duplicate',
      selected: ['D:\\TEST-good', 'D:\\TEST-good'],
      bad: ['D:\\TEST-good'],
    },
    {
      name: 'case variant',
      selected: ['d:\\test-good'],
      bad: ['d:\\test-good'],
    },
  ])(
    'rejects $name selections with path details',
    async ({ selected, bad }) => {
      const f = fixture();
      f.assess.mockResolvedValue([
        target('D:\\TEST-good'),
        invalid('D:\\TEST-invalid'),
        target('D:\\TEST-failed'),
      ]);
      f.measure.mockImplementation((path) =>
        Promise.resolve(
          path === 'D:\\TEST-failed'
            ? { status: 'failed', reason: 'read_error' }
            : measured(),
        ),
      );
      const { previewId } = f.service.startDeletePreview({
        paths: ['D:\\TEST-good', 'D:\\TEST-invalid', 'D:\\TEST-failed'],
      });
      await flush();
      const error = failure(() =>
        f.service.summarizePreview(previewId, selected),
      );
      expect(error).toBeInstanceOf(ValidationException);
      expect(error.statusCode).toBe(400);
      for (const path of bad)
        expect(JSON.stringify(error.details)).toContain(
          JSON.stringify(path).slice(1, -1),
        );
    },
  );

  it('sums permanent reclaimable bytes separately from recyclable size and recomputes subset confirmation', async () => {
    const f = fixture();
    f.assess.mockResolvedValue([
      target('D:\\TEST-deps'),
      target('D:\\TEST-project', {
        kind: 'project',
        method: 'recycle',
        risk: HIGH,
        defaultSelected: false,
      }),
      target('D:\\TEST-unselected'),
    ]);
    f.measure.mockImplementation((path) =>
      Promise.resolve(
        path === 'D:\\TEST-project' ? measured(300, 250) : measured(100, 70),
      ),
    );
    const { previewId } = f.service.startDeletePreview({
      paths: ['D:\\TEST-deps', 'D:\\TEST-project', 'D:\\TEST-unselected'],
    });
    await flush();
    const ioCounts = [
      f.scanner.getLatest.mock.calls.length,
      f.assess.mock.calls.length,
      f.measure.mock.calls.length,
    ];
    const selected = ['D:\\TEST-project', 'D:\\TEST-deps'];
    const summary = f.service.summarizePreview(previewId, selected);
    expect(summary).toMatchObject({
      paths: selected,
      risk: { level: 'high' },
      confirmText: 'DELETE 2',
      totals: { targetCount: 2, reclaimableBytes: 70, recycleBytes: 300 },
    });
    const projectOnly = f.service.summarizePreview(previewId, [
      'D:\\TEST-project',
    ]);
    expect(projectOnly).toMatchObject({
      confirmText: 'TEST-project',
      totals: { targetCount: 1, reclaimableBytes: 0, recycleBytes: 300 },
    });
    expect(
      f.service.summarizePreview(previewId, ['D:\\TEST-deps']),
    ).toMatchObject({
      risk: LOW,
      confirmText: null,
      totals: { targetCount: 1, reclaimableBytes: 70, recycleBytes: 0 },
    });
    expect([
      f.scanner.getLatest.mock.calls.length,
      f.assess.mock.calls.length,
      f.measure.mock.calls.length,
    ]).toEqual(ioCounts);
    expect(f.guard.checkMany).not.toHaveBeenCalled();
    expect(f.gitStatus).not.toHaveBeenCalled();
    expect(f.capture).not.toHaveBeenCalled();
    summary.paths.length = 0;
    summary.risk.reasons.length = 0;
    summary.totals.recycleBytes = 999;
    expect(f.service.summarizePreview(previewId, selected)).toMatchObject({
      paths: selected,
      risk: { level: 'high' },
      totals: { recycleBytes: 300 },
    });
  });

  it('delegates tree reads with guarded paths, file stats and disk entries using a live signal', async () => {
    const f = fixture();
    const result = await f.service.getTree('D:\\TEST-app');
    expect(result).toEqual({
      path: 'D:\\TEST-app',
      owner: { path: 'D:\\TEST-app', name: 'TEST-app' },
      entries: [],
      truncated: false,
    });
    expect(f.scanner.getLatest).toHaveBeenCalledTimes(1);
    const [path, scan, deps] = f.readTree.mock.calls[0];
    expect(path).toBe('D:\\TEST-app');
    expect(scan.projects[0].path).toBe('D:\\TEST-app');
    expect(deps.platform).toBe('win32');
    expect(deps.signal.aborted).toBe(false);
    await deps.checkMany([path]);
    expect(f.guard.checkMany).toHaveBeenCalledWith([path]);
    const stats: IFileOpsStat = {
      dev: 7n,
      ino: 1n,
      size: 0n,
      isFile: () => false,
      isDirectory: () => true,
      isSymbolicLink: () => false,
    };
    f.fileLstat.mockResolvedValue(stats);
    await expect(deps.fs.lstat(path)).resolves.toBe(stats);
    expect(f.fileLstat).toHaveBeenCalledWith(path);
    expect(f.fileLstat.mock.contexts[0]).toBe(f.fs.files);
    const entries: ReturnType<IDiskFs['entries']> = {
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.resolve({ done: true, value: undefined }),
      }),
    };
    f.diskEntries.mockReturnValue(entries);
    expect(deps.fs.entries(path, deps.signal)).toBe(entries);
    expect(f.diskEntries).toHaveBeenCalledWith(path, deps.signal);
    expect(f.diskEntries.mock.contexts[0]).toBe(f.diskFs);
    expect(f.gate.assertIdle).not.toHaveBeenCalled();
  });

  it('preserves missing scan and tree validation errors', async () => {
    const f = fixture();
    const missing = new NotFoundException('Latest scan');
    f.scanner.getLatest.mockImplementationOnce(() => {
      throw missing;
    });
    await expect(f.service.getTree('D:\\TEST-app')).rejects.toBe(missing);
    expect(f.readTree).not.toHaveBeenCalled();
    const invalidPath = new ValidationException('TEST link');
    f.readTree.mockRejectedValue(invalidPath);
    await expect(f.service.getTree('D:\\TEST-link')).rejects.toBe(invalidPath);
  });
});
