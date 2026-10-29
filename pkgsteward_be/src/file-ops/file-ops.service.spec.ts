import { Logger } from '@nestjs/common';
import {
  AppException,
  NotFoundException,
  ValidationException,
} from '@/common/exceptions/app.exception';
import * as paths from '@/common/utils/path.util';
import type { MutationGateService } from '@/core/mutation-gate/mutation-gate.service';
import type { PathGuardService } from '@/core/path-guard/path-guard.service';
import type { IRisk } from '@/core/risk/interfaces/risk.types';
import type { IDiskFs } from '@/disk-usage/interfaces/disk-usage.types';
import * as discovery from '@/file-ops/cleanup-discovery';
import * as assessment from '@/file-ops/file-ops-assessment';
import * as measurement from '@/file-ops/file-ops-measure';
import { FileOpsService } from '@/file-ops/file-ops.service';
import * as tree from '@/file-ops/file-tree';
import type { GitProbe } from '@/file-ops/git-probe';
import type {
  IFileOpsFsBundle,
  IFileOpsFs,
  IFileOpsStat,
  IGitProbe,
  ITargetSize,
} from '@/file-ops/interfaces/file-ops.types';
import type { IProcessSnapshot } from '@/platform/interfaces/process-snapshot.interface';
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
  const scanner = { getLatest: jest.fn(() => structuredClone(scan)) };
  const gate = { assertIdle: jest.fn() };
  const guard = { checkMany: jest.fn().mockResolvedValue([]) };
  const fileLstat = jest
    .fn<ReturnType<IFileOpsFs['lstat']>, Parameters<IFileOpsFs['lstat']>>()
    .mockRejectedValue(new Error('Unexpected file I/O'));
  const fs: IFileOpsFsBundle = {
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
