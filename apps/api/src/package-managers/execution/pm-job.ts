import { AppException } from '@/common/exceptions/app.exception';
import type {
  IPmJob,
  PmReasonCode,
} from '@/package-managers/interfaces/pm.types';
import type { IPmRuntime } from '@/package-managers/interfaces/pm.runtime';

export function pmFailureReason(error: unknown): PmReasonCode {
  const details: unknown =
    error instanceof AppException ? error.details : undefined;
  return details &&
    typeof details === 'object' &&
    'reason' in details &&
    typeof details.reason === 'string'
    ? (details.reason as PmReasonCode)
    : 'INTERNAL_SERVER_ERROR';
}
type StopReason = 'cancel' | 'timeout' | 'shutdown';
type Seed = Pick<
  IPmJob,
  'jobId' | 'requestId' | 'previewId' | 'kind' | 'path' | 'manager' | 'gateHeld'
>;
type Deps = Pick<
  IPmRuntime,
  'now' | 'monotonicNow' | 'setTimer' | 'clearTimer' | 'timeoutMs'
> & {
  finalize(job: IPmJob, retry: boolean): Promise<void>;
};

/** One RAM activity. IO belongs to work; abort never races or abandons its promise. */
export class PmJob {
  private readonly controller = new AbortController();
  private readonly job: IPmJob;
  private readonly acceptedAt: number;
  private stopReason: StopReason | null = null;
  private started = false;
  private completion: Promise<void> = Promise.resolve();
  private finishing: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private workFailure: PmReasonCode | null = null;
  private outcome: Pick<IPmJob, 'status' | 'failureCode'> | null = null;

  constructor(
    seed: Seed,
    private readonly deps: Deps,
  ) {
    this.acceptedAt = deps.monotonicNow();
    this.job = {
      ...seed,
      status: 'running',
      phase: 'preflight',
      startedAt: deps.now().toISOString(),
      finishedAt: null,
      cancelRequested: false,
      mutationStarted: false,
      fileCommitted: false,
      mayHaveChanged: false,
      auditWritten: false,
      refreshRequired: false,
      cleanupRequired: false,
      failureCode: null,
      warnings: [],
      preview: null,
      versions: null,
    };
  }
  get signal(): AbortSignal {
    return this.controller.signal;
  }
  snapshot(): IPmJob {
    return structuredClone(this.job);
  }
  update(patch: Partial<IPmJob>): void {
    Object.assign(this.job, structuredClone(patch));
  }
  checkpoint(): void {
    const timeout = this.deps.timeoutMs;
    if (
      timeout !== undefined &&
      this.deps.monotonicNow() - this.acceptedAt >= timeout
    )
      this.stop('timeout');
    this.signal.throwIfAborted();
  }
  run(work: (job: PmJob) => Promise<void>): void {
    if (this.started)
      throw new AppException(409, 'Activity already started', 'CONFLICT');
    this.started = true;
    this.armDeadline();
    this.completion = this.perform(work);
  }
  stop(reason: StopReason): void {
    if (this.job.phase === 'done') return;
    if (reason === 'cancel') this.job.cancelRequested = true;
    this.stopReason ??= reason;
    this.clearDeadline();
    this.controller.abort();
  }
  settled(): Promise<void> {
    return this.finishing ?? this.completion;
  }
  retryCleanup(): Promise<void> {
    if (this.finishing) return this.finishing;
    if (this.job.phase !== 'done') return this.completion;
    if (!this.job.cleanupRequired && !this.job.gateHeld)
      return Promise.resolve();
    return this.finish(true);
  }
  private async perform(work: (job: PmJob) => Promise<void>): Promise<void> {
    try {
      this.checkpoint();
      await work(this);
    } catch (error) {
      if (!this.signal.aborted) this.workFailure = pmFailureReason(error);
    }
    this.clearDeadline();
    const failure = this.job.failureCode ?? this.workFailure;
    const verified = this.job.fileCommitted && failure === null;
    const stopped = this.stopReason;
    this.outcome = verified
      ? { status: 'completed', failureCode: null }
      : stopped
        ? {
            status: stopped === 'timeout' ? 'timed_out' : 'cancelled',
            failureCode:
              failure ??
              (stopped === 'timeout'
                ? 'TIMED_OUT'
                : stopped === 'shutdown'
                  ? 'SHUTDOWN'
                  : 'CANCELLED'),
          }
        : { status: failure ? 'failed' : 'completed', failureCode: failure };
    await this.finish();
  }
  private finish(retry = false): Promise<void> {
    if (this.finishing) return this.finishing;
    this.job.phase = 'finalizing';
    this.job.finishedAt = null;
    if (this.outcome) Object.assign(this.job, this.outcome);
    const work = Promise.resolve()
      .then(() => this.deps.finalize(this.job, retry))
      .catch(() => {
        this.job.status = 'failed';
        this.job.failureCode = 'INTERNAL_SERVER_ERROR';
        this.job.cleanupRequired = true;
      });
    const finished = work.then(() => {
      this.job.finishedAt = this.deps.now().toISOString();
      this.job.phase = 'done';
      if (this.finishing === finished) this.finishing = null;
    });
    this.finishing = finished;
    return finished;
  }
  private armDeadline(): void {
    const timeout = this.deps.timeoutMs;
    if (timeout === undefined) return;
    const schedule = () => {
      const remaining = timeout - (this.deps.monotonicNow() - this.acceptedAt);
      if (remaining <= 0) {
        this.stop('timeout');
        return;
      }
      this.timer = this.deps.setTimer(
        () => {
          this.timer = null;
          schedule();
        },
        Math.min(remaining, 2 ** 31 - 1),
      );
    };
    schedule();
  }
  private clearDeadline(): void {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
  }
}
