import type {
  GlobalMutationLaunch,
  IGlobalCommand,
} from '@/global-packages/interfaces/global-packages.runtime';
import type {
  GlobalReasonCode,
  GlobalJobKind,
  IGlobalJob,
  IGlobalLogPage,
  IGlobalPreviewRequest,
} from '@/global-packages/interfaces/global-packages.types';
import { GLOBAL_REASON_CODES } from '@/global-packages/interfaces/global-packages.types';
import type {
  IRunProcess,
  IRunProcessExit,
} from '@/npm-runner/execution/runner-process';
import {
  AppException,
  ValidationException,
} from '@/common/exceptions/app.exception';
import { createRunLogStore } from '@/npm-runner/execution/runner-logs';
import type { IRunLogStore } from '@/npm-runner/execution/runner-logs';

export interface IGlobalJobSeed {
  jobId: string;
  requestId: string;
  kind: GlobalJobKind;
  previewId?: string;
  request?: IGlobalPreviewRequest;
  gateHeld: boolean;
}

export interface IGlobalJobDeps {
  now(): Date;
  monotonicNow(): number;
  timeoutMs: number | undefined;
  setTimer(callback: () => void, milliseconds: number): unknown;
  clearTimer(handle: unknown): void;
  launch: GlobalMutationLaunch;
  finalize(job: IGlobalJob): Promise<void>;
  verifyProbeTermination?(): Promise<boolean>;
}

export class GlobalJob {
  private readonly controller = new AbortController();
  private readonly job: IGlobalJob;
  private readonly logStore: IRunLogStore;
  private readonly acceptedAt: number;
  private process: IRunProcess | null = null;
  private outcome: IRunProcessExit | null = null;
  private completion: Promise<void> = Promise.resolve();
  private finishing: Promise<void> | null = null;
  private stopping: Promise<void> | null = null;
  private timer: unknown = null;
  private started = false;
  private launched = false;
  private logsClosed = false;
  private probeUncertain = false;
  private stopVerified = false;
  private failure: GlobalReasonCode | null = null;

