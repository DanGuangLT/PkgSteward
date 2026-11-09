import 'reflect-metadata';
import { AppException } from '@/common/exceptions/app.exception';
import { GlobalJob } from '@/global-packages/execution/global-job';
import type { IGlobalJobDeps } from '@/global-packages/execution/global-job';
import type { IGlobalJob } from '@/global-packages/interfaces/global-packages.types';
import {
  deferred,
  flushJobs,
  testClock,
  testProcess,
  TEST_JOB_ID,
  TEST_REQUEST_ID,
} from '@/global-packages/__fixtures__/global-lifecycle';

function setup(timeoutMs?: number) {
  const clock = testClock();
  const child = testProcess();
  const finalize = jest
    .fn<Promise<void>, [IGlobalJob]>()
    .mockImplementation((job) => {
      job.auditWritten = true;
      if (job.terminationVerified) job.gateHeld = false;
      return Promise.resolve();
    });
  const deps: IGlobalJobDeps = {
    now: clock.now,
    monotonicNow: clock.monotonicNow,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    timeoutMs,
    launch: child.launch,
    finalize,
  };
  const job = new GlobalJob(
    {
      jobId: TEST_JOB_ID,
      requestId: TEST_REQUEST_ID,
      kind: 'mutation',
      gateHeld: true,
    },
    deps,
  );
  const command = {
    file: 'D:\\TEST\\node.exe',
    args: ['D:\\TEST\\npm-cli.js'],
    cwd: 'D:\\TEST\\neutral',
    env: {},
  };
  return { job, clock, child, finalize, command, deps };
}

describe('M7 job deadline and preflight stop', () => {
  it('publishes the provisional job before work awaits', async () => {
    const { job } = setup();
    const wait = deferred<void>();
    job.run(async () => {
      await wait.promise;
    });
    expect(job.snapshot()).toMatchObject({
      jobId: TEST_JOB_ID,
      requestId: TEST_REQUEST_ID,
      kind: 'mutation',
      status: 'running',
      phase: 'preflight',
      gateHeld: true,
      mutationSpawned: false,
    });
    wait.resolve();
    await job.settled();
  });

  it('does not arm an execution deadline when timeout is unset', async () => {
    const { job, clock } = setup();
    const wait = deferred<void>();
    job.run(async () => {
      await wait.promise;
    });
    clock.advance(10 ** 10);
    expect(job.signal.aborted).toBe(false);
    expect(clock.setTimer).not.toHaveBeenCalled();
    wait.resolve();
    await job.settled();
  });

  it('times out preflight using monotonic time and never launches afterwards', async () => {
    const { job, child, command, clock } = setup(1000);
    const wait = deferred<void>();
    job.run(async (activity) => {
      await wait.promise;
      activity.checkpoint();
      await activity.launch(command);
    });
    clock.jumpWall(-86400_000);
    clock.advance(1000);
    expect(job.signal.aborted).toBe(true);
    wait.resolve();
    await job.settled();
    expect(child.launch).not.toHaveBeenCalled();
    expect(job.snapshot()).toMatchObject({
      status: 'timed_out',
      stopReason: 'timeout',
      failureCode: 'TIMED_OUT',
      mutationSpawned: false,
      terminationVerified: true,
      gateHeld: false,
    });
  });

  it('segments deadlines above the native timer maximum', async () => {
    const { job, clock } = setup(2 ** 31 + 5000);
    const wait = deferred<void>();
    job.run(async () => {
      await wait.promise;
    });
    expect(clock.setTimer.mock.calls[0][1]).toBe(2 ** 31 - 1);
    clock.advance(2 ** 31 - 1);
    expect(job.signal.aborted).toBe(false);
    expect(clock.setTimer.mock.calls[1][1]).toBe(5001);
    clock.advance(5001);
    wait.resolve();
    await job.settled();
    expect(job.snapshot().status).toBe('timed_out');
  });

  it.each(['cancel', 'timeout', 'shutdown'] as const)(
    'keeps first reason %s and cancels at an await boundary',
    async (reason) => {
      const { job, child, command } = setup();
      const wait = deferred<void>();
      job.run(async (activity) => {
        await wait.promise;
        activity.checkpoint();
        await activity.launch(command);
      });
      job.stop(reason);
      job.stop(reason === 'cancel' ? 'shutdown' : 'cancel');
      expect(job.snapshot().stopReason).toBe(reason);
      wait.resolve();
      await job.settled();
      expect(child.launch).not.toHaveBeenCalled();
      expect(job.snapshot().status).toBe(
        reason === 'timeout' ? 'timed_out' : 'cancelled',
      );
    },
  );
});

