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
} from '@/npm-runner/execution/runner-process';
import type {
  INativeSession,
  INativeSessionResult,
  INativeSessionSnapshot,
  NativeTermination,
} from '@/npm-runner/native-session/native-session';
import type { INativeSessionStartInput } from '@/npm-runner/interfaces/npm-runner.runtime';
import type {
  INativeConsolePreflight,
  NativePreflightResult,
} from '@/platform/windows/windows-native-console';
import type {
  INativeRecoveryClearCheck,
  INativeRecoveryStartup,
} from '@/npm-runner/native-session/native-recovery';
import {
  readRunnerInput,
  revalidateRunnerInput,
} from '@/npm-runner/toolchain/runner-input';
import {
  fsFixture,
  root,
  runnerInput,
} from '@/npm-runner/__fixtures__/runner-test.fixture';
import { NpmRunnerService } from '@/npm-runner/npm-runner.service';

jest.mock('@/npm-runner/toolchain/runner-input', () => ({
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

  it('replays an identical canonical request without rechecking readers/gate', async () => {
    const f = fixture();
    const first = await f.service.start(requestBody());
    await flush();
    f.readers.hasRunningScan.mockReturnValue(true);
    await expect(
      f.service.start(
        requestBody({ path: root.toUpperCase() + '\\.', consoleShell: 'cmd' }),
      ),
    ).resolves.toEqual(first);
    expect(f.enter).toHaveBeenCalledTimes(1);
    expect(f.launch).toHaveBeenCalledTimes(1);
    await f.exit();
    await expect(f.service.start(requestBody())).resolves.toMatchObject({
      jobId,
      status: 'completed',
    });
  });

  it.each([
    { path: 'D:\\TEST\\other' },
    { action: 'script' as const, script: 'dev' },
    { package: 'alpha' },
    { script: 'dev' },
    { inputHash: 'b'.repeat(64) },
    { consoleShell: 'powershell' as const },
  ])('rejects changed retained request fingerprint: %p', async (change) => {
    const f = fixture();
    await f.service.start(requestBody());
    await expect(f.service.start(requestBody(change))).rejects.toMatchObject({
      statusCode: 409,
      details: { reason: 'REQUEST_MISMATCH' },
    });
    expect(f.enter).toHaveBeenCalledTimes(1);
  });

  it('validates consoleShell even when called outside HTTP before acquiring the gate', async () => {
    const f = fixture();
    await expect(
      f.service.start(requestBody({ consoleShell: 'pwsh' as never })),
    ).rejects.toBeInstanceOf(ValidationException);
    expect(f.gate.isBusy()).toBe(false);
    expect(readRunnerInput).not.toHaveBeenCalled();
  });

  it('keeps reader predicates, gate and reservation synchronous before input IO', async () => {
    const f = fixture();
    const events: string[] = [];
    for (const [name, reader] of Object.entries(f.readers))
      reader.mockImplementation(() => {
        events.push(name);
        return false;
      });
    f.enter.mockImplementation(() => {
      events.push('gate');
      return Symbol('TEST lease');
    });
    jest.mocked(readRunnerInput).mockImplementation(() => {
      events.push(
        (f.service.latest() as IRunJob).gateHeld ? 'reserved' : 'missing',
      );
      return Promise.resolve(runnerInput());
    });
    await f.service.start(requestBody());
    expect(events.slice(0, 6)).toEqual([
      'hasRunningScan',
      'hasRunningMeasurement',
      'hasRunningPreview',
      'hasRunningAnalysis',
      'gate',
      'reserved',
    ]);
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
    expect((f.service.latest() as IRunJob).failureCode).toBe(
      'INTERNAL_SERVER_ERROR',
    );
    expect(JSON.stringify(f.service.latest())).not.toContain('TEST SECRET');
    expect(JSON.stringify(f.service.latest())).not.toContain('password');
  });

  it('compares the requested input hash before intent or spawn', async () => {
    const f = fixture();
    await f.service.start(requestBody({ inputHash: 'b'.repeat(64) }));
    await flush();
    expect((f.service.latest() as IRunJob).failureCode).toBe('INPUT_CHANGED');
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
      expect((f.service.latest() as IRunJob).gateHeld).toBe(
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
    expect((f.service.latest() as IRunJob).stopReason).toBe('cancel');
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
    expect((f.service.latest() as IRunJob).path).toBe(root);
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
    expect((f.service.latest() as IRunJob).warningCodes).toContain(
      'OUTPUT_TRUNCATED',
    );
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
    expect((f.service.latest() as IRunJob).terminationVerified).toBe(false);
  });
});

describe('NpmRunnerService native console & recovery lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-16T03:00:00.000Z') });
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

  function nativeFixture() {
    const f = fixture();
    const staleAllAnalyses = jest.fn<void, []>(() => undefined);
    f.runtime.invalidation.staleAllAnalyses = staleAllAnalyses;
    const preflightValue = (
      shell: 'cmd' | 'powershell',
    ): INativeConsolePreflight => ({
      execPath: 'C:\\node\\node.exe',
      supervisorFile:
        'C:\\api\\dist\\npm-runner\\native-session\\native-console-supervisor.js',
      bridgeFile:
        'C:\\api\\dist\\npm-runner\\native-session\\native-console-entry.js',
      shell,
      shellFile:
        shell === 'powershell'
          ? 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
          : 'C:\\Windows\\System32\\cmd.exe',
      shellArgs: shell === 'powershell' ? ['-NoLogo', '-NoProfile'] : ['/d'],
      systemRoot: 'C:\\Windows',
      files: [],
    });
    let sessionInput: INativeSessionStartInput | undefined;
    const settled = deferred<INativeSessionResult>();
    const startSession = jest.fn(() => Promise.resolve());
    const stopSession = jest.fn((reason: NativeTermination) => {
      void reason;
      return settled.promise;
    });
    const retryCleanup = jest.fn<Promise<INativeSessionResult>, []>(
      () => settled.promise,
    );
    const session: INativeSession = {
      start: startSession,
      stop: stopSession,
      retryCleanup,
      settled: settled.promise,
      snapshot: () => ({
        schema: 1,
        jobId,
        generation: 1,
        fingerprint: sessionInput?.fingerprint ?? '',
        phase: 'launching',
        entries: {
          execPath: 'C:\\node\\node.exe',
          supervisorFile:
            'C:\\api\\dist\\npm-runner\\native-session\\native-console-supervisor.js',
          bridgeFile:
            'C:\\api\\dist\\npm-runner\\native-session\\native-console-entry.js',
          shellFile: 'C:\\Windows\\System32\\cmd.exe',
        },
        identities: {},
        tracked: [],
        initialRetired: false,
        initialOutcome: null,
        sessionOutcome: null,
        termination: null,
      }),
    };
    const capability = jest.fn(() => Promise.resolve(true));
    const preflight = jest.fn<
      Promise<NativePreflightResult>,
      ['cmd' | 'powershell']
    >((shell) =>
      Promise.resolve({
        status: 'ok',
        value: preflightValue(shell),
      }),
    );
    const createSession = jest.fn((input: INativeSessionStartInput) => {
      sessionInput = input;
      return session;
    });
    f.runtime.native = {
      capability,
      preflight,
      createSession,
    };
    const emitState = (
      phase: INativeSessionSnapshot['phase'],
      extra: Partial<INativeSessionSnapshot> = {},
    ) => {
      sessionInput?.callbacks.onState?.({
        ...session.snapshot(),
        phase,
        ...extra,
      });
    };
    const settleNative = async (result: INativeSessionResult) => {
      settled.resolve(result);
      sessionInput?.callbacks.onSettled?.(result);
      await flush();
    };
    return {
      ...f,
      staleAllAnalyses,
      capability,
      preflight,
      createSession,
      startSession,
      stopSession,
      retryCleanup,
      settled,
      getSessionInput: () => sessionInput!,
      emitState,
      settleNative,
    };
  }

  it('reports nativeConsoleAvailable from runtime.native.capability and rejects unavailable shell without fallback', async () => {
    const plain = fixture();
    await expect(plain.service.context(root)).resolves.toMatchObject({
      nativeConsoleAvailable: false,
    });

    const nf = nativeFixture();
    await expect(nf.service.context(root)).resolves.toMatchObject({
      nativeConsoleAvailable: true,
    });

    nf.preflight.mockResolvedValueOnce({ status: 'unavailable' });
    await nf.service.start(requestBody({ consoleShell: 'powershell' }));
    await flush();
    expect(nf.createSession).not.toHaveBeenCalled();
    expect(nf.launch).not.toHaveBeenCalled();
    expect(nf.writeIntent).not.toHaveBeenCalled();
    expect(nf.service.get(jobId)).toMatchObject({
      status: 'failed',
      failureCode: 'NATIVE_CONSOLE_UNAVAILABLE',
      gateHeld: false,
      nativeSession: {
        shell: 'powershell',
        available: false,
      },
    });
  });

  it('keeps initial outcome distinct from open shell lifetime, does not arm service deadline, and invalidates conservatively on close', async () => {
    const nf = nativeFixture();
    nf.runtime.timeoutMs = 30_000;
    await nf.service.start(requestBody({ consoleShell: 'powershell' }));
    await flush();

    // Service must not arm a whole-session deadline timer that could kill an idle manual prompt.
    expect(nf.setTimer).not.toHaveBeenCalled();
    const input = nf.getSessionInput();
    expect(input.initialTimeoutMs).toBe(30_000);
    expect(input.init.shell).toBe('powershell');

    await input.writeIntent();
    expect(nf.writeIntent).toHaveBeenCalledTimes(1);
    input.callbacks.onInitSent?.();
    input.callbacks.onInitialSpawned?.(30);
    nf.emitState('initial_running');
    input.callbacks.onInitialOutcome?.({ exitCode: 0, signal: null });
    await flush();

    // Initial finished with 0, but shell is not done yet: job stays running and gate stays held.
    expect(nf.service.get(jobId)).toMatchObject({
      status: 'running',
      gateHeld: true,
      spawned: true,
      mayHaveChanged: true,
      exitCode: 0,
      initialCommand: { exitCode: 0, signal: null },
      nativeSession: {
        shell: 'powershell',
        phase: 'initial_finished',
      },
    });
    expect(nf.leave).not.toHaveBeenCalled();

    nf.emitState('shell_running');
    expect(nf.service.get(jobId).nativeSession?.phase).toBe('shell_open');

    // Duplicate onSettled + settled.then delivery must finalize only once.
    await nf.settleNative({
      phase: 'closed',
      termination: 'session_exit',
      initialOutcome: { exitCode: 0, signal: null },
      sessionOutcome: { exitCode: 0, signal: null },
      cleanupVerified: true,
    });
    expect(nf.service.get(jobId)).toMatchObject({
      status: 'completed',
      failureCode: null,
      gateHeld: false,
      terminationVerified: true,
      refreshRequired: true,
      auditWritten: true,
      initialCommand: { exitCode: 0, signal: null },
      nativeSession: {
        shell: 'powershell',
        phase: 'closed',
        sessionResult: { exitCode: 0, signal: null },
      },
    });
    expect(nf.staleAllAnalyses).toHaveBeenCalledTimes(1);
    expect(nf.clearDiskUsage).toHaveBeenCalledTimes(1);
    expect(nf.refreshProject).toHaveBeenCalledTimes(1);
    expect(nf.writeResult).toHaveBeenCalledTimes(1);
    expect(nf.leave).toHaveBeenCalledTimes(1);
  });

  it('never lets a normal shell exit 0 mask a failed initial command and preserves initial failure on cancel', async () => {
    const nf = nativeFixture();
    await nf.service.start(requestBody());
    await flush();
    const input = nf.getSessionInput();
    input.callbacks.onInitSent?.();
    input.callbacks.onInitialSpawned?.(30);
    input.callbacks.onInitialOutcome?.({ exitCode: 7, signal: null });
    nf.emitState('shell_running');
    await nf.settleNative({
      phase: 'closed',
      termination: 'session_exit',
      initialOutcome: { exitCode: 7, signal: null },
      sessionOutcome: { exitCode: 0, signal: null },
      cleanupVerified: true,
    });
    expect(nf.service.get(jobId)).toMatchObject({
      status: 'failed',
      failureCode: 'COMMAND_FAILED',
      exitCode: 7,
      initialCommand: { exitCode: 7, signal: null },
      nativeSession: {
        phase: 'closed',
        sessionResult: { exitCode: 0, signal: null },
      },
      gateHeld: false,
    });

    const nf2 = nativeFixture();
    nf2.uuid.mockReturnValue(nextJobId);
    await nf2.service.start(requestBody({ requestId: nextRequestId }));
    await flush();
    const input2 = nf2.getSessionInput();
    input2.callbacks.onInitSent?.();
    input2.callbacks.onInitialSpawned?.(31);
    input2.callbacks.onInitialOutcome?.({ exitCode: 5, signal: null });
    nf2.emitState('shell_running');
    await nf2.service.cancel(nextJobId);
    await nf2.service.cancel(nextJobId);
    expect(nf2.stopSession).toHaveBeenCalledTimes(1);
    expect(nf2.stopSession).toHaveBeenCalledWith('user_stop');
    await nf2.settleNative({
      phase: 'closed',
      termination: 'user_stop',
      initialOutcome: { exitCode: 5, signal: null },
      sessionOutcome: null,
      cleanupVerified: true,
    });
    expect(nf2.service.get(nextJobId)).toMatchObject({
      status: 'cancelled',
      failureCode: 'CANCELLED',
      stopReason: 'cancel',
      exitCode: 5,
      initialCommand: { exitCode: 5, signal: null },
      gateHeld: false,
    });
  });

  it('distinguishes X close before shell_open (SESSION_INTERRUPTED) from verified X close during shell_open', async () => {
    const beforeShell = nativeFixture();
    await beforeShell.service.start(requestBody());
    await flush();
    const in1 = beforeShell.getSessionInput();
    in1.callbacks.onInitSent?.();
    in1.callbacks.onInitialSpawned?.(30);
    in1.callbacks.onInitialOutcome?.({ exitCode: 0, signal: null });
    // Note: shell_running was never observed even though initialOutcome was 0.
    await beforeShell.settleNative({
      phase: 'closed',
      termination: 'window_closed',
      initialOutcome: { exitCode: 0, signal: null },
      sessionOutcome: null,
      cleanupVerified: true,
    });
    expect(beforeShell.service.get(jobId)).toMatchObject({
      status: 'failed',
      failureCode: 'SESSION_INTERRUPTED',
      terminationVerified: true,
      gateHeld: false,
    });

    const duringShell = nativeFixture();
    duringShell.uuid.mockReturnValue(nextJobId);
    await duringShell.service.start(requestBody({ requestId: nextRequestId }));
    await flush();
    const in2 = duringShell.getSessionInput();
    in2.callbacks.onInitSent?.();
    in2.callbacks.onInitialSpawned?.(31);
    in2.callbacks.onInitialOutcome?.({ exitCode: 0, signal: null });
    duringShell.emitState('shell_running');
    await duringShell.settleNative({
      phase: 'closed',
      termination: 'window_closed',
      initialOutcome: { exitCode: 0, signal: null },
      sessionOutcome: null,
      cleanupVerified: true,
    });
    expect(duringShell.service.get(nextJobId)).toMatchObject({
      status: 'completed',
      failureCode: null,
      terminationVerified: true,
      gateHeld: false,
      nativeSession: { phase: 'closed' },
    });
  });

  it('preserves INPUT_CHANGED in beforeInit, holds gate on unconfirmed cleanup even when !spawned, and awaits native cleanup on destroy', async () => {
    const changed = nativeFixture();
    await changed.service.start(requestBody());
    await flush();
    jest.mocked(revalidateRunnerInput).mockRejectedValueOnce(
      new AppException(409, 'Input changed', 'CONFLICT', {
        reason: 'INPUT_CHANGED',
      }),
    );
    await expect(changed.getSessionInput().beforeInit?.()).rejects.toThrow();
    await changed.settleNative({
      phase: 'closed',
      termination: 'start_failed',
      initialOutcome: null,
      sessionOutcome: null,
      cleanupVerified: true,
    });
    expect(changed.service.get(jobId)).toMatchObject({
      status: 'failed',
      failureCode: 'INPUT_CHANGED',
      spawned: false,
      mayHaveChanged: false,
      gateHeld: false,
    });

    const unconfirmed = nativeFixture();
    unconfirmed.uuid.mockReturnValue(nextJobId);
    await unconfirmed.service.start(requestBody({ requestId: nextRequestId }));
    await flush();
    const in2 = unconfirmed.getSessionInput();
    in2.callbacks.onInitSent?.();
    in2.callbacks.onInitialSpawned?.(44);
    await unconfirmed.settleNative({
      phase: 'lost',
      termination: 'start_failed',
      initialOutcome: null,
      sessionOutcome: null,
      cleanupVerified: false,
    });
    expect(unconfirmed.service.get(nextJobId)).toMatchObject({
      status: 'termination_failed',
      failureCode: 'TERMINATION_UNCONFIRMED',
      spawned: true,
      mayHaveChanged: true,
      terminationVerified: false,
      gateHeld: true,
      nativeSession: { phase: 'lost' },
    });
    expect(unconfirmed.leave).not.toHaveBeenCalled();

    // Even if initial never spawned, unconfirmed supervisor/bridge cleanup must hold gate.
    const helperLost = nativeFixture();
    await helperLost.service.start(requestBody());
    await flush();
    await helperLost.settleNative({
      phase: 'lost',
      termination: 'start_failed',
      initialOutcome: null,
      sessionOutcome: null,
      cleanupVerified: false,
    });
    expect(helperLost.service.get(jobId)).toMatchObject({
      status: 'termination_failed',
      failureCode: 'TERMINATION_UNCONFIRMED',
      spawned: false,
      terminationVerified: false,
      gateHeld: true,
    });

    // Shutdown must await native.settled and finalization work.
    const shuttingDown = nativeFixture();
    await shuttingDown.service.start(requestBody());
    await flush();
    let destroyResolved = false;
    const destroyPromise = shuttingDown.service.onModuleDestroy().then(() => {
      destroyResolved = true;
    });
    await flush();
    expect(shuttingDown.stopSession).toHaveBeenCalledWith('parent_exit');
    expect(destroyResolved).toBe(false);
    await shuttingDown.settleNative({
      phase: 'closed',
      termination: 'parent_exit',
      initialOutcome: null,
      sessionOutcome: null,
      cleanupVerified: true,
    });
    await destroyPromise;
    expect(destroyResolved).toBe(true);
    expect(shuttingDown.service.get(jobId)).toMatchObject({
      status: 'cancelled',
      failureCode: 'SHUTDOWN',
      gateHeld: false,
    });
  });

  it('holds gate when conservative whole-analysis invalidation fails and releases on retry', async () => {
    const nf = nativeFixture();
    nf.staleAllAnalyses.mockImplementationOnce(() => {
      throw new Error('stale fail');
    });
    await nf.service.start(requestBody());
    await flush();
    const input = nf.getSessionInput();
    input.callbacks.onInitSent?.();
    input.callbacks.onInitialSpawned?.(30);
    input.callbacks.onInitialOutcome?.({ exitCode: 0, signal: null });
    nf.emitState('shell_running');
    await nf.settleNative({
      phase: 'closed',
      termination: 'session_exit',
      initialOutcome: { exitCode: 0, signal: null },
      sessionOutcome: { exitCode: 0, signal: null },
      cleanupVerified: true,
    });
    expect(nf.service.get(jobId)).toMatchObject({
      status: 'failed',
      failureCode: 'CACHE_INVALIDATION_FAILED',
      refreshRequired: true,
      gateHeld: true,
    });
    expect(nf.leave).not.toHaveBeenCalled();
    await nf.service.cancel(jobId);
    await flush();
    expect(nf.service.get(jobId)).toMatchObject({
      status: 'completed',
      failureCode: null,
      refreshRequired: true,
      gateHeld: false,
    });
    expect(nf.leave).toHaveBeenCalledTimes(1);
  });

  it('aborts cleanly before createSession on preflight cancel and maps protocol/handshake/ipc/intent failures truthfully', async () => {
    const cancelled = nativeFixture();
    const hold = deferred<{ status: 'unavailable' }>();
    cancelled.preflight.mockReturnValueOnce(hold.promise);
    await cancelled.service.start(requestBody());
    await flush();
    await cancelled.service.cancel(jobId);
    hold.resolve({ status: 'unavailable' });
    await flush();
    expect(cancelled.createSession).not.toHaveBeenCalled();
    expect(cancelled.service.get(jobId)).toMatchObject({
      status: 'cancelled',
      failureCode: 'CANCELLED',
      gateHeld: false,
    });

    const intentFail = nativeFixture();
    intentFail.writeIntent.mockRejectedValueOnce(new Error('audit disk full'));
    await intentFail.service.start(requestBody());
    await flush();
    await expect(intentFail.getSessionInput().writeIntent()).rejects.toThrow();
    await intentFail.settleNative({
      phase: 'closed',
      termination: 'start_failed',
      initialOutcome: null,
      sessionOutcome: null,
      cleanupVerified: true,
    });
    expect(intentFail.service.get(jobId)).toMatchObject({
      status: 'failed',
      failureCode: 'AUDIT_WRITE_FAILED',
      spawned: false,
      mayHaveChanged: false,
      gateHeld: false,
    });

    for (const [termination, status, failureCode, stopReason] of [
      ['protocol_error', 'failed', 'NATIVE_PROTOCOL_ERROR', null],
      ['handshake_timeout', 'timed_out', 'TIMED_OUT', null],
      ['initial_timeout', 'timed_out', 'TIMED_OUT', 'timeout'],
      ['ipc_lost', 'failed', 'SESSION_INTERRUPTED', null],
    ] as const) {
      const nf = nativeFixture();
      await nf.service.start(requestBody());
      await flush();
      await nf.settleNative({
        phase: 'closed',
        termination,
        initialOutcome: null,
        sessionOutcome: null,
        cleanupVerified: true,
      });
      expect(nf.service.get(jobId)).toMatchObject({
        status,
        failureCode,
        stopReason,
        gateHeld: false,
      });
    }
  });

  it('keeps nativeSession.phase monotonic when in-flight onState arrives after cancel', async () => {
    const nf = nativeFixture();
    await nf.service.start(requestBody());
    await flush();
    nf.emitState('initial_running');
    expect(nf.service.get(jobId).nativeSession?.phase).toBe('initial_running');
    await nf.service.cancel(jobId);
    expect(nf.service.get(jobId).nativeSession?.phase).toBe('stopping');
    nf.emitState('shell_running');
    expect(nf.service.get(jobId).nativeSession?.phase).toBe('stopping');
    await nf.settleNative({
      phase: 'closed',
      termination: 'user_stop',
      initialOutcome: null,
      sessionOutcome: null,
      cleanupVerified: true,
    });
    expect(nf.service.get(jobId).nativeSession?.phase).toBe('closed');
  });

  function recoveryFixture(startup?: {
    active: boolean;
    reason?: string;
    journalPath?: string;
  }) {
    const nf = nativeFixture();
    const journalPath = 'D:\\TEST\\data\\native-project-terminal-session.json';
    const writeRecoveryIntent = jest.fn(() => Promise.resolve());
    const writeRecoveryResult = jest.fn(() => Promise.resolve());
    nf.runtime.audit.writeRecoveryIntent = writeRecoveryIntent;
    nf.runtime.audit.writeRecoveryResult = writeRecoveryResult;
    const evaluateOnStartup = jest.fn<Promise<INativeRecoveryStartup>, []>(() =>
      Promise.resolve(
        startup?.active
          ? {
              active: true,
              reason: startup.reason ?? 'UNRESOLVED_NATIVE_SESSION',
              journalPath: startup.journalPath ?? journalPath,
              hold: {
                active: true,
                reason: startup.reason ?? 'UNRESOLVED_NATIVE_SESSION',
                journalPath: startup.journalPath ?? journalPath,
              },
              snapshot: null,
            }
          : { active: false, hold: null, snapshot: null },
      ),
    );
    const verifyClearable = jest.fn<Promise<INativeRecoveryClearCheck>, []>(
      () => Promise.resolve({ clearable: true, reason: null, snapshot: null }),
    );
    const removeMarkers = jest.fn(() => Promise.resolve());
    nf.runtime.recovery = {
      journalPath,
      evaluateOnStartup,
      verifyClearable,
      removeMarkers,
    };
    const service = new NpmRunnerService(nf.runtime);
    return {
      ...nf,
      service,
      journalPath,
      writeRecoveryIntent,
      writeRecoveryResult,
      evaluateOnStartup,
      verifyClearable,
      removeMarkers,
    };
  }

  it('acquires MutationGate on startup hold before admission, exposes hold on context/latest/409, and clears safely', async () => {
    const rf = recoveryFixture({
      active: true,
      reason: 'CORRUPT_OR_PARTIAL_JOURNAL',
    });
    // Reject before onModuleInit completes
    await expect(rf.service.start(requestBody())).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'RECOVERY_HOLD' },
    });

    await rf.service.onModuleInit();
    expect(rf.enter).toHaveBeenCalledTimes(1);
    expect(rf.gate.isBusy()).toBe(true);

    await expect(rf.service.context(root)).resolves.toMatchObject({
      recoveryHold: {
        active: true,
        reason: 'CORRUPT_OR_PARTIAL_JOURNAL',
        journalPath: rf.journalPath,
      },
    });
    expect(rf.service.latest()).toEqual({
      recoveryHold: {
        active: true,
        reason: 'CORRUPT_OR_PARTIAL_JOURNAL',
        journalPath: rf.journalPath,
      },
      job: null,
    });
    await expect(rf.service.start(requestBody())).rejects.toMatchObject({
      code: 'CONFLICT',
      details: {
        reason: 'RECOVERY_HOLD',
        recoveryHold: { active: true },
      },
    });

    // Clear blocked when processes still active
    rf.verifyClearable.mockResolvedValueOnce({
      clearable: false,
      reason: 'PROCESSES_STILL_ACTIVE',
      snapshot: null,
    });
    await expect(
      rf.service.clearRecovery({ confirm: true }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'RECOVERY_HOLD' },
    });
    expect(rf.gate.isBusy()).toBe(true);
    expect(rf.removeMarkers).not.toHaveBeenCalled();

    // Clear blocked on invalidation failure
    rf.staleAllAnalyses.mockImplementationOnce(() => {
      throw new Error('stale fail');
    });
    await expect(
      rf.service.clearRecovery({ confirm: true }),
    ).rejects.toMatchObject({
      details: { reason: 'CACHE_INVALIDATION_FAILED' },
    });
    expect(rf.gate.isBusy()).toBe(true);
    expect(rf.removeMarkers).not.toHaveBeenCalled();

    // Clear blocked on marker removal failure
    rf.removeMarkers.mockRejectedValueOnce(new Error('unlink EPERM'));
    await expect(rf.service.clearRecovery({ confirm: true })).rejects.toThrow();
    expect(rf.gate.isBusy()).toBe(true);

    // Clear succeeds when all checks pass
    await expect(rf.service.clearRecovery({ confirm: true })).resolves.toEqual({
      cleared: true,
      recoveryHold: null,
    });
    expect(rf.gate.isBusy()).toBe(false);
    expect(rf.writeRecoveryIntent).toHaveBeenCalled();
    expect(rf.writeRecoveryResult).toHaveBeenCalled();
    expect(rf.clearDiskUsage).toHaveBeenCalled();
    expect(rf.staleAllAnalyses).toHaveBeenCalled();
    expect(() => rf.service.latest()).toThrow(NotFoundException);
    await expect(rf.service.start(requestBody())).resolves.toMatchObject({
      jobId,
      status: 'running',
    });
  });

  it('removes journal only after native cleanup + invalidation + result audit and holds gate if removal fails', async () => {
    const rf = recoveryFixture({ active: false });
    await rf.service.onModuleInit();
    expect(rf.gate.isBusy()).toBe(false);

    rf.removeMarkers.mockRejectedValueOnce(new Error('unlink EPERM'));
    await rf.service.start(requestBody());
    await flush();
    const input = rf.getSessionInput();
    input.callbacks.onInitSent?.();
    input.callbacks.onInitialSpawned?.(30);
    input.callbacks.onInitialOutcome?.({ exitCode: 0, signal: null });
    rf.emitState('shell_running');
    await rf.settleNative({
      phase: 'closed',
      termination: 'session_exit',
      initialOutcome: { exitCode: 0, signal: null },
      sessionOutcome: { exitCode: 0, signal: null },
      cleanupVerified: true,
    });
    expect(rf.writeResult).toHaveBeenCalledTimes(1);
    expect(rf.removeMarkers).toHaveBeenCalledTimes(1);
    expect(rf.gate.isBusy()).toBe(true);
    expect(rf.service.get(jobId)).toMatchObject({
      gateHeld: true,
      failureCode: 'RECOVERY_HOLD',
      recoveryHold: {
        active: true,
        reason: 'JOURNAL_REMOVAL_FAILED',
      },
    });
    expect(rf.leave).not.toHaveBeenCalled();

    await expect(rf.service.clearRecovery({ confirm: true })).resolves.toEqual({
      cleared: true,
      recoveryHold: null,
    });
    expect(rf.gate.isBusy()).toBe(false);
    expect(rf.service.get(jobId).gateHeld).toBe(false);
  });

  it('persists launching before native spawn, blocks concurrent clear, and keeps recovery hold across cancel/shutdown', async () => {
    // preflightNative aborts cleanly if createSession fails or journal_failed settles before spawn
    const failPersist = recoveryFixture({ active: false });
    await failPersist.service.onModuleInit();
    await failPersist.service.start(requestBody());
    await flush();
    await failPersist.settleNative({
      phase: 'lost',
      termination: 'journal_failed',
      initialOutcome: null,
      sessionOutcome: null,
      cleanupVerified: true,
    });
    expect(failPersist.service.get(jobId)).toMatchObject({
      status: 'failed',
      spawned: false,
      gateHeld: false,
    });

    // Startup non-AppException with busy gate fails closed and leaves recoveryReady=false
    const failGate = recoveryFixture({ active: true });
    failGate.evaluateOnStartup.mockRejectedValueOnce(new Error('boom'));
    failGate.enter.mockReturnValueOnce(null);
    await expect(failGate.service.onModuleInit()).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      statusCode: 500,
    });
    await expect(failGate.service.start(requestBody())).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'RECOVERY_HOLD' },
    });

    // Concurrent clearRecovery and audit failure paths
    const conc = recoveryFixture({ active: true });
    await conc.service.onModuleInit();
    conc.writeRecoveryIntent.mockRejectedValueOnce(new Error('audit down'));
    await expect(
      conc.service.clearRecovery({ confirm: true }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'AUDIT_WRITE_FAILED' },
    });

    const blockVerify = deferred<{
      clearable: boolean;
      reason: null;
      snapshot: null;
    }>();
    conc.verifyClearable.mockReturnValueOnce(blockVerify.promise);
    const firstClear = conc.service.clearRecovery({ confirm: true });
    await expect(
      conc.service.clearRecovery({ confirm: true }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'RECOVERY_HOLD' },
    });
    conc.writeRecoveryResult.mockRejectedValueOnce(
      new Error('audit result down'),
    );
    blockVerify.resolve({ clearable: true, reason: null, snapshot: null });
    await expect(firstClear).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'AUDIT_WRITE_FAILED' },
    });
    expect(conc.removeMarkers).not.toHaveBeenCalled();
    expect(conc.gate.isBusy()).toBe(true);

    // JOURNAL_REMOVAL_FAILED during finalize must NOT be retried by cancel(id) or onModuleDestroy()
    const holdCancel = recoveryFixture({ active: false });
    await holdCancel.service.onModuleInit();
    holdCancel.removeMarkers.mockRejectedValueOnce(new Error('unlink EPERM'));
    await holdCancel.service.start(requestBody());
    await flush();
    await holdCancel.settleNative({
      phase: 'closed',
      termination: 'session_exit',
      initialOutcome: { exitCode: 0, signal: null },
      sessionOutcome: { exitCode: 0, signal: null },
      cleanupVerified: true,
    });
    expect(holdCancel.removeMarkers).toHaveBeenCalledTimes(1);
    const cancelledSnap = await holdCancel.service.cancel(jobId);
    await holdCancel.service.onModuleDestroy();
    await flush();
    expect(cancelledSnap.failureCode).toBe('RECOVERY_HOLD');
    expect(cancelledSnap.gateHeld).toBe(true);
    expect(holdCancel.removeMarkers).toHaveBeenCalledTimes(1);
    expect(holdCancel.gate.isBusy()).toBe(true);

    // Native termination_failed retries cleanup via cancel(id), invalidates, removes journal, and releases gate
    const retryFx = recoveryFixture({ active: false });
    await retryFx.service.onModuleInit();
    await retryFx.service.start(requestBody());
    await flush();
    retryFx.retryCleanup.mockResolvedValueOnce({
      phase: 'closed',
      termination: 'session_exit',
      initialOutcome: { exitCode: 0, signal: null },
      sessionOutcome: { exitCode: 0, signal: null },
      cleanupVerified: true,
    });
    retryFx.emitState('shell_running');
    await retryFx.settleNative({
      phase: 'lost',
      termination: 'termination_unconfirmed',
      initialOutcome: { exitCode: 0, signal: null },
      sessionOutcome: { exitCode: 0, signal: null },
      cleanupVerified: false,
    });
    expect(retryFx.service.get(jobId)).toMatchObject({
      status: 'termination_failed',
      failureCode: 'TERMINATION_UNCONFIRMED',
      terminationVerified: false,
      gateHeld: true,
    });
    await retryFx.service.cancel(jobId);
    await flush();
    expect(retryFx.retryCleanup).toHaveBeenCalledTimes(1);
    expect(retryFx.service.get(jobId)).toMatchObject({
      status: 'completed',
      failureCode: null,
      terminationVerified: true,
      gateHeld: false,
      auditWritten: true,
      nativeSession: { phase: 'closed' },
    });
    expect(retryFx.removeMarkers).toHaveBeenCalledTimes(1);
    expect(retryFx.gate.isBusy()).toBe(false);
  });
});