  constructor(
    seed: IGlobalJobSeed,
    private readonly deps: IGlobalJobDeps,
  ) {
    this.acceptedAt = deps.monotonicNow();
    this.job = {
      jobId: seed.jobId,
      requestId: seed.requestId,
      previewId: seed.previewId ?? null,
      kind: seed.kind,
      manager: seed.request?.manager ?? null,
      managerVersion: null,
      action: seed.request?.action ?? null,
      package: seed.request?.package ?? null,
      currentVersion: null,
      targetVersion: null,
      status: 'running',
      phase: 'preflight',
      startedAt: deps.now().toISOString(),
      finishedAt: null,
      mutationSpawned: false,
      mayHaveChanged: false,
      exitCode: null,
      signal: null,
      stopReason: null,
      terminationVerified: false,
      gateHeld: seed.gateHeld,
      auditWritten: false,
      refreshRequired: false,
      failureCode: null,
      warningCodes: [],
      firstCursor: 0,
      endCursor: 0,
      droppedBytes: 0,
      preview: null,
      versions: null,
    };
    this.logStore = createRunLogStore({
      jobId: seed.jobId,
      clock: {
        now: () => deps.now().getTime(),
        setTimeout: (callback, ms) => deps.setTimer(callback, ms),
        clearTimeout: (handle) => deps.clearTimer(handle),
      },
    });
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  snapshot(): IGlobalJob {
    this.syncLogs();
    return structuredClone(this.job);
  }

  update(patch: Partial<IGlobalJob>): void {
    Object.assign(this.job, structuredClone(patch));
  }

  logs(cursor: number): IGlobalLogPage {
    if (
      !Number.isSafeInteger(cursor) ||
      cursor < 0 ||
      cursor > this.logStore.endCursor
    )
      throw new ValidationException(
        'Log cursor must be within the retained global job',
      );
    return this.logStore.snapshot(cursor);
  }

  run(work: (job: GlobalJob) => Promise<void>): void {
    if (this.started)
      throw new AppException(409, 'Global job already started', 'CONFLICT');
    this.started = true;
    this.armDeadline();
    this.completion = this.performWork(work);
  }

  checkpoint(): void {
    this.signal.throwIfAborted();
  }

  noteProbeUncertain(): void {
    this.probeUncertain = true;
    this.job.terminationVerified = false;
  }

  async launch(command: IGlobalCommand): Promise<IRunProcessExit> {
    this.checkpoint();
    if (this.launched)
      throw new AppException(
        409,
        'Global mutation already launched',
        'CONFLICT',
      );
    this.launched = true;
    this.job.phase = 'executing';
    let publish!: (outcome: IRunProcessExit) => void;
    const exited = new Promise<IRunProcessExit>((resolve) => {
      publish = resolve;
    });
    const accept = (outcome: IRunProcessExit): void => {
      if (this.outcome) return;
      this.outcome = outcome;
      this.job.exitCode = outcome.exitCode;
      this.job.signal = outcome.signal;
      if (outcome.failureCode !== 'SPAWN_FAILED')
        this.job.mutationSpawned = this.job.mayHaveChanged = true;
      this.job.terminationVerified =
        this.stopVerified || outcome.termination === 'verified';
      this.failure =
        outcome.failureCode ??
        (outcome.exitCode === 0 ? null : 'COMMAND_FAILED');
      if (outcome.outputTruncated)
        this.job.warningCodes.push('OUTPUT_TRUNCATED');
      publish(outcome);
    };
    try {
      this.process = this.deps.launch(command, {
        signal: this.signal,
        onOutput: (stream, bytes) => {
          this.job.mutationSpawned = this.job.mayHaveChanged = true;
          this.logStore.append(stream, bytes);
        },
        onExit: accept,
      });
      if (this.process.pid !== null && this.process.pid > 0)
        this.job.mutationSpawned = this.job.mayHaveChanged = true;
      void this.process.settled.then(accept, () =>
        accept({
          exitCode: null,
          signal: null,
          failureCode: this.job.mutationSpawned
            ? 'COMMAND_FAILED'
            : 'SPAWN_FAILED',
          termination: this.job.mutationSpawned ? 'unconfirmed' : 'verified',
          outputTruncated: true,
        }),
      );
      if (this.signal.aborted) this.startStop();
    } catch {
      accept({
        exitCode: null,
        signal: null,
        failureCode: 'SPAWN_FAILED',
        termination: 'verified',
        outputTruncated: false,
      });
    }
    const outcome = await exited;
    if (this.stopping) await this.stopping;
    return outcome;
  }

  stop(reason: NonNullable<IGlobalJob['stopReason']>): void {
    if (this.job.phase === 'done' || this.job.phase === 'finalizing') return;
    this.job.stopReason ??= reason;
    this.job.status = 'stopping';
    this.job.phase = 'stopping';
    this.clearDeadline();
    this.controller.abort();
    this.startStop();
  }

  settled(): Promise<void> {
    return this.finishing ?? this.completion;
  }

  retryCleanup(): Promise<void> {
    if (this.finishing) return this.finishing;
    if (this.job.phase !== 'done') return this.completion;
    if (!this.job.gateHeld && !this.probeUncertain && this.job.auditWritten)
      return Promise.resolve();
    return this.finish(true);
  }

  private syncLogs(): void {
    Object.assign(this.job, {
      firstCursor: this.logStore.firstCursor,
      endCursor: this.logStore.endCursor,
      droppedBytes: this.logStore.droppedBytes,
      warningCodes: [
        ...new Set([...this.job.warningCodes, ...this.logStore.warningCodes]),
      ],
    });
  }

  private async performWork(
    work: (job: GlobalJob) => Promise<void>,
  ): Promise<void> {
    try {
      this.checkpoint();
      await work(this);
    } catch (error) {
      const details = error instanceof AppException ? error.details : undefined;
      const reason: unknown =
        details && typeof details === 'object' && 'reason' in details
          ? details.reason
          : undefined;
      if (reason === 'TERMINATION_UNCONFIRMED') this.probeUncertain = true;
      if (!this.job.stopReason)
        this.failure =
          GLOBAL_REASON_CODES.find((code) => code === reason) ??
          'INTERNAL_SERVER_ERROR';
    } finally {
      await this.finish(false);
    }
  }

  private startStop(): void {
    if (!this.process || this.stopping || this.job.terminationVerified) return;
    const process = this.process;
    this.stopping = Promise.resolve()
      .then(() => process.stop())
      .then(
        (outcome) => {
          this.stopVerified = outcome === 'verified';
          this.job.terminationVerified = this.stopVerified;
        },
        () => {
          this.stopVerified = this.job.terminationVerified = false;
        },
      );
  }

  private finish(retry: boolean): Promise<void> {
    if (this.finishing) return this.finishing;
    const task = Promise.resolve()
      .then(() => this.finalize(retry))
      .catch(() => {
        // Finalization failure cannot retry work or release uncertain ownership.
        this.job.auditWritten = false;
        this.job.status = this.job.terminationVerified
          ? 'failed'
          : 'termination_failed';
        this.job.failureCode = 'INTERNAL_SERVER_ERROR';
      });
    const completed: Promise<void> = task.then(() => {
      // A visible terminal job must admit a new cleanup attempt immediately.
      // Publish both fields in one turn; returning the prior task would lose retry.
      if (this.finishing === completed) this.finishing = null;
      this.job.phase = 'done';
    });
    this.finishing = completed;
    return completed;
  }

  private async finalize(retry: boolean): Promise<void> {
    const job = this.job;
    job.phase = 'finalizing';
    this.clearDeadline();
    if (retry && this.process && !job.terminationVerified) {
      this.stopping = null;
      this.startStop();
    }
    if (this.stopping) await this.stopping;
    if (retry && this.probeUncertain && this.deps.verifyProbeTermination) {
      try {
        if (await this.deps.verifyProbeTermination())
          this.probeUncertain = false;
      } catch {
        /* Uncertainty retains ownership. */
      }
    }
    if (this.probeUncertain) job.terminationVerified = false;
    else if (
      (!job.mutationSpawned && this.outcome === null) ||
      this.stopVerified ||
      this.outcome?.termination === 'verified'
    )
      job.terminationVerified = true;
    if (!job.terminationVerified) {
      job.status = 'termination_failed';
      job.failureCode = 'TERMINATION_UNCONFIRMED';
    } else if (job.stopReason) {
      job.status = job.stopReason === 'timeout' ? 'timed_out' : 'cancelled';
      job.failureCode =
        job.stopReason === 'timeout'
          ? 'TIMED_OUT'
          : job.stopReason === 'shutdown'
            ? 'SHUTDOWN'
            : 'CANCELLED';
    } else {
      job.status = this.failure ? 'failed' : 'completed';
      job.failureCode = this.failure;
    }
    if (!this.logsClosed) {
      this.logStore.flush(true);
      this.logsClosed = true;
    }
    this.syncLogs();
    try {
      await this.deps.finalize(job);
    } catch {
      job.auditWritten = false;
      job.status = job.terminationVerified ? 'failed' : 'termination_failed';
      job.failureCode = 'INTERNAL_SERVER_ERROR';
    }
    job.finishedAt = this.deps.now().toISOString();
  }

  private armDeadline(): void {
    const timeout = this.deps.timeoutMs;
    if (typeof timeout !== 'number' || !Number.isFinite(timeout)) return;
    const schedule = (): void => {
      const remaining = timeout - (this.deps.monotonicNow() - this.acceptedAt);
      if (remaining <= 0) {
        this.stop('timeout');
        return;
      }
      this.timer = this.deps.setTimer(
        () => {
          this.timer = null;
          if (this.job.phase !== 'done' && this.job.phase !== 'finalizing')
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