describe('M7 launch, stop verification and finalize once', () => {
  it('admits cleanup retry immediately when polling first observes done', async () => {
    const { job, child, finalize } = setup();
    finalize.mockImplementationOnce(() => Promise.resolve());
    const work = jest
      .fn<Promise<void>, [GlobalJob]>()
      .mockResolvedValue(undefined);
    job.run(work);
    // Poll at each turn instead of awaiting settled(), exposing terminal publication races.
    for (let i = 0; i < 100 && job.snapshot().phase !== 'done'; i++) {
      await Promise.resolve();
    }
    expect(job.snapshot()).toMatchObject({ phase: 'done', gateHeld: true });
    const retry = job.retryCleanup();
    const duplicate = job.retryCleanup();
    expect(duplicate).toBe(retry);
    await retry;
    expect(finalize).toHaveBeenCalledTimes(2);
    expect(job.snapshot()).toMatchObject({ phase: 'done', gateHeld: false });
    expect(work).toHaveBeenCalledTimes(1);
    expect(child.launch).not.toHaveBeenCalled();
  });

  it('handles a synchronous exit callback plus settled promise exactly once', async () => {
    const { job, child, finalize, command } = setup();
    child.launch.mockImplementationOnce((_command, callbacks) => {
      const result = child.exit();
      callbacks.onExit(result);
      return { ...child.process, settled: Promise.resolve(result) };
    });
    job.run(async (activity) => {
      await activity.launch(command);
    });
    await job.settled();
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(child.launch).toHaveBeenCalledTimes(1);
    expect(job.snapshot()).toMatchObject({
      status: 'completed',
      mutationSpawned: true,
      terminationVerified: true,
      mayHaveChanged: true,
      auditWritten: true,
      gateHeld: false,
    });
  });

  it('does not treat a verified failure without a pid as a spawned mutation', async () => {
    const { job, child, command } = setup();
    child.launch.mockReturnValueOnce({ ...child.process, pid: null });
    job.run(async (activity) => {
      await activity.launch(command);
    });
    await flushJobs();
    child.exit({ exitCode: null, failureCode: 'SPAWN_FAILED' });
    await job.settled();
    expect(job.snapshot()).toMatchObject({
      status: 'failed',
      failureCode: 'SPAWN_FAILED',
      mutationSpawned: false,
      terminationVerified: true,
    });
  });

  it('keeps an unverified no-pid launch failure gated until stop is proved', async () => {
    const { job, child, command } = setup();
    child.launch.mockReturnValueOnce({ ...child.process, pid: null });
    job.run(async (activity) => {
      await activity.launch(command);
    });
    await flushJobs();
    child.exit({
      exitCode: null,
      failureCode: 'SPAWN_FAILED',
      termination: 'unconfirmed',
    });
    await job.settled();
    expect(job.snapshot()).toMatchObject({
      mutationSpawned: false,
      terminationVerified: false,
      gateHeld: true,
    });
    await job.retryCleanup();
    expect(job.snapshot()).toMatchObject({
      terminationVerified: true,
      gateHeld: false,
    });
    expect(child.launch).toHaveBeenCalledTimes(1);
  });

  it('retains gate on uncertain process termination and retries cleanup without respawn', async () => {
    const { job, child, command, finalize } = setup();
    const work = jest.fn(async (activity: GlobalJob) => {
      await activity.launch(command);
    });
    job.run(work);
    await flushJobs();
    child.exit({ termination: 'unconfirmed' });
    await job.settled();
    expect(job.snapshot()).toMatchObject({
      status: 'termination_failed',
      failureCode: 'TERMINATION_UNCONFIRMED',
      mutationSpawned: true,
      gateHeld: true,
    });
    await job.retryCleanup();
    expect(child.stop).toHaveBeenCalledTimes(1);
    expect(child.launch).toHaveBeenCalledTimes(1);
    expect(work).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledTimes(2);
    expect(job.snapshot().gateHeld).toBe(false);
  });

  it('fails closed when an in-flight probe cannot prove termination', async () => {
    const { job, child } = setup();
    job.run(async () => {
      await Promise.reject(
        new AppException(409, 'TEST unknown probe', 'CONFLICT', {
          reason: 'TERMINATION_UNCONFIRMED',
        }),
      );
    });
    await job.settled();
    expect(job.snapshot()).toMatchObject({
      terminationVerified: false,
      gateHeld: true,
    });
    expect(child.launch).not.toHaveBeenCalled();
  });

  it('retries only retained probe verification and releases only on explicit proof', async () => {
    const { job, child, deps } = setup();
    const verify = jest
      .fn<Promise<boolean>, []>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    deps.verifyProbeTermination = verify;
    job.run(async () => {
      await Promise.reject(
        new AppException(409, 'TEST unknown probe', 'CONFLICT', {
          reason: 'TERMINATION_UNCONFIRMED',
        }),
      );
    });
    await job.settled();
    await job.retryCleanup();
    expect(job.snapshot().gateHeld).toBe(true);
    await job.retryCleanup();
    expect(job.snapshot()).toMatchObject({
      gateHeld: false,
      terminationVerified: true,
    });
    expect(verify).toHaveBeenCalledTimes(2);
    expect(child.launch).not.toHaveBeenCalled();
  });

  it('stops a live child on cancel and preserves partial mutation facts', async () => {
    const { job, child, command } = setup();
    job.run(async (activity) => {
      await activity.launch(command);
    });
    await flushJobs();
    job.stop('cancel');
    child.exit({ exitCode: null, signal: 'SIGTERM' });
    await job.settled();
    expect(child.stop).toHaveBeenCalledTimes(1);
    expect(job.snapshot()).toMatchObject({
      status: 'cancelled',
      stopReason: 'cancel',
      mutationSpawned: true,
      mayHaveChanged: true,
      terminationVerified: true,
    });
  });

  it('keeps timeout as first reason when exit and cancel race', async () => {
    const { job, child, command, clock } = setup(1000);
    job.run(async (activity) => {
      await activity.launch(command);
    });
    await flushJobs();
    clock.advance(1000);
    child.exit();
    job.stop('cancel');
    await job.settled();
    expect(job.snapshot()).toMatchObject({
      status: 'timed_out',
      stopReason: 'timeout',
    });
  });

  it('keeps gate held on cleanup failure and retries only finalization', async () => {
    const { job, child, command, finalize } = setup();
    finalize.mockRejectedValueOnce(new Error('TEST audit unavailable'));
    job.run(async (activity) => {
      await activity.launch(command);
    });
    await flushJobs();
    child.exit();
    await job.settled();
    expect(job.snapshot().gateHeld).toBe(true);
    await Promise.all([job.retryCleanup(), job.retryCleanup()]);
    expect(child.launch).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledTimes(2);
    expect(job.snapshot().gateHeld).toBe(false);
  });

  it('does not extend mutation time into cleanup and clears deadline on finalization', async () => {
    const { job, child, command, clock, finalize } = setup(1000);
    const cleanup = deferred<void>();
    finalize.mockImplementationOnce(async () => {
      await cleanup.promise;
    });
    job.run(async (activity) => {
      await activity.launch(command);
    });
    await flushJobs();
    child.exit();
    await flushJobs();
    clock.advance(1000);
    expect(job.snapshot().stopReason).toBeNull();
    cleanup.resolve();
    await job.settled();
    expect(clock.timers.size).toBe(0);
  });
});

