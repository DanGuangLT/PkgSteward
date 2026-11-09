import { Logger } from '@nestjs/common';
import { execa } from 'execa';
import { NotFoundException } from '@/common/exceptions/app.exception';
import { readProjectInput } from '@/projects/input/project-input';
import { buildProjectInventory } from '@/projects/analysis/project-inventory';
import { ProjectsService } from '@/projects/projects.service';
import type {
  IProjectAnalysisDeps,
  IProjectsRuntime,
  ProjectAnalyzer,
} from '@/projects/interfaces/projects.runtime';
import type {
  IAnalysisResult,
  ILockInventory,
  IProjectFileStat,
  IProjectInput,
  IProjectInputDeps,
  ProjectScanSnapshot,
} from '@/projects/interfaces/projects.types';

jest.mock('execa', () => ({ execa: jest.fn() }));
jest.mock('@/projects/input/project-input', () => ({
  readProjectInput: jest.fn(),
}));
jest.mock('@/projects/analysis/project-inventory', () => ({
  buildProjectInventory: jest.fn(),
}));

const readInput = jest.mocked(readProjectInput);
const buildInventory = jest.mocked(buildProjectInventory);
const ROOT = 'D:\\projects\\app';
const REQUEST = 'D:\\Projects\\APP';
const NOW = '2026-11-02T10:00:00.000Z';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

function source(requestPath = REQUEST): IProjectInput {
  return {
    path: ROOT,
    requestPath,
    scanId: 'scan-1',
    inputHash: 'hash-1',
    readAt: NOW,
    manager: 'npm',
    lock: { name: 'package-lock.json', text: '{}' },
    registryPolicy: null,
    warningCodes: [],
    manifest: {
      name: 'app',
      version: '1.0.0',
      packageManager: 'npm@11.0.0',
      dependencies: [
        { name: 'pkg', declarations: [{ group: 'dependencies', spec: '^1' }] },
      ],
      scripts: [{ name: 'test', command: 'echo inert' }],
    },
  };
}

function inventory(): ILockInventory {
  return {
    coverage: 'complete',
    direct: new Map([['pkg', ['1.0.0']]]),
    packages: [{ name: 'pkg', version: '1.0.0', direct: true }],
    warningCodes: [],
    failureCode: null,
  };
}

function complete(): IAnalysisResult {
  return {
    outdated: {
      state: 'complete',
      items: [],
      warningCodes: [],
      failureCode: null,
      checkedCount: 1,
      totalCount: 1,
    },
    audit: {
      state: 'complete',
      items: [],
      warningCodes: [],
      failureCode: null,
      checkedCount: 1,
      totalCount: 0,
    },
    partial: false,
    warningCodes: [],
  };
}

function directory(): IProjectFileStat {
  return {
    size: 0,
    mtimeMs: 1,
    ctimeMs: 1,
    ino: 1,
    dev: 1,
    isFile: () => false,
    isSymbolicLink: () => false,
    isDirectory: () => true,
  };
}

function fixture(timeoutMs?: number) {
  const pending = deferred<IAnalysisResult>();
  const analyze: jest.MockedFunction<ProjectAnalyzer> = jest
    .fn<ReturnType<ProjectAnalyzer>, Parameters<ProjectAnalyzer>>()
    .mockReturnValue(pending.promise);
  const assertIdle = jest.fn();
  const peekCompletedSize = jest
    .fn<
      ReturnType<IProjectsRuntime['lifecycle']['peekCompletedSize']>,
      [string]
    >()
    .mockReturnValue(null);
  // Membership logic consumes only path; unrelated Scanner presentation fields are inert.
  let scan: ProjectScanSnapshot = {
    scanId: 'scan-1',
    projects: [{ path: ROOT } as ProjectScanSnapshot['projects'][number]],
  };
  const getLatest = jest.fn(() => scan);
  const lstat = jest
    .fn<Promise<IProjectFileStat>, [string]>()
    .mockResolvedValue(directory());
  const realpath = jest
    .fn<Promise<string>, [string]>()
    .mockImplementation((path) => Promise.resolve(path));
  const readChunks = jest.fn<
    AsyncIterable<Uint8Array>,
    [string, AbortSignal]
  >();
  const assertAllowed = jest
    .fn<Promise<string>, [string]>()
    .mockResolvedValue(ROOT);
  const input: IProjectInputDeps = {
    platform: 'win32',
    fs: { lstat, realpath, readChunks },
    assertAllowed,
    now: () => new Date(),
  };
  const runtime: IProjectsRuntime = {
    input,
    lifecycle: {
      getLatest,
      assertIdle,
      peekCompletedSize,
      now: () => new Date(),
      timeoutMs,
    },
    registry: { getPackageMetadata: jest.fn(), getBulkAdvisories: jest.fn() },
    analyze,
  };
  readInput.mockImplementation((path) => Promise.resolve(source(path)));
  buildInventory.mockResolvedValue(inventory());
  const service = new ProjectsService(runtime);
  return {
    service,
    runtime,
    pending,
    analyze,
    assertIdle,
    peekCompletedSize,
    getLatest,
    lstat,
    realpath,
    readChunks,
    assertAllowed,
    setScan: (value: ProjectScanSnapshot) => {
      scan = value;
    },
    analysisDeps: (): IProjectAnalysisDeps => analyze.mock.calls[0][2],
    signal: (): AbortSignal => analyze.mock.calls[0][1],
  };
}

