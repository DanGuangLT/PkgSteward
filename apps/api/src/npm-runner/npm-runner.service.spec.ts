import {
  AppException,
  NotFoundException,
  ValidationException,
} from '@/common/exceptions/app.exception';
import { MutationGateService } from '@/core/mutation-gate/mutation-gate.service';
import type { INpmRunnerRuntime } from '@/npm-runner/interfaces/npm-runner.runtime';
import type {
  IRunJob,
  IRunRequest,
  IRunnerInput,
} from '@/npm-runner/interfaces/npm-runner.types';
import type {
  IRunProcessExit,
  IRunProcessCallbacks,
} from '@/npm-runner/runner-process';
import {
  readRunnerInput,
  revalidateRunnerInput,
} from '@/npm-runner/runner-input';
import {
  fsFixture,
  root,
  runnerInput,
} from '@/npm-runner/__fixtures__/runner-test.fixture';
import { NpmRunnerService } from '@/npm-runner/npm-runner.service';

jest.mock('@/npm-runner/runner-input', () => ({
  readRunnerInput: jest.fn(),
  revalidateRunnerInput: jest.fn(),
}));
jest.mock('execa', () => ({ execa: jest.fn() }));

// TEST fixtures; không phải yêu cầu nghiệp vụ.
const jobId = '00000000-0000-4000-8000-000000000010';
const nextJobId = '00000000-0000-4000-8000-000000000011';
const requestId = '00000000-0000-4000-8000-000000000020';
const nextRequestId = '00000000-0000-4000-8000-000000000021';
const requestBody = (overrides: Partial<IRunRequest> = {}): IRunRequest => ({
  path: root,
  action: 'install_all',
  inputHash: 'a'.repeat(64),
  requestId,
  ...overrides,
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const flush = async () => {
  for (let turn = 0; turn < 40; turn++) await Promise.resolve();
};
const success = (
  overrides: Partial<IRunProcessExit> = {},
): IRunProcessExit => ({
  exitCode: 0,
  signal: null,
  failureCode: null,
  termination: 'verified',
  outputTruncated: false,
  ...overrides,
});

function fixture() {
  const inputFs = fsFixture();
  const gate = new MutationGateService();
  const enter = jest.spyOn(gate, 'tryEnter');
  const leave = jest.spyOn(gate, 'leave');
  const ended = deferred<IRunProcessExit>();
  let callbacks: IRunProcessCallbacks | undefined;
  const stop = jest.fn(() =>
    Promise.resolve<'verified' | 'unconfirmed'>('verified'),
  );
  const launch = jest.fn<
    ReturnType<INpmRunnerRuntime['launch']>,
    Parameters<INpmRunnerRuntime['launch']>
  >((_command, _env, listener) => {
    callbacks = listener;
    return { pid: 123, settled: ended.promise, stop };
  });
  const readers = {
    hasRunningScan: jest.fn(() => false),
    hasRunningMeasurement: jest.fn(() => false),
    hasRunningPreview: jest.fn(() => false),
    hasRunningAnalysis: jest.fn(() => false),
  };
  const writeIntent = jest.fn<Promise<void>, [Readonly<IRunJob>]>(() =>
    Promise.resolve(),
  );
  const writeResult = jest.fn<Promise<void>, [Readonly<IRunJob>]>(() =>
    Promise.resolve(),
  );
  const refreshProject = jest.fn<Promise<void>, [string]>(() =>
    Promise.resolve(),
  );
  const clearDiskUsage = jest.fn(() => undefined);
  const staleAnalysis = jest.fn<void, [string]>(() => undefined);
  const setTimer = jest.fn((callback: () => void, ms: number) =>
    setTimeout(callback, ms),
  );
  const uuid = jest.fn(() => jobId);
  const runtime: INpmRunnerRuntime = {
    input: inputFs.deps,
    env: {
      PATH: 'C:\\Windows\\System32',
      PORT: '24681',
      NODE_OPTIONS: '--inspect',
      TEST_APP: 'yes',
    },
    processes: {
      capture: jest.fn(() => Promise.resolve({ status: 'unknown' as const })),
      descendants: jest.fn(() =>
        Promise.resolve({ status: 'unknown' as const }),
      ),
      stopTree: jest.fn(() => Promise.resolve('attempted' as const)),
      verifyGone: jest.fn(() => Promise.resolve('verified' as const)),
    },
    timeoutMs: undefined,
    gate,
    readers,
    audit: { writeIntent, writeResult },
    invalidation: { refreshProject, clearDiskUsage, staleAnalysis },
    launch,
    now: () => new Date(),
    uuid,
    setTimer,
    clearTimer: (timer) => clearTimeout(timer),
  };
  const service = new NpmRunnerService(runtime);
  const exit = async (result = success()) => {
    ended.resolve(result);
    callbacks?.onExit(result);
    await flush();
  };
  return {
    service,
    runtime,
    inputFs,
    gate,
    enter,
    leave,
    readers,
    launch,
    stop,
    writeIntent,
    writeResult,
    refreshProject,
    clearDiskUsage,
    staleAnalysis,
    setTimer,
    uuid,
    exit,
    output: (stream: 'stdout' | 'stderr', bytes: Buffer) => {
      if (!callbacks) throw new Error('TEST process has not launched');
      callbacks.onOutput(stream, bytes);
    },
  };
}

describe('NpmRunnerService lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-03T03:00:00.000Z') });
    jest.mocked(readRunnerInput).mockReset().mockResolvedValue(runnerInput());
    jest
      .mocked(revalidateRunnerInput)
      .mockReset()
      .mockResolvedValue(runnerInput());
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('reserves synchronously: two unawaited starts cannot both enter preflight', async () => {
    const f = fixture();
    const barrier = deferred<IRunnerInput>();
    jest.mocked(readRunnerInput).mockReturnValue(barrier.promise);
    const first = f.service.start(requestBody());
    const second = f.service.start(
      requestBody({ requestId: nextRequestId, path: 'D:\\TEST\\other' }),
    );
    await expect(second).rejects.toMatchObject({
      code: 'CONFLICT',
      details: {
        reason: 'RUNNING',
        jobId,
        requestPath: root,
      },
    });
    expect(f.gate.isBusy()).toBe(true);
    await expect(first).resolves.toEqual({
      jobId,
      requestId,
      status: 'running',
    });
    expect(f.service.latest()).toMatchObject({
      phase: 'preflight',
      gateHeld: true,
      spawned: false,
    });
    expect(f.launch).not.toHaveBeenCalled();
    barrier.resolve(runnerInput());
    await flush();
    expect(f.launch).toHaveBeenCalledTimes(1);
  });

  it('replays the retained requestId even if payload differs, without rechecking readers/gate', async () => {
    const f = fixture();
    const first = await f.service.start(requestBody());
    await flush();
    f.readers.hasRunningScan.mockReturnValue(true);
    await expect(
      f.service.start(requestBody({ action: 'script', script: 'dev' })),
    ).resolves.toEqual(first);
    expect(f.enter).toHaveBeenCalledTimes(1);
    expect(f.launch).toHaveBeenCalledTimes(1);
    await f.exit();
    await expect(f.service.start(requestBody())).resolves.toMatchObject({
      jobId,
      status: 'completed',
    });
  });

  it('replaces a released job and allows an evicted requestId as a new start (A3)', async () => {
    const f = fixture();
    await f.service.start(requestBody());
    await flush();
    await f.exit();
    f.uuid.mockReturnValue(nextJobId);
    await expect(
      f.service.start(requestBody({ requestId: nextRequestId })),
    ).resolves.toMatchObject({ jobId: nextJobId });
    await flush();
    await f.exit();
    f.uuid.mockReturnValue(jobId);
    await expect(f.service.start(requestBody())).resolves.toMatchObject({
      jobId,
    });
    await flush();
    expect(() => f.service.get(nextJobId)).toThrow();
    expect(f.launch).toHaveBeenCalledTimes(3);
  });

  it.each([
    'hasRunningScan',
    'hasRunningMeasurement',
    'hasRunningPreview',
    'hasRunningAnalysis',
  ] as const)(
    'rejects %s before acquiring the gate or doing input IO',
    async (reader) => {
      const f = fixture();
      f.readers[reader].mockReturnValue(true);
      await expect(f.service.start(requestBody())).rejects.toMatchObject({
        code: 'CONFLICT',
        details: { reason: 'READERS_RUNNING' },
      });
      expect(f.enter).not.toHaveBeenCalled();
      expect(readRunnerInput).not.toHaveBeenCalled();
      expect(f.launch).not.toHaveBeenCalled();
    },
  );

  it('rejects another writer without releasing its lease', async () => {
    const f = fixture();
    const owner = f.gate.tryEnter();
    await expect(f.service.start(requestBody())).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'RUNNING' },
    });
    expect(f.leave).not.toHaveBeenCalled();
    expect(f.gate.isBusy()).toBe(true);
    expect(readRunnerInput).not.toHaveBeenCalled();
    if (owner) f.gate.leave(owner);
  });

  it.each(['platform', 'adapter'] as const)(
    'refuses unavailable %s before acquiring a lease',
    async (missing) => {
      const f = fixture();
      if (missing === 'platform') f.runtime.input.platform = 'posix';
      else f.runtime.processes = null;
      await expect(f.service.start(requestBody())).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
      });
      expect(f.enter).not.toHaveBeenCalled();
      expect(f.launch).not.toHaveBeenCalled();
    },
  );

  it('returns safe context, script eligibility and no executable paths without mutation', async () => {
    const f = fixture();
    const input = runnerInput();
    input.manifest.scripts.push({ name: 'bad name', command: 'echo TEST' });
    input.scripts['bad name'] = 'echo TEST';
    jest.mocked(readRunnerInput).mockResolvedValue(input);
    const context = await f.service.context(root);
    expect(context).toMatchObject({
      requestPath: root,
      path: root,
      available: true,
      version: input.tool?.version,
      scripts: [
        { name: 'dev', command: 'echo TEST', eligible: true },
        { name: 'bad name', command: 'echo TEST', eligible: false },
      ],
    });
    expect(JSON.stringify(context)).not.toContain('node.exe');
    expect(f.enter).not.toHaveBeenCalled();
    expect(f.launch).not.toHaveBeenCalled();
    expect(f.writeIntent).not.toHaveBeenCalled();
  });

  it('returns unavailable context with a null installed version', async () => {
    const f = fixture();
    jest.mocked(readRunnerInput).mockResolvedValue({
      ...runnerInput(),
      tool: null,
      reason: 'TOOL_NOT_FOUND',
    });
    await expect(f.service.context(root)).resolves.toMatchObject({
      available: false,
      version: null,
      reason: 'TOOL_NOT_FOUND',
    });
    expect(f.launch).not.toHaveBeenCalled();
  });

  it.each(['INPUT_CHANGED', 'CONFIG_UNSUPPORTED'] as const)(
    'stores preflight %s as a failed job, with no spawn/invalidation',
    async (reason) => {
      const f = fixture();
      jest
        .mocked(readRunnerInput)
        .mockRejectedValue(
          new AppException(409, 'TEST rejected', 'CONFLICT', { reason }),
        );
      await f.service.start(requestBody());
      await flush();
      expect(f.service.get(jobId)).toMatchObject({
        status: 'failed',
        failureCode: reason,
        spawned: false,
        mayHaveChanged: false,
        gateHeld: false,
      });
      expect(f.launch).not.toHaveBeenCalled();
      expect(f.refreshProject).not.toHaveBeenCalled();
      expect(f.clearDiskUsage).not.toHaveBeenCalled();
      expect(f.staleAnalysis).not.toHaveBeenCalled();
      expect(f.writeResult).toHaveBeenCalledTimes(1);
      expect(f.leave).toHaveBeenCalledTimes(1);
    },
  );

  it('maps unknown preflight exceptions without exposing their text', async () => {
    const f = fixture();
    jest
      .mocked(readRunnerInput)
      .mockRejectedValue(new Error('TEST SECRET path/password'));
    await f.service.start(requestBody());
    await flush();
    expect(f.service.latest().failureCode).toBe('INTERNAL_SERVER_ERROR');
    expect(JSON.stringify(f.service.latest())).not.toContain('TEST SECRET');
    expect(JSON.stringify(f.service.latest())).not.toContain('password');
  });

  it('compares the requested input hash before intent or spawn', async () => {
    const f = fixture();
    await f.service.start(requestBody({ inputHash: 'b'.repeat(64) }));
    await flush();
    expect(f.service.latest().failureCode).toBe('INPUT_CHANGED');
    expect(f.writeIntent).not.toHaveBeenCalled();
    expect(f.launch).not.toHaveBeenCalled();
  });

  it('writes intent before final revalidation and exactly one launch with the filtered environment', async () => {
    const f = fixture();
    await f.service.start(requestBody());
    await flush();
    expect(f.writeIntent).toHaveBeenCalledTimes(1);
    expect(revalidateRunnerInput).toHaveBeenCalledTimes(1);
    expect(f.writeIntent.mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(revalidateRunnerInput).mock.invocationCallOrder[0],
    );
    expect(
      jest.mocked(revalidateRunnerInput).mock.invocationCallOrder[0],
    ).toBeLessThan(f.launch.mock.invocationCallOrder[0]);
    const [command, env] = f.launch.mock.calls[0];
    expect(command.args).toContain('install');
    expect(command.cwd).toBe(root);
    expect(env.PORT).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.TEST_APP).toBe('yes');
    expect(env.CI).toBe('1');
    expect(f.service.latest()).toMatchObject({
      phase: 'executing',
      spawned: true,
      mayHaveChanged: true,
    });
  });

  it('never spawns after an intent audit failure; still attempts a result audit', async () => {
    const f = fixture();
    f.writeIntent.mockRejectedValueOnce(new Error('TEST audit unavailable'));
    await f.service.start(requestBody());
    await flush();
    expect(f.service.latest()).toMatchObject({
      status: 'failed',
      failureCode: 'AUDIT_WRITE_FAILED',
      spawned: false,
    });
    expect(f.launch).not.toHaveBeenCalled();
    expect(revalidateRunnerInput).not.toHaveBeenCalled();
    expect(f.writeResult).toHaveBeenCalledTimes(1);
  });

  it.each(['input', 'intent', 'revalidation'] as const)(
    'cancel during %s await prevents every later launch',
    async (step) => {
      const f = fixture();
      const barrier = deferred<IRunnerInput>();
      const intent = deferred<void>();
      if (step === 'input')
        jest.mocked(readRunnerInput).mockReturnValueOnce(barrier.promise);
      if (step === 'intent') f.writeIntent.mockReturnValueOnce(intent.promise);
      if (step === 'revalidation')
        jest.mocked(revalidateRunnerInput).mockReturnValueOnce(barrier.promise);
      await f.service.start(requestBody());
      await flush();
      await expect(f.service.cancel(jobId)).resolves.toMatchObject({
        status: 'stopping',
        stopReason: 'cancel',
      });
      barrier.resolve(runnerInput());
      intent.resolve();
      await flush();
      expect(f.launch).not.toHaveBeenCalled();
      expect(f.stop).not.toHaveBeenCalled();
      expect(f.service.latest()).toMatchObject({
        status: 'cancelled',
        failureCode: 'CANCELLED',
        gateHeld: false,
      });
    },
  );

  it.each([
    [success(), 'completed', null],
    [
      success({ exitCode: 7, failureCode: 'COMMAND_FAILED' }),
      'failed',
      'COMMAND_FAILED',
    ],
    [
      success({ exitCode: null, failureCode: 'SPAWN_FAILED' }),
      'failed',
      'SPAWN_FAILED',
    ],
    [
      success({ termination: 'unconfirmed' }),
      'termination_failed',
      'TERMINATION_UNCONFIRMED',
    ],
  ] as const)(
    'maps process result %# and preserves actual exit/signal',
    async (exit, status, failureCode) => {
      const f = fixture();
      if (exit.failureCode === 'SPAWN_FAILED')
        f.launch.mockImplementationOnce((_c, _e, listener) => {
          queueMicrotask(() => listener.onExit(exit));
          return { pid: null, settled: Promise.resolve(exit), stop: f.stop };
        });
      await f.service.start(requestBody());
      await flush();
      await f.exit(exit);
      expect(f.service.latest()).toMatchObject({
        status,
        failureCode,
        exitCode: exit.exitCode,
        signal: exit.signal,
      });
      expect(f.service.latest().gateHeld).toBe(
        exit.termination === 'unconfirmed',
      );
      expect(f.refreshProject).toHaveBeenCalledTimes(
        exit.failureCode === 'SPAWN_FAILED' ? 0 : 1,
      );
    },
  );

  it('handles a synchronous launch failure as SPAWN_FAILED without invalidating', async () => {
    const f = fixture();
    f.launch.mockImplementationOnce(() => {
      throw new Error('TEST no executable');
    });
    await f.service.start(requestBody());
    await flush();
    expect(f.service.latest()).toMatchObject({
      status: 'failed',
      failureCode: 'SPAWN_FAILED',
      spawned: false,
      exitCode: null,
      gateHeld: false,
    });
    expect(f.refreshProject).not.toHaveBeenCalled();
  });

  it('serializes concurrent cancellation, first stop reason wins over deadline', async () => {
    const f = fixture();
    f.runtime.timeoutMs = 1000;
    const stop = deferred<'verified' | 'unconfirmed'>();
    f.stop.mockReturnValueOnce(stop.promise);
    await f.service.start(requestBody());
    await flush();
    await f.service.cancel(jobId);
    await f.service.cancel(jobId);
    await jest.advanceTimersByTimeAsync(1000);
    expect(f.stop).toHaveBeenCalledTimes(1);
    expect(f.service.latest().stopReason).toBe('cancel');
    stop.resolve('verified');
    await f.exit(success({ exitCode: null, signal: 'SIGTERM' }));
    expect(f.service.latest()).toMatchObject({
      status: 'cancelled',
      failureCode: 'CANCELLED',
      gateHeld: false,
    });
    await f.service.cancel(jobId);
    expect(f.stop).toHaveBeenCalledTimes(1);
  });

  it('counts timeout from acceptance including a blocked preflight, without spawning', async () => {
    const f = fixture();
    f.runtime.timeoutMs = 1000;
    const input = deferred<IRunnerInput>();
    jest.mocked(readRunnerInput).mockReturnValueOnce(input.promise);
    await f.service.start(requestBody());
    await jest.advanceTimersByTimeAsync(1000);
    input.resolve(runnerInput());
    await flush();
    expect(f.service.latest()).toMatchObject({
      status: 'timed_out',
      failureCode: 'TIMED_OUT',
      stopReason: 'timeout',
      spawned: false,
    });
    expect(f.launch).not.toHaveBeenCalled();
  });

  it('timeout after launch uses verified stop and invalidates before release', async () => {
    const f = fixture();
    f.runtime.timeoutMs = 1000;
    await f.service.start(requestBody());
    await flush();
    await jest.advanceTimersByTimeAsync(1000);
    await f.exit(success({ exitCode: null, signal: 'SIGTERM' }));
    expect(f.stop).toHaveBeenCalledTimes(1);
    expect(f.service.latest()).toMatchObject({
      status: 'timed_out',
      stopReason: 'timeout',
      mayHaveChanged: true,
      gateHeld: false,
    });
    expect(f.refreshProject).toHaveBeenCalledTimes(1);
  });

  it('chains a huge deadline in signed 32-bit segments and leaves empty config unlimited', async () => {
    const f = fixture();
    f.runtime.timeoutMs = 2 ** 31 + 1000;
    await f.service.start(requestBody());
    await flush();
    expect(f.setTimer.mock.calls[0][1]).toBe(2 ** 31 - 1);
    await jest.advanceTimersByTimeAsync(2 ** 31 - 1);
    expect(f.stop).not.toHaveBeenCalled();
    expect(f.setTimer.mock.calls.at(-1)?.[1]).toBe(1001);
    await jest.advanceTimersByTimeAsync(1001);
    expect(f.stop).toHaveBeenCalledTimes(1);
    const unlimited = fixture();
    await unlimited.service.start(requestBody());
    await flush();
    expect(unlimited.setTimer).not.toHaveBeenCalled();
  });

  it('tries all invalidators with gate held, waits before audit and releases only afterward', async () => {
    const f = fixture();
    const refresh = deferred<void>();
    f.refreshProject.mockReturnValueOnce(refresh.promise);
    await f.service.start(requestBody());
    await flush();
    await f.exit();
    expect(f.gate.isBusy()).toBe(true);
    expect(f.leave).not.toHaveBeenCalled();
    refresh.resolve();
    await flush();
    expect(f.clearDiskUsage).toHaveBeenCalledTimes(1);
    expect(f.staleAnalysis).toHaveBeenCalledTimes(1);
    expect(f.writeResult.mock.invocationCallOrder[0]).toBeGreaterThan(
      f.staleAnalysis.mock.invocationCallOrder[0],
    );
    expect(f.leave.mock.invocationCallOrder[0]).toBeGreaterThan(
      f.writeResult.mock.invocationCallOrder[0],
    );
    expect(f.leave).toHaveBeenCalledTimes(1);
  });

  it.each(['refresh', 'disk', 'analysis'] as const)(
    'retains lease after %s failure, attempts every invalidator, retries only pending cleanup',
    async (part) => {
      const f = fixture();
      if (part === 'refresh')
        f.refreshProject.mockRejectedValueOnce(
          new Error('TEST refresh failed'),
        );
      if (part === 'disk')
        f.clearDiskUsage.mockImplementationOnce(() => {
          throw new Error('TEST cache failed');
        });
      if (part === 'analysis')
        f.staleAnalysis.mockImplementationOnce(() => {
          throw new Error('TEST stale failed');
        });
      await f.service.start(requestBody());
      await flush();
      await f.exit();
      expect(f.service.latest()).toMatchObject({
        failureCode: 'CACHE_INVALIDATION_FAILED',
        refreshRequired: true,
        gateHeld: true,
        exitCode: 0,
      });
      expect(f.refreshProject).toHaveBeenCalledTimes(1);
      expect(f.clearDiskUsage).toHaveBeenCalledTimes(1);
      expect(f.staleAnalysis).toHaveBeenCalledTimes(1);
      expect(f.leave).not.toHaveBeenCalled();
      await f.service.cancel(jobId);
      await flush();
      expect(f.service.latest()).toMatchObject({
        gateHeld: false,
        refreshRequired: false,
      });
      expect(f.launch).toHaveBeenCalledTimes(1);
      expect(f.stop).not.toHaveBeenCalled();
      expect(f.refreshProject).toHaveBeenCalledTimes(
        part === 'refresh' ? 2 : 1,
      );
      expect(f.clearDiskUsage).toHaveBeenCalledTimes(part === 'disk' ? 2 : 1);
      expect(f.staleAnalysis).toHaveBeenCalledTimes(
        part === 'analysis' ? 2 : 1,
      );
      expect(f.leave).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps COMMAND_FAILED over cache failure and preserves its exit code', async () => {
    const f = fixture();
    f.refreshProject.mockRejectedValueOnce(new Error('TEST refresh failed'));
    await f.service.start(requestBody());
    await flush();
    await f.exit(success({ exitCode: 42, failureCode: 'COMMAND_FAILED' }));
    expect(f.service.latest()).toMatchObject({
      failureCode: 'COMMAND_FAILED',
      exitCode: 42,
      refreshRequired: true,
      gateHeld: true,
    });
  });

  it('holds the gate when result audit fails; explicit retry does not repeat invalidation or spawn', async () => {
    const f = fixture();
    f.writeResult.mockRejectedValueOnce(new Error('TEST audit failure'));
    await f.service.start(requestBody());
    await flush();
    await f.exit();
    expect(f.service.latest()).toMatchObject({
      auditWritten: false,
      failureCode: 'AUDIT_WRITE_FAILED',
      gateHeld: true,
      exitCode: 0,
    });
    await expect(
      f.service.start(requestBody({ requestId: nextRequestId })),
    ).rejects.toMatchObject({ details: { reason: 'RUNNING', jobId } });
    await f.service.cancel(jobId);
    await flush();
    expect(f.writeResult).toHaveBeenCalledTimes(2);
    expect(f.refreshProject).toHaveBeenCalledTimes(1);
    expect(f.launch).toHaveBeenCalledTimes(1);
    expect(f.stop).not.toHaveBeenCalled();
    expect(f.service.latest()).toMatchObject({
      auditWritten: true,
      gateHeld: false,
    });
    expect(f.leave).toHaveBeenCalledTimes(1);
  });

  it('retries termination before pending cleanup, never respawns, releases exactly once', async () => {
    const f = fixture();
    const verify = deferred<'verified' | 'unconfirmed'>();
    await f.service.start(requestBody());
    await flush();
    await f.exit(success({ termination: 'unconfirmed' }));
    expect(f.service.latest()).toMatchObject({
      status: 'termination_failed',
      gateHeld: true,
    });
    f.stop.mockReturnValueOnce(verify.promise);
    await f.service.cancel(jobId);
    await f.service.cancel(jobId);
    await flush();
    expect(f.stop).toHaveBeenCalledTimes(1);
    expect(f.gate.isBusy()).toBe(true);
    verify.resolve('verified');
    await flush();
    expect(f.service.latest()).toMatchObject({
      terminationVerified: true,
      gateHeld: false,
    });
    expect(f.launch).toHaveBeenCalledTimes(1);
    expect(f.leave).toHaveBeenCalledTimes(1);
  });

  it('treats a rejected stop as unconfirmed and retains its lease for explicit retry', async () => {
    const f = fixture();
    f.stop.mockRejectedValueOnce(new Error('TEST snapshot unavailable'));
    await f.service.start(requestBody());
    await flush();
    await f.service.cancel(jobId);
    await flush();
    expect(f.service.latest()).toMatchObject({
      status: 'termination_failed',
      failureCode: 'TERMINATION_UNCONFIRMED',
      gateHeld: true,
    });
    expect(f.leave).not.toHaveBeenCalled();
    await f.service.cancel(jobId);
    await f.exit(success({ exitCode: null, signal: 'SIGTERM' }));
    expect(f.stop).toHaveBeenCalledTimes(2);
    expect(f.launch).toHaveBeenCalledTimes(1);
    expect(f.leave).toHaveBeenCalledTimes(1);
  });

  it('cancel during an in-flight final audit joins cleanup without writing or killing twice', async () => {
    const f = fixture();
    const audit = deferred<void>();
    f.writeResult.mockReturnValueOnce(audit.promise);
    await f.service.start(requestBody());
    await flush();
    await f.exit();
    expect(f.service.latest()).toMatchObject({
      phase: 'finalizing',
      gateHeld: true,
    });
    await f.service.cancel(jobId);
    await f.service.cancel(jobId);
    await flush();
    expect(f.writeResult).toHaveBeenCalledTimes(1);
    expect(f.stop).not.toHaveBeenCalled();
    expect(f.leave).not.toHaveBeenCalled();
    audit.resolve();
    await flush();
    expect(f.service.latest()).toMatchObject({
      status: 'completed',
      gateHeld: false,
    });
    expect(f.leave).toHaveBeenCalledTimes(1);
    expect(f.launch).toHaveBeenCalledTimes(1);
  });

  it('keeps status/log polls defensive and IO-free, rejects an ahead cursor', async () => {
    const f = fixture();
    await f.service.start(requestBody());
    await flush();
    f.output('stdout', Buffer.from('TEST hello\n'));
    f.output('stderr', Buffer.from('TEST warning\n'));
    const before = jest.mocked(readRunnerInput).mock.calls.length;
    const job = f.service.get(jobId);
    job.warningCodes.push('OUTPUT_TRUNCATED');
    job.path = 'TEST tampered';
    const logs = f.service.logs(jobId, 0);
    logs.chunks[0].text = 'TEST changed';
    expect(f.service.latest().path).toBe(root);
    expect(f.service.get(jobId).warningCodes).not.toContain('OUTPUT_TRUNCATED');
    expect(f.service.logs(jobId, 0).chunks[0].text).toBe('TEST hello\n');
    expect(f.service.latest()).toMatchObject({
      firstCursor: 0,
      endCursor: 2,
      droppedBytes: 0,
    });
    expect(f.service.latest()).not.toHaveProperty('chunks');
    expect(() => f.service.logs(jobId, 3)).toThrow(ValidationException);
    expect(jest.mocked(readRunnerInput).mock.calls).toHaveLength(before);
  });

  it('mirrors log loss and warnings without retaining output on the job', async () => {
    const f = fixture();
    await f.service.start(requestBody());
    await flush();
    f.output(
      'stdout',
      Buffer.from(('TEST ' + 'x'.repeat(8180) + '\n').repeat(150)),
    );
    const job = f.service.get(jobId);
    const page = f.service.logs(jobId, 0);
    expect(job.firstCursor).toBeGreaterThan(0);
    expect(job.droppedBytes).toBeGreaterThan(0);
    expect(job.warningCodes).toContain('OUTPUT_TRUNCATED');
    expect(page.truncated).toBe(true);
    expect(page.firstCursor).toBe(job.firstCursor);
    expect(page.endCursor).toBe(job.endCursor);
    expect(Buffer.byteLength(JSON.stringify(job))).toBeLessThan(4096);
  });

  it('reports final-drain truncation and flushes partial text after process exit', async () => {
    const f = fixture();
    await f.service.start(requestBody());
    await flush();
    f.output('stdout', Buffer.from('TEST partial'));
    await f.exit(success({ outputTruncated: true }));
    expect(f.service.latest().warningCodes).toContain('OUTPUT_TRUNCATED');
    expect(
      f.service
        .logs(jobId, 0)
        .chunks.map((chunk) => chunk.text)
        .join(''),
    ).toBe('TEST partial');
  });

  it('returns NOT_FOUND for unknown or absent jobs on every poll/cancel path', async () => {
    const f = fixture();
    expect(() => f.service.latest()).toThrow(NotFoundException);
    expect(() => f.service.get(jobId)).toThrow(NotFoundException);
    expect(() => f.service.logs(jobId, 0)).toThrow(NotFoundException);
    await expect(f.service.cancel(jobId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('shutdown refuses new starts and uses the same verified stop/finalization path', async () => {
    const f = fixture();
    await f.service.start(requestBody());
    await flush();
    const shutdown = f.service.onModuleDestroy();
    await flush();
    await expect(
      f.service.start(requestBody({ requestId: nextRequestId })),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    await f.exit(success({ exitCode: null, signal: 'SIGTERM' }));
    await shutdown;
    expect(f.service.latest()).toMatchObject({
      status: 'cancelled',
      stopReason: 'shutdown',
      failureCode: 'SHUTDOWN',
      gateHeld: false,
    });
    expect(f.stop).toHaveBeenCalledTimes(1);
    expect(f.refreshProject).toHaveBeenCalledTimes(1);
  });

  it('shutdown returns within 30 seconds if stop never verifies and keeps its lease', async () => {
    const f = fixture();
    f.stop.mockReturnValue(new Promise(() => undefined));
    await f.service.start(requestBody());
    await flush();
    const shutdown = f.service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(30_000);
    await shutdown;
    expect(f.gate.isBusy()).toBe(true);
    expect(f.leave).not.toHaveBeenCalled();
    expect(f.service.latest().terminationVerified).toBe(false);
  });
});