describe('M7 log delivery through the M6 ring', () => {
  it('preserves split UTF8, sanitizes ANSI/secrets, drains once and detaches snapshots', async () => {
    const { job, child, command } = setup();
    job.run(async (activity) => {
      await activity.launch(command);
    });
    await flushJobs();
    const bytes = Buffer.from('TEST tiếng Việt');
    child.output('stdout', bytes.subarray(0, 7));
    child.output('stdout', bytes.subarray(7));
    child.output('stderr', Buffer.from('\u001b[31m token=TEST-secret\n'));
    child.exit();
    await job.settled();
    const logs = job.logs(0);
    const text = logs.chunks.map((chunk) => chunk.text).join('');
    expect(text).toContain('TEST tiếng Việt');
    expect(text).toContain('[REDACTED]');
    expect(text).not.toContain('TEST-secret');
    expect(text).not.toContain('\u001b');
    logs.chunks.length = 0;
    expect(job.logs(0).chunks.length).toBeGreaterThan(0);
    expect(job.logs(job.snapshot().endCursor).chunks).toEqual([]);
    expect(() => job.logs(-1)).toThrow(AppException);
    expect(() => job.logs(job.snapshot().endCursor + 1)).toThrow(AppException);
  });

  it('bounds retained output and reports cursor loss', async () => {
    const { job, child, command } = setup();
    job.run(async (activity) => {
      await activity.launch(command);
    });
    await flushJobs();
    for (let i = 0; i < 260; i++)
      child.output('stdout', Buffer.from('x'.repeat(8191) + '\n'));
    child.exit();
    await job.settled();
    expect(job.snapshot().droppedBytes).toBeGreaterThan(0);
    const page = job.logs(0);
    expect(page.truncated).toBe(true);
    expect(page.chunks.length).toBeLessThanOrEqual(256);
    expect(
      Buffer.byteLength(page.chunks.map((chunk) => chunk.text).join('')),
    ).toBeLessThanOrEqual(65536);
  });
});