describe('ProjectsService read-only job lifecycle', () => {
  let network: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers({ now: Date.parse(NOW) });
    network = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('unexpected real fetch'));
  });

  afterEach(() => {
    expect(execa).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('ignores mutation invalidation when no analysis job is retained', () => {
    const f = fixture();
    expect(() => f.service.invalidateAfterMutation(ROOT)).not.toThrow();
    expect(f.service.hasRunningAnalysis()).toBe(false);
    expect(readInput).not.toHaveBeenCalled();
    expect(f.analyze).not.toHaveBeenCalled();
    expect(f.assertIdle).not.toHaveBeenCalled();
  });

  it.each(['completed', 'cancelled', 'timed_out', 'failed'] as const)(
    'marks a retained %s job stale without changing its outcome or findings',
    async (status) => {
      const f = fixture(1000);
      const errorLog = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();
      const started = await f.service.start({ path: REQUEST });
      if (status === 'completed') {
        f.pending.resolve(complete());
        await flush();
      } else if (status === 'cancelled') {
        f.service.cancel(started.jobId);
      } else if (status === 'timed_out') {
        jest.advanceTimersByTime(1000);
      } else {
        f.pending.reject(new Error('TEST analyzer failure'));
        await flush();
      }
      const before = f.service.get(started.jobId);
      expect(before.status).toBe(status);
      const warningCodes = {
        completed: ['INPUT_CHANGED'],
        cancelled: ['CANCELLED', 'INPUT_CHANGED'],
        timed_out: ['INPUT_CHANGED', 'TIMED_OUT'],
        failed: ['INPUT_CHANGED', 'INTERNAL_SERVER_ERROR'],
      };
      const reads = readInput.mock.calls.length;
      f.service.invalidateAfterMutation('d:\\PROJECTS\\app\\.');
      const after = f.service.get(started.jobId);
      expect(after).toEqual({
        ...before,
        stale: true,
        warningCodes: warningCodes[status],
      });
      expect(before.stale).toBe(false);
      f.service.invalidateAfterMutation(ROOT);
      expect(f.service.get(started.jobId)).toEqual(after);
      expect(readInput).toHaveBeenCalledTimes(reads);
      expect(f.analyze).toHaveBeenCalledTimes(1);
      expect(f.assertIdle).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
      expect(errorLog).toHaveBeenCalledTimes(status === 'failed' ? 1 : 0);
    },
  );

  it('sorts and deduplicates INPUT_CHANGED with existing warnings after mutation', async () => {
    const f = fixture();
    const started = await f.service.start({ path: REQUEST });
    f.pending.resolve({
      ...complete(),
      warningCodes: [
        'REGISTRY_UNAVAILABLE',
        'INPUT_CHANGED',
        'CANCELLED',
        'INPUT_CHANGED',
      ],
    });
    await flush();
    f.service.invalidateAfterMutation(ROOT);
    expect(f.service.get(started.jobId).warningCodes).toEqual([
      'CANCELLED',
      'INPUT_CHANGED',
      'REGISTRY_UNAVAILABLE',
    ]);
    f.service.invalidateAfterMutation(ROOT);
    expect(f.service.get(started.jobId).warningCodes).toEqual([
      'CANCELLED',
      'INPUT_CHANGED',
      'REGISTRY_UNAVAILABLE',
    ]);
  });

  it.each(['resolve', 'reject'] as const)(
    'cancels a running analysis with INPUT_CHANGED and ignores late %s and snapshots',
    async (outcome) => {
      const f = fixture(1000);
      const started = await f.service.start({ path: REQUEST });
      const update = complete();
      update.audit.state = 'running';
      update.audit.items = [
        {
          id: 'TEST-advisory',
          name: 'pkg',
          title: 'TEST finding',
          url: null,
          severity: 'high',
          range: '<2',
          affectedVersions: ['1.0.0'],
          direct: true,
        },
      ];
      update.warningCodes = ['REGISTRY_UNAVAILABLE'];
      f.analysisDeps().onSnapshot({ ...update, phase: 'audit' });
      const before = f.service.get(started.jobId);
      f.service.invalidateAfterMutation(REQUEST);
      const cancelled = f.service.get(started.jobId);
      expect(cancelled).toMatchObject({
        jobId: started.jobId,
        status: 'cancelled',
        stale: true,
        partial: true,
        phase: 'done',
        failureCode: 'INPUT_CHANGED',
        finishedAt: NOW,
        checkedAt: null,
        outdated: before.outdated,
        audit: {
          state: 'partial',
          items: update.audit.items,
          failureCode: 'INPUT_CHANGED',
          warningCodes: ['INPUT_CHANGED'],
        },
        warningCodes: ['INPUT_CHANGED', 'REGISTRY_UNAVAILABLE'],
      });
      expect(f.signal().aborted).toBe(true);
      expect(f.service.hasRunningAnalysis()).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
      f.analysisDeps().onSnapshot({ ...complete(), phase: 'done' });
      if (outcome === 'resolve') f.pending.resolve(complete());
      else f.pending.reject(new Error('TEST late analyzer failure'));
      await flush();
      jest.advanceTimersByTime(2000);
      f.service.invalidateAfterMutation(ROOT);
      expect(f.service.get(started.jobId)).toEqual(cancelled);
      expect(f.analyze).toHaveBeenCalledTimes(1);
      expect(readInput).toHaveBeenCalledTimes(1);
      expect(f.assertIdle).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['running', 'D:\\projects'],
    ['running', `${ROOT}\\child`],
    ['running', `${ROOT}-other`],
    ['completed', 'D:\\projects'],
    ['completed', `${ROOT}\\child`],
    ['completed', `${ROOT}-other`],
  ] as const)(
    'does not invalidate a %s job for another path %s',
    async (status, path) => {
      const f = fixture(1000);
      const started = await f.service.start({ path: REQUEST });
      if (status === 'completed') {
        f.pending.resolve(complete());
        await flush();
      }
      const before = f.service.get(started.jobId);
      const reads = readInput.mock.calls.length;
      f.service.invalidateAfterMutation(path);
      expect(f.service.get(started.jobId)).toEqual(before);
      expect(f.signal().aborted).toBe(status === 'completed');
      expect(readInput).toHaveBeenCalledTimes(reads);
      expect(f.analyze).toHaveBeenCalledTimes(1);
    },
  );

  it('returns manifest and locked versions from local reads, without checking gate or starting analysis', async () => {
    const f = fixture();
    f.assertIdle.mockImplementation(() => {
      throw new Error('busy');
    });
    const result = await f.service.detail(REQUEST);
    expect(result).toMatchObject({
      path: ROOT,
      requestPath: REQUEST,
      scanId: 'scan-1',
      inputHash: 'hash-1',
      readAt: NOW,
      name: 'app',
      version: '1.0.0',
      manager: 'npm',
      lockfile: 'package-lock.json',
      dependencies: [{ name: 'pkg', lockedVersions: ['1.0.0'] }],
      scripts: [{ name: 'test', command: 'echo inert' }],
      diskUsage: null,
    });
    expect(f.assertIdle).not.toHaveBeenCalled();
    expect(f.analyze).not.toHaveBeenCalled();
    expect(readInput).toHaveBeenCalledTimes(1);
  });

  it('includes a safe cached zero disk size with its original timestamp', async () => {
    const f = fixture();
    f.peekCompletedSize.mockReturnValue({
      sizeBytes: 0,
      measuredAt: '2026-11-01T00:00:00.000Z',
    });
    const result = await f.service.detail(REQUEST);
    expect(f.peekCompletedSize).toHaveBeenCalledWith(`${ROOT}\\node_modules`);
    expect(result.diskUsage).toEqual({
      sizeBytes: 0,
      measuredAt: '2026-11-01T00:00:00.000Z',
    });
    expect(f.analyze).not.toHaveBeenCalled();
    expect(f.readChunks).not.toHaveBeenCalled();
  });

  it.each(['missing', 'escape', 'file'] as const)(
    'returns null disk summary for %s node_modules without probing the cache',
    async (kind) => {
      const f = fixture();
      if (kind === 'missing')
        f.lstat.mockRejectedValue(
          Object.assign(new Error('absent'), { code: 'ENOENT' }),
        );
      if (kind === 'escape')
        f.realpath.mockResolvedValue('D:\\elsewhere\\node_modules');
      if (kind === 'file')
        f.lstat.mockResolvedValue({
          ...directory(),
          isDirectory: () => false,
          isFile: () => true,
        });
      const result = await f.service.detail(REQUEST);
      expect(result.diskUsage).toBeNull();
      expect(f.peekCompletedSize).not.toHaveBeenCalled();
    },
  );

  it('propagates required-input failures before accepting a job', async () => {
    const f = fixture();
    readInput.mockRejectedValue(
      Object.assign(new Error('not found'), { code: 'NOT_FOUND' }),
    );
    await expect(f.service.start({ path: REQUEST })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(f.analyze).not.toHaveBeenCalled();
    expect(f.assertIdle).not.toHaveBeenCalled();
    expect(f.service.hasRunningAnalysis()).toBe(false);
  });

  it('coalesces simultaneous starts for canonical aliases after awaited reads', async () => {
    const f = fixture();
    const firstRead = deferred<IProjectInput>();
    const secondRead = deferred<IProjectInput>();
    readInput
      .mockReturnValueOnce(firstRead.promise)
      .mockReturnValueOnce(secondRead.promise);
    const first = f.service.start({ path: REQUEST });
    const second = f.service.start({ path: ROOT });
    firstRead.resolve(source());
    secondRead.resolve(source(ROOT));
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(a.status).toBe('running');
    expect(a.jobId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(f.analyze).toHaveBeenCalledTimes(1);
  });

  it('rejects another project with the active id and lexical path', async () => {
    const f = fixture();
    f.setScan({
      scanId: 'scan-1',
      projects: [ROOT, 'D:\\projects\\other'].map(
        (path) => ({ path }) as ProjectScanSnapshot['projects'][number],
      ),
    });
    const first = await f.service.start({ path: REQUEST });
    readInput.mockResolvedValueOnce({
      ...source('D:\\projects\\other'),
      path: 'D:\\projects\\other',
    });
    await expect(
      f.service.start({ path: 'D:\\projects\\other' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      details: {
        reason: 'ANALYSIS_RUNNING',
        jobId: first.jobId,
        path: REQUEST,
      },
    });
    expect(f.analyze).toHaveBeenCalledTimes(1);
  });

  it('rechecks membership after awaited reads before accepting the slot', async () => {
    const f = fixture();
    const pending = deferred<IProjectInput>();
    readInput.mockReturnValueOnce(pending.promise);
    const task = f.service.start({ path: REQUEST });
    f.setScan({ scanId: 'scan-2', projects: [] });
    pending.resolve(source());
    await expect(task).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'PROJECT_NOT_SCANNED' },
    });
    expect(f.analyze).not.toHaveBeenCalled();
  });

  it('checks gate after awaited reads, preserves its conflict details, and reserves no slot on failure', async () => {
    const f = fixture();
    const pending = deferred<IProjectInput>();
    readInput.mockReturnValueOnce(pending.promise);
    const task = f.service.start({ path: REQUEST });
    f.assertIdle.mockImplementation(() => {
      throw Object.assign(new Error('write in progress'), {
        code: 'CONFLICT',
        details: { reason: 'MUTATION_RUNNING' },
      });
    });
    pending.resolve(source());
    await expect(task).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'MUTATION_RUNNING' },
    });
    expect(f.analyze).not.toHaveBeenCalled();
    expect(f.service.hasRunningAnalysis()).toBe(false);
  });

  it('has no await between assertIdle and slot reservation', async () => {
    const f = fixture();
    const reserved: boolean[] = [];
    f.assertIdle.mockImplementation(() => {
      void Promise.resolve().then(() => {
        reserved.push(f.service.hasRunningAnalysis());
      });
    });
    await f.service.start({ path: REQUEST });
    await flush();
    expect(reserved).toEqual([true]);
  });

  it('captures immutable input before handing work to the asynchronous analyzer', async () => {
    const f = fixture();
    const original = source();
    readInput.mockResolvedValueOnce(original);
    const started = await f.service.start({ path: REQUEST });
    original.manifest.dependencies[0].name = 'changed-by-caller';
    original.inputHash = 'changed-by-caller';
    expect(f.analyze.mock.calls[0][0].manifest.dependencies[0].name).toBe(
      'pkg',
    );
    expect(f.service.get(started.jobId).inputHash).toBe('hash-1');
  });

  it('uses no default deadline when timeout is absent', async () => {
    const f = fixture();
    const started = await f.service.start({ path: REQUEST });
    await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(f.service.get(started.jobId).status).toBe('running');
    expect(f.signal().aborted).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('times out the whole accepted job at the configured deadline and clears its timer', async () => {
    const f = fixture(1000);
    const started = await f.service.start({ path: REQUEST });
    await jest.advanceTimersByTimeAsync(999);
    expect(f.service.get(started.jobId).status).toBe('running');
    await jest.advanceTimersByTimeAsync(1);
    expect(f.service.get(started.jobId)).toMatchObject({
      status: 'timed_out',
      partial: true,
      failureCode: 'TIMED_OUT',
      checkedAt: null,
    });
    expect(f.signal().aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('cancels immediately during pending IO, is idempotent, and ignores late success', async () => {
    const f = fixture(1000);
    const started = await f.service.start({ path: REQUEST });
    const cancelled = f.service.cancel(started.jobId);
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      partial: true,
      failureCode: 'CANCELLED',
      checkedAt: null,
    });
    expect(f.service.cancel(started.jobId)).toEqual(cancelled);
    expect(f.signal().aborted).toBe(true);
    f.pending.resolve(complete());
    await flush();
    expect(f.service.get(started.jobId)).toEqual(cancelled);
    expect(jest.getTimerCount()).toBe(0);
    expect(f.assertIdle).toHaveBeenCalledTimes(1);
  });

  it('retains findings and completed sections while marking unfinished sections on cancellation', async () => {
    const f = fixture();
    const started = await f.service.start({ path: REQUEST });
    const update = complete();
    update.audit.state = 'running';
    update.audit.items = [
      {
        id: '1',
        name: 'pkg',
        title: 'Issue',
        url: null,
        severity: 'high',
        range: '<2',
        affectedVersions: ['1.0.0'],
        direct: true,
      },
    ];
    f.analysisDeps().onSnapshot({ ...update, phase: 'audit' });
    const cancelled = f.service.cancel(started.jobId);
    expect(cancelled.outdated.state).toBe('complete');
    expect(cancelled.audit).toMatchObject({
      state: 'partial',
      items: update.audit.items,
    });
    expect(cancelled.partial).toBe(true);
  });

  it('isolates old callbacks and late rejection from a replacement job', async () => {
    const f = fixture();
    const first = await f.service.start({ path: REQUEST });
    const oldDeps = f.analysisDeps();
    f.service.cancel(first.jobId);
    const replacement = deferred<IAnalysisResult>();
    f.analyze.mockReturnValueOnce(replacement.promise);
    const second = await f.service.start({ path: REQUEST });
    expect(oldDeps.registry).toBe(f.runtime.registry);
    expect(f.analyze.mock.calls[1][2].registry).toBe(f.runtime.registry);
    oldDeps.onSnapshot({ ...complete(), phase: 'done' });
    f.pending.reject(new Error('late rejection with private upstream data'));
    await flush();
    expect(second.jobId).not.toBe(first.jobId);
    expect(f.service.get(second.jobId)).toMatchObject({
      status: 'running',
      checkedAt: null,
    });
    expect(() => f.service.get(first.jobId)).toThrow(NotFoundException);
  });

  it('contains a background rejection, reports failed+partial, and never logs raw error/name/body', async () => {
    const errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const warnLog = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const f = fixture();
    const started = await f.service.start({ path: REQUEST });
    f.pending.reject(
      new Error('private-dependency-name raw-response-body auth-token'),
    );
    await flush();
    expect(f.service.get(started.jobId)).toMatchObject({
      status: 'failed',
      partial: true,
      failureCode: 'INTERNAL_SERVER_ERROR',
    });
    const logs = JSON.stringify([
      ...errorLog.mock.calls,
      ...warnLog.mock.calls,
    ]);
    expect(logs).not.toMatch(
      /private-dependency-name|raw-response-body|auth-token/,
    );
  });

  it('rechecks input exactly once at job end and never checks gate on that read', async () => {
    const f = fixture(1000);
    const started = await f.service.start({ path: REQUEST });
    f.assertIdle.mockImplementation(() => {
      throw new Error('busy after start');
    });
    f.pending.resolve(complete());
    await flush();
    expect(readInput).toHaveBeenCalledTimes(2);
    expect(readInput.mock.calls[1][0]).toBe(REQUEST);
    expect(readInput.mock.calls[1][2]).toBe(f.signal());
    expect(f.service.get(started.jobId)).toMatchObject({
      status: 'completed',
      phase: 'done',
      partial: false,
      stale: false,
      checkedAt: NOW,
      finishedAt: NOW,
    });
    expect(f.assertIdle).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each([
    'manifest',
    'config',
    'lock',
    'scan',
    'deleted',
    'unreadable',
  ] as const)(
    'marks %s changes at end validation stale with INPUT_CHANGED while retaining findings',
    async (kind) => {
      const f = fixture();
      const started = await f.service.start({ path: REQUEST });
      if (kind === 'deleted' || kind === 'unreadable') {
        readInput.mockRejectedValueOnce(
          Object.assign(new Error('safe'), {
            code: kind === 'deleted' ? 'NOT_FOUND' : 'FORBIDDEN',
          }),
        );
      } else {
        const changed = source();
        if (kind === 'scan') {
          changed.scanId = 'scan-2';
          f.setScan({ ...f.getLatest(), scanId: 'scan-2' });
        } else changed.inputHash = `hash-${kind}-changed`;
        readInput.mockResolvedValueOnce(changed);
      }
      const result = complete();
      result.audit.items = [
        {
          id: '7',
          name: 'pkg',
          title: 'Issue',
          severity: 'high',
          url: null,
          range: '<2',
          affectedVersions: ['1.0.0'],
          direct: true,
        },
      ];
      f.pending.resolve(result);
      await flush();
      const job = f.service.get(started.jobId);
      expect(job).toMatchObject({
        status: 'completed',
        partial: true,
        stale: true,
        failureCode: 'INPUT_CHANGED',
        audit: { items: result.audit.items },
      });
      expect(job.warningCodes).toContain('INPUT_CHANGED');
      expect(readInput).toHaveBeenCalledTimes(2);
    },
  );

  it('cancels promptly while the final validation is pending, and cannot be overwritten by it', async () => {
    const f = fixture();
    const started = await f.service.start({ path: REQUEST });
    const finalRead = deferred<IProjectInput>();
    readInput.mockReturnValueOnce(finalRead.promise);
    f.pending.resolve(complete());
    await flush();
    expect(readInput).toHaveBeenCalledTimes(2);
    const cancelled = f.service.cancel(started.jobId);
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      partial: true,
      checkedAt: null,
    });
    finalRead.resolve(source());
    await flush();
    expect(f.service.get(started.jobId)).toEqual(cancelled);
  });

  it('keeps the configured deadline active during final validation', async () => {
    const f = fixture(1000);
    const started = await f.service.start({ path: REQUEST });
    const finalRead = deferred<IProjectInput>();
    readInput.mockReturnValueOnce(finalRead.promise);
    f.pending.resolve(complete());
    await flush();
    await jest.advanceTimersByTimeAsync(1000);
    const terminal = f.service.get(started.jobId);
    expect(terminal).toMatchObject({
      status: 'timed_out',
      partial: true,
      checkedAt: null,
      failureCode: 'TIMED_OUT',
    });
    finalRead.resolve(source());
    await flush();
    expect(f.service.get(started.jobId)).toEqual(terminal);
  });

  it('preserves partial analysis status even when final input validation succeeds', async () => {
    const f = fixture();
    const started = await f.service.start({ path: REQUEST });
    const partial = complete();
    partial.audit = {
      ...partial.audit,
      state: 'unavailable',
      failureCode: 'REGISTRY_UNAVAILABLE',
    };
    partial.warningCodes = ['REGISTRY_UNAVAILABLE'];
    partial.partial = true;
    f.pending.resolve(partial);
    await flush();
    expect(f.service.get(started.jobId)).toMatchObject({
      status: 'completed',
      partial: true,
      stale: false,
      checkedAt: NOW,
      audit: { state: 'unavailable', failureCode: 'REGISTRY_UNAVAILABLE' },
    });
  });

  it('polls running and terminal snapshots with zero input/guard/fs/hash/gate/scan IO', async () => {
    const f = fixture();
    const started = await f.service.start({ path: REQUEST });
    const counts = () => [
      readInput.mock.calls.length,
      buildInventory.mock.calls.length,
      f.assertAllowed.mock.calls.length,
      f.lstat.mock.calls.length,
      f.realpath.mock.calls.length,
      f.readChunks.mock.calls.length,
      f.assertIdle.mock.calls.length,
      f.getLatest.mock.calls.length,
    ];
    const before = counts();
    for (let i = 0; i < 10; i++)
      expect(f.service.get(started.jobId).status).toBe('running');
    expect(counts()).toEqual(before);
    f.pending.resolve(complete());
    await flush();
    const terminal = f.service.get(started.jobId);
    const after = counts();
    readInput.mockRejectedValue(
      new Error('later filesystem changes must be ignored by GET'),
    );
    f.setScan({ scanId: 'later-scan', projects: [] });
    for (let i = 0; i < 10; i++)
      expect(f.service.get(started.jobId)).toEqual(terminal);
    expect(counts()).toEqual(after);
  });

  it('returns defensive nested copies and copies analyzer publications on receipt', async () => {
    const f = fixture();
    const started = await f.service.start({ path: REQUEST });
    const update = complete();
    update.audit.items = [
      {
        id: '7',
        name: 'pkg',
        title: 'Issue',
        severity: 'high',
        url: null,
        range: '<2',
        affectedVersions: ['1.0.0'],
        direct: true,
      },
    ];
    f.analysisDeps().onSnapshot({ ...update, phase: 'audit' });
    update.audit.items[0].affectedVersions.push('9.9.9');
    const snapshot = f.service.get(started.jobId);
    snapshot.audit.items[0].affectedVersions.length = 0;
    snapshot.warningCodes.push('INTERNAL_SERVER_ERROR');
    expect(
      f.service.get(started.jobId).audit.items[0].affectedVersions,
    ).toEqual(['1.0.0']);
    expect(f.service.get(started.jobId).warningCodes).not.toContain(
      'INTERNAL_SERVER_ERROR',
    );
  });

  it('returns 404 for unknown ids on get/cancel', () => {
    const f = fixture();
    expect(() => f.service.get('missing')).toThrow(NotFoundException);
    expect(() => f.service.cancel('missing')).toThrow(NotFoundException);
  });

  it('retains only the latest job after a completed result is replaced', async () => {
    const f = fixture();
    const first = await f.service.start({ path: REQUEST });
    f.pending.resolve(complete());
    await flush();
    expect(f.service.hasRunningAnalysis()).toBe(false);
    f.analyze.mockReturnValueOnce(deferred<IAnalysisResult>().promise);
    const second = await f.service.start({ path: REQUEST });
    expect(second.jobId).not.toBe(first.jobId);
    expect(() => f.service.get(first.jobId)).toThrow(NotFoundException);
  });

  it('closes on shutdown, aborts pending work, clears timers and rejects subsequent starts', async () => {
    const f = fixture(1000);
    const started = await f.service.start({ path: REQUEST });
    f.service.onModuleDestroy();
    expect(f.service.get(started.jobId).status).toBe('cancelled');
    expect(f.signal().aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    await expect(f.service.start({ path: REQUEST })).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  it('does not accept a start whose input read resolves after shutdown', async () => {
    const f = fixture();
    const pending = deferred<IProjectInput>();
    readInput.mockReturnValueOnce(pending.promise);
    const task = f.service.start({ path: REQUEST });
    f.service.onModuleDestroy();
    pending.resolve(source());
    await expect(task).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(f.analyze).not.toHaveBeenCalled();
  });
});
