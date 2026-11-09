import { PmJob } from '@/package-managers/execution/pm-job';
import {
  deferred,
  pmLifecycleFixture,
  pmUuid,
} from '@/package-managers/__fixtures__/pm-lifecycle.fixture';
import { root } from '@/npm-runner/__fixtures__/runner-test.fixture';

// Expected RED: no class; cancellation/deadline/held IO/postcommit/cleanup retry behavior.
describe('M9 no-child job lifecycle', () => {
  const setup = (timeoutMs?: number) => {
    const f = pmLifecycleFixture();
    const finalize = jest.fn(() => Promise.resolve());
    const job = new PmJob(
      {
        jobId: pmUuid(1),
        requestId: pmUuid(2),
        previewId: null,
        kind: 'mutation',
        path: root,
        manager: 'npm',
        gateHeld: true,
      },
      { ...f.runtime, timeoutMs, finalize },
    );
    return { f, job, finalize };
  };
  it('has no default timer and waits for aborted IO before finalization', async () => {
    const { f, job, finalize } = setup();
    const timer = jest.spyOn(f.runtime, 'setTimer');
    const io = deferred<void>();
    job.run(async (activity) => {
      await io.promise;
      activity.checkpoint();
    });
    job.stop('cancel');
    expect(job.snapshot().cancelRequested).toBe(true);
    expect(finalize).not.toHaveBeenCalled();
    expect(timer).not.toHaveBeenCalled();
    io.resolve();
    await job.settled();
    expect(job.snapshot()).toMatchObject({
      phase: 'done',
      status: 'cancelled',
      failureCode: 'CANCELLED',
    });
  });
  it('keeps first stop reason and segments long deadlines', async () => {
    const { f, job } = setup(2 ** 31 + 100);
    let callback!: () => void;
    const setTimer = jest
      .spyOn(f.runtime, 'setTimer')
      .mockImplementation((fn) => {
        callback = fn;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      });
    // Job dependencies are captured explicitly below, so use a new job for clock assertions.
    const timed = new PmJob(
      { ...job.snapshot() },
      {
        ...f.runtime,
        timeoutMs: 2 ** 31 + 100,
        finalize: () => Promise.resolve(),
      },
    );
    const io = deferred<void>();
    timed.run(async (activity) => {
      await io.promise;
      activity.checkpoint();
    });
    expect(setTimer.mock.calls[0][1]).toBe(2 ** 31 - 1);
    f.advance(2 ** 31 + 100);
    callback();
    timed.stop('cancel');
    io.resolve();
    await timed.settled();
    expect(timed.snapshot()).toMatchObject({
      status: 'timed_out',
      failureCode: 'TIMED_OUT',
      cancelRequested: true,
    });
  });
  it('finishes verified postcommit despite cancel and retries finalization without work', async () => {
    const { job, finalize } = setup();
    const work = jest.fn((activity: PmJob) => {
      activity.stop('cancel');
      activity.update({
        fileCommitted: true,
        mayHaveChanged: true,
        mutationStarted: true,
      });
      return Promise.resolve();
    });
    finalize.mockImplementationOnce(() =>
      Promise.reject(new Error('TEST cleanup')),
    );
    job.run(work);
    await job.settled();
    expect(job.snapshot()).toMatchObject({
      cleanupRequired: true,
      gateHeld: true,
    });
    await job.retryCleanup();
    expect(work).toHaveBeenCalledTimes(1);
    expect(job.snapshot()).toMatchObject({
      status: 'completed',
      fileCommitted: true,
      phase: 'done',
    });
  });
  it('does not relabel ambiguous rename as successful or erase its outcome flags', async () => {
    const { job } = setup();
    job.run((activity) => {
      activity.update({
        mayHaveChanged: true,
        mutationStarted: true,
        failureCode: 'MANIFEST_WRITE_FAILED',
      });
      activity.stop('cancel');
      return Promise.resolve();
    });
    await job.settled();
    expect(job.snapshot()).toMatchObject({
      status: 'cancelled',
      failureCode: 'MANIFEST_WRITE_FAILED',
      mayHaveChanged: true,
      fileCommitted: false,
    });
  });
});
