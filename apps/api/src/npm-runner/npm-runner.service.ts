import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import {
  AppException,
  NotFoundException,
  ValidationException,
} from '@/common/exceptions/app.exception';
import type { INpmRunnerService } from '@/npm-runner/interfaces/npm-runner.service.interface';
import { NPM_RUNNER_RUNTIME } from '@/npm-runner/interfaces/npm-runner.runtime';
import type { INpmRunnerRuntime } from '@/npm-runner/interfaces/npm-runner.runtime';
import type {
  IRunJob,
  IRunLogPage,
  IRunRequest,
  IRunStart,
  IRunnerContext,
  IRunnerInput,
  IRunnerInputDeps,
  ITerminalClaimBody,
  ITerminalInputAckBody,
  ITerminalInputBody,
  ITerminalResizeBody,
  ITerminalResizeResult,
  RunFailureCode,
} from '@/npm-runner/interfaces/npm-runner.types';
import { RUN_FAILURE_CODES } from '@/npm-runner/interfaces/npm-runner.types';
import {
  readRunnerInput,
  revalidateRunnerInput,
} from '@/npm-runner/toolchain/runner-input';
import {
  buildRunCommand,
  isRunnerScriptName,
} from '@/npm-runner/execution/runner-command';
import { buildRunnerEnvironment } from '@/npm-runner/toolchain/runner-environment';
import { runnerFailure } from '@/npm-runner/toolchain/runner-tool';
import { createRunLogStore } from '@/npm-runner/execution/runner-logs';
import type { IRunLogStore } from '@/npm-runner/execution/runner-logs';
import type {
  IRunProcess,
  IRunProcessExit,
} from '@/npm-runner/execution/runner-process';
import { TerminalOutputBuffer } from '@/npm-runner/terminal/terminal-buffer';
import type { ITerminalOutputPage } from '@/npm-runner/terminal/terminal-buffer';
import { TerminalControl } from '@/npm-runner/terminal/terminal-control';
import type {
  ITerminalInputAck,
  ITerminalWriter,
  TerminalControlState,
} from '@/npm-runner/terminal/terminal-control';
import {
  assertTerminalIdentity,
  terminalFailure,
} from '@/npm-runner/terminal/terminal-protocol';
import type {
  ITerminalIdentity,
  ITerminalSize,
} from '@/npm-runner/terminal/terminal-protocol';

interface ITerminalSession {
  identity: ITerminalIdentity;
  buffer: TerminalOutputBuffer;
  control: TerminalControl | null;
  ready: boolean;
  knownEndCursor: number;
  writerGeneration: number | null;
  unresolved: { writerGeneration: number; sequence: number } | null;
  controlState: TerminalControlState;
}

interface IActiveRun {
  job: IRunJob;
  request: IRunRequest;
  token: symbol;
  controller: AbortController;
  logs: IRunLogStore;
  terminal: ITerminalSession | null;
  process: IRunProcess | null;
  outcome: IRunProcessExit | null;
  preflight: Promise<void> | null;
  preflightDone: boolean;
  work: Promise<void> | null;
  timer: ReturnType<typeof setTimeout> | null;
  acceptedAt: number;
  runFailure: RunFailureCode | null;
  refreshed: boolean;
  diskCleared: boolean;
  analysisStaled: boolean;
  logsClosed: boolean;
  lastAudit: string | null;
}

const MAX_TIMER_MS = 2 ** 31 - 1;
const auditState = (job: IRunJob): string =>
  JSON.stringify({
    status: job.status,
    exitCode: job.exitCode,
    signal: job.signal,
    spawned: job.spawned,
    terminationVerified: job.terminationVerified,
    mayHaveChanged: job.mayHaveChanged,
    refreshRequired: job.refreshRequired,
  });

@Injectable()
export class NpmRunnerService implements INpmRunnerService, OnModuleDestroy {
  private current: IActiveRun | null = null;
  private closed = false;

  constructor(
    @Inject(NPM_RUNNER_RUNTIME) private readonly runtime: INpmRunnerRuntime,
  ) {}

  async context(path: string): Promise<IRunnerContext> {
    const input = await readRunnerInput(
      path,
      this.runtime.input.getScanSnapshot(),
      this.runtime.input,
    );
    return {
      requestPath: input.requestPath,
      path: input.path,
      scanId: input.scanId,
      inputHash: input.inputHash,
      manager: input.manager,
      version: input.tool?.version ?? null,
      available: input.reason === null && input.tool !== null,
      terminalAvailable:
        this.runtime.input.platform === 'win32' &&
        Boolean(this.runtime.processes) &&
        typeof this.runtime.launchTerminal === 'function',
      reason: input.reason,
      scripts: input.manifest.scripts.map(({ name, command }) => ({
        name,
        command,
        eligible: isRunnerScriptName(name),
      })),
      warnings: [...input.warnings],
    };
  }

  async start(input: IRunRequest): Promise<IRunStart> {
    if (this.closed)
      throw new AppException(
        503,
        'Runner is shutting down',
        'SERVICE_UNAVAILABLE',
      );
    const retained = this.current;
    if (retained?.job.requestId === input.requestId)
      return Promise.resolve(this.startSnapshot(retained.job));
    if (
      retained &&
      (retained.job.gateHeld ||
        retained.job.status === 'running' ||
        retained.job.status === 'stopping')
    ) {
      throw new AppException(
        409,
        'A command run is already active',
        'CONFLICT',
        {
          reason: 'RUNNING',
          jobId: retained.job.jobId,
          requestPath: retained.job.requestPath,
        },
      );
    }
    const readers = this.runtime.readers;
    if (
      readers.hasRunningScan() ||
      readers.hasRunningMeasurement() ||
      readers.hasRunningPreview() ||
      readers.hasRunningAnalysis()
    ) {
      throw new AppException(409, 'A reader is still active', 'CONFLICT', {
        reason: 'READERS_RUNNING',
      });
    }
    if (this.runtime.input.platform !== 'win32' || !this.runtime.processes) {
      throw new AppException(
        503,
        'Runner requires the Windows process adapter',
        'SERVICE_UNAVAILABLE',
      );
    }
    if (
      input.terminal === true &&
      typeof this.runtime.launchTerminal !== 'function'
    ) {
      throw new AppException(
        503,
        'Interactive terminal runner is unavailable',
        'SERVICE_UNAVAILABLE',
      );
    }
    // No await between the reader predicates, gate acquisition and reservation.
    const token = this.runtime.gate.tryEnter();
    if (token === null)
      throw new AppException(409, 'A mutation is already active', 'CONFLICT', {
        reason: 'RUNNING',
      });
    let active: IActiveRun;
    try {
      const started = this.runtime.now();
      const jobId = this.runtime.uuid();
      const terminalIdentity: ITerminalIdentity | null =
        input.terminal === true ? { jobId, generation: 1 } : null;
      const terminal: ITerminalSession | null = terminalIdentity
        ? {
            identity: terminalIdentity,
            buffer: new TerminalOutputBuffer(terminalIdentity),
            control: null,
            ready: false,
            knownEndCursor: 0,
            writerGeneration: null,
            unresolved: null,
            controlState: 'running',
          }
        : null;
      const job: IRunJob = {
        jobId,
        requestId: input.requestId,
        requestPath: input.path,
        path: input.path,
        scanId: '',
        action: input.action,
        manager: 'unknown',
        version: null,
        package: input.package ?? null,
        script: input.script ?? null,
        status: 'running',
        phase: 'preflight',
        startedAt: started.toISOString(),
        finishedAt: null,
        spawned: false,
        exitCode: null,
        signal: null,
        failureCode: null,
        stopReason: null,
        terminationVerified: false,
        mayHaveChanged: false,
        gateHeld: true,
        auditWritten: false,
        refreshRequired: false,
        warningCodes: [],
        firstCursor: 0,
        endCursor: 0,
        droppedBytes: 0,
        ...(terminalIdentity
          ? {
              terminal: {
                mode: 'pty',
                generation: terminalIdentity.generation,
                available: true,
                ready: false,
                firstCursor: 0,
                endCursor: 0,
                droppedBytes: 0,
                writerGeneration: null,
                inputBlocked: false,
              },
            }
          : {}),
      };
      const logs = createRunLogStore({
        jobId,
        clock: {
          now: () => this.runtime.now().getTime(),
          setTimeout: (callback, ms) => this.runtime.setTimer(callback, ms),
          clearTimeout: (timer) =>
            this.runtime.clearTimer(timer as ReturnType<typeof setTimeout>),
        },
      });
      active = {
        job,
        request: { ...input },
        token,
        controller: new AbortController(),
        logs,
        terminal,
        process: null,
        outcome: null,
        preflight: null,
        preflightDone: false,
        work: null,
        timer: null,
        acceptedAt: started.getTime(),
        runFailure: null,
        refreshed: false,
        diskCleared: false,
        analysisStaled: false,
        logsClosed: false,
        lastAudit: null,
      };
      this.current = active;
      this.armDeadline(active);
    } catch (error) {
      this.current = retained;
      this.runtime.gate.leave(token);
      throw error;
    }
    const accepted = this.startSnapshot(active.job);
    active.preflight = this.preflight(active);
    return Promise.resolve(accepted);
  }

  latest(): IRunJob {
    if (!this.current) throw new NotFoundException('Latest command run');
    return this.snapshot(this.current);
  }

  get(id: string): IRunJob {
    return this.snapshot(this.requireRun(id));
  }

  logs(id: string, cursor: number): IRunLogPage {
    const active = this.requireRun(id);
    if (
      !Number.isSafeInteger(cursor) ||
      cursor < 0 ||
      cursor > active.logs.endCursor
    ) {
      throw new ValidationException(
        'Log cursor must be a safe integer within the retained run',
      );
    }
    return active.logs.snapshot(cursor);
  }

  async cancel(id: string): Promise<IRunJob> {
    const active = this.requireRun(id);
    if (!active.job.gateHeld || active.work)
      return Promise.resolve(this.snapshot(active));
    if (active.job.phase === 'done') {
      active.job.status = 'stopping';
      active.job.phase = 'stopping';
      this.queueFinalize(
        active,
        active.job.spawned && !active.job.terminationVerified,
      );
    } else {
      this.requestStop(active, 'cancel');
    }
    return Promise.resolve(this.snapshot(active));
  }

  terminalOutput(
    id: string,
    generation: number,
    cursor: number,
  ): ITerminalOutputPage {
    const active = this.requireRun(id);
    const terminal = active.terminal;
    if (!terminal) terminalFailure(409, 'NOT_INITIALIZED');
    return terminal.buffer.read({ jobId: id, generation }, cursor);
  }

  claimTerminal(id: string, request: ITerminalClaimBody): ITerminalWriter {
    const terminal = this.requireReadyTerminal(id, request);
    const writer = terminal.control!.claim(
      terminal.identity,
      request.tabId,
      request.takeover,
    );
    terminal.writerGeneration = writer.writerGeneration;
    return writer;
  }

  async terminalInput(
    id: string,
    request: ITerminalInputBody,
  ): Promise<ITerminalInputAck> {
    const terminal = this.requireReadyTerminal(id, request);
    const ack = await terminal.control!.input({
      jobId: id,
      generation: request.generation,
      tabId: request.tabId,
      token: request.token,
      writerGeneration: request.writerGeneration,
      sequence: request.sequence,
      text: request.text,
    });
    if (
      (ack.status === 'delivered' || ack.status === 'not_delivered') &&
      terminal.unresolved?.writerGeneration === ack.writerGeneration &&
      terminal.unresolved?.sequence === ack.sequence
    ) {
      terminal.unresolved = null;
    }
    return ack;
  }

  terminalInputAck(
    id: string,
    request: ITerminalInputAckBody,
  ): ITerminalInputAck {
    const active = this.requireRun(id);
    const terminal = active.terminal;
    if (!terminal) terminalFailure(409, 'NOT_INITIALIZED');
    assertTerminalIdentity(
      { jobId: id, generation: request.generation },
      terminal.identity,
    );
    if (request.requestId !== active.job.requestId)
      terminalFailure(409, 'WRONG_JOB');
    if (!terminal.control) terminalFailure(409, 'NOT_INITIALIZED');
    return terminal.control.ack(
      terminal.identity,
      {
        tabId: request.tabId,
        token: request.token,
        writerGeneration: request.writerGeneration,
      },
      request.sequence,
    );
  }

  terminalResize(
    id: string,
    request: ITerminalResizeBody,
  ): ITerminalResizeResult {
    const terminal = this.requireReadyTerminal(id, request);
    terminal.control!.resize({
      jobId: id,
      generation: request.generation,
      tabId: request.tabId,
      token: request.token,
      writerGeneration: request.writerGeneration,
      cols: request.cols,
      rows: request.rows,
    });
    void terminal.control!.flushResize().catch(() => {});
    return { queued: true };
  }

  async onModuleDestroy(): Promise<void> {
    this.closed = true;
    const active = this.current;
    if (!active || !active.job.gateHeld) return;
    if (!active.work) {
      if (active.job.phase === 'done')
        this.queueFinalize(
          active,
          active.job.spawned && !active.job.terminationVerified,
        );
      else this.requestStop(active, 'shutdown');
    }
    let budget: ReturnType<typeof setTimeout> | undefined;
    const completion = async () => {
      await active.preflight;
      await active.work;
    };
    try {
      await Promise.race([
        completion(),
        new Promise<void>((resolve) => {
          budget = this.runtime.setTimer(resolve, 30_000);
        }),
      ]);
    } finally {
      if (budget !== undefined) this.runtime.clearTimer(budget);
    }
  }

  private startSnapshot(job: IRunJob): IRunStart {
    return { jobId: job.jobId, requestId: job.requestId, status: job.status };
  }

  private requireRun(id: string): IActiveRun {
    if (!this.current || this.current.job.jobId !== id)
      throw new NotFoundException('Command run', id);
    return this.current;
  }

  private requireReadyTerminal(
    id: string,
    request: { requestId: string; generation: number },
  ): ITerminalSession {
    const active = this.requireRun(id);
    const terminal = active.terminal;
    if (!terminal) terminalFailure(409, 'NOT_INITIALIZED');
    assertTerminalIdentity(
      { jobId: id, generation: request.generation },
      terminal.identity,
    );
    if (request.requestId !== active.job.requestId)
      terminalFailure(409, 'WRONG_JOB');
    if (active.job.status !== 'running') terminalFailure(409, 'NOT_RUNNING');
    if (!terminal.ready || !terminal.control)
      terminalFailure(409, 'NOT_INITIALIZED');
    return terminal;
  }

  private snapshot(active: IActiveRun): IRunJob {
    this.syncLogs(active);
    this.syncTerminal(active);
    return structuredClone(active.job);
  }

  private syncTerminal(active: IActiveRun): void {
    const terminal = active.terminal;
    if (!terminal || !active.job.terminal) return;
    const page = terminal.buffer.read(
      terminal.identity,
      terminal.knownEndCursor,
    );
    terminal.knownEndCursor = page.endCursor;
    active.job.terminal = {
      mode: 'pty',
      generation: terminal.identity.generation,
      available: true,
      ready: terminal.ready,
      firstCursor: page.firstCursor,
      endCursor: page.endCursor,
      droppedBytes: page.droppedBytes,
      writerGeneration: terminal.writerGeneration,
      inputBlocked:
        terminal.unresolved !== null || terminal.controlState !== 'running',
    };
  }

  private syncLogs(active: IActiveRun): void {
    active.job.firstCursor = active.logs.firstCursor;
    active.job.endCursor = active.logs.endCursor;
    active.job.droppedBytes = active.logs.droppedBytes;
    active.job.warningCodes = [
      ...new Set([...active.job.warningCodes, ...active.logs.warningCodes]),
    ];
  }

  private armDeadline(active: IActiveRun): void {
    const timeout = this.runtime.timeoutMs;
    if (typeof timeout !== 'number' || !Number.isFinite(timeout)) return;
    const schedule = () => {
      const remaining =
        timeout - (this.runtime.now().getTime() - active.acceptedAt);
      if (remaining <= 0) {
        this.requestStop(active, 'timeout');
        return;
      }
      active.timer = this.runtime.setTimer(
        () => {
          active.timer = null;
          if (active.job.phase !== 'done' && active.job.phase !== 'finalizing')
            schedule();
        },
        Math.min(remaining, MAX_TIMER_MS),
      );
    };
    schedule();
  }

  private clearDeadline(active: IActiveRun): void {
    if (active.timer !== null) this.runtime.clearTimer(active.timer);
    active.timer = null;
  }

  private inputMetadata(active: IActiveRun, input: IRunnerInput): void {
    Object.assign(active.job, {
      path: input.path,
      scanId: input.scanId,
      manager: input.manager,
      version: input.tool?.version ?? null,
    });
    active.job.warningCodes = [
      ...new Set([...active.job.warningCodes, ...input.warnings]),
    ];
  }

  private async preflight(active: IActiveRun): Promise<void> {
    const deps: IRunnerInputDeps = {
      ...this.runtime.input,
      signal: active.controller.signal,
    };
    try {
      const scan = deps.getScanSnapshot();
      if (scan) active.job.scanId = scan.scanId;
      const input = await readRunnerInput(active.request.path, scan, deps);
      deps.signal.throwIfAborted();
      this.inputMetadata(active, input);
      if (input.inputHash !== active.request.inputHash)
        throw runnerFailure('INPUT_CHANGED');
      const command = buildRunCommand(input, active.request);
      if (!input.tool) throw runnerFailure('TOOL_NOT_FOUND');
      const env = buildRunnerEnvironment(
        this.runtime.env,
        input.tool,
        command.manager,
        active.request.action,
      );
      try {
        await this.runtime.audit.writeIntent(this.snapshot(active));
      } catch {
        throw runnerFailure('AUDIT_WRITE_FAILED');
      }
      deps.signal.throwIfAborted();
      const revalidated = await revalidateRunnerInput(
        input,
        active.request.inputHash,
        deps,
      );
      deps.signal.throwIfAborted();
      this.inputMetadata(active, revalidated);
      active.job.phase = 'executing';
      try {
        let process: IRunProcess;
        if (active.terminal) {
          if (typeof this.runtime.launchTerminal !== 'function') {
            throw new AppException(
              503,
              'Interactive terminal runner is unavailable',
              'SERVICE_UNAVAILABLE',
            );
          }
          const terminal = active.terminal;
          const initialSize: ITerminalSize = {
            cols: active.request.cols ?? 80,
            rows: active.request.rows ?? 24,
          };
          const terminalProcess = this.runtime.launchTerminal(
            command,
            env,
            {
              signal: deps.signal,
              onOutput: (stream, bytes) => {
                active.job.spawned = active.job.mayHaveChanged = true;
                active.logs.append(stream, bytes);
              },
              onTerminalOutput: (text) => {
                active.job.spawned = active.job.mayHaveChanged = true;
                try {
                  terminal.buffer.append(text);
                } catch {
                  /* Buffer closed or overflowed; ignore without disrupting process. */
                }
              },
              onTerminalAck: (ack) => {
                if (!terminal.control) return;
                if (
                  ack.status !== 'delivered' &&
                  ack.status !== 'not_delivered'
                )
                  return;
                try {
                  terminal.control.reconcile(
                    terminal.identity,
                    ack.writerGeneration,
                    ack.sequence,
                    ack.status,
                  );
                  if (
                    terminal.unresolved?.writerGeneration ===
                      ack.writerGeneration &&
                    terminal.unresolved?.sequence === ack.sequence
                  ) {
                    terminal.unresolved = null;
                  }
                } catch {
                  /* Already reconciled or stale writer. */
                }
              },
              onExit: (result) => this.acceptExit(active, result),
            },
            terminal.identity,
            initialSize,
          );
          process = terminalProcess;
          void terminalProcess.ready.then(
            (ready) => {
              if (
                !ready ||
                active.job.status !== 'running' ||
                active.controller.signal.aborted ||
                active.outcome ||
                active.job.stopReason !== null
              ) {
                return;
              }
              terminal.ready = true;
              terminal.control = new TerminalControl(terminal.identity, {
                now: () => this.runtime.now().getTime(),
                token: () => this.runtime.uuid(),
                write: (frame) => {
                  terminal.unresolved = {
                    writerGeneration: frame.writerGeneration,
                    sequence: frame.sequence,
                  };
                  return terminalProcess.write(frame);
                },
                resize: (size, writerGeneration) =>
                  terminalProcess.resize(size, writerGeneration),
              });
            },
            () => {
              /* Failure handled via process.settled / onExit. */
            },
          );
        } else {
          process = this.runtime.launch(command, env, {
            signal: deps.signal,
            onOutput: (stream, bytes) => {
              active.job.spawned = active.job.mayHaveChanged = true;
              active.logs.append(stream, bytes);
            },
            onExit: (result) => this.acceptExit(active, result),
          });
        }
        active.process = process;
        if (process.pid !== null && process.pid > 0)
          active.job.spawned = active.job.mayHaveChanged = true;
        void process.settled.then(
          (result) => this.acceptExit(active, result),
          () =>
            this.acceptExit(active, {
              exitCode: null,
              signal: null,
              failureCode: active.job.spawned
                ? 'COMMAND_FAILED'
                : 'SPAWN_FAILED',
              termination: active.job.spawned ? 'unconfirmed' : 'verified',
              outputTruncated: true,
            }),
        );
      } catch {
        active.runFailure = 'SPAWN_FAILED';
      }
    } catch (error: unknown) {
      if (!active.job.stopReason) {
        const details: unknown =
          error !== null && typeof error === 'object' && 'details' in error
            ? error.details
            : undefined;
        const reason =
          details !== null && typeof details === 'object' && 'reason' in details
            ? details.reason
            : undefined;
        active.runFailure =
          RUN_FAILURE_CODES.find((code) => code === reason) ??
          'INTERNAL_SERVER_ERROR';
      }
    } finally {
      active.preflightDone = true;
      if (!active.process || active.outcome || active.job.stopReason) {
        this.queueFinalize(
          active,
          active.job.stopReason !== null && active.process !== null,
        );
      }
    }
  }

  private acceptExit(active: IActiveRun, outcome: IRunProcessExit): void {
    if (active.outcome) return;
    active.outcome = outcome;
    active.job.exitCode = outcome.exitCode;
    active.job.signal = outcome.signal;
    if (outcome.failureCode !== 'SPAWN_FAILED')
      active.job.spawned = active.job.mayHaveChanged = true;
    active.job.terminationVerified = outcome.termination === 'verified';
    active.runFailure =
      outcome.failureCode ?? (outcome.exitCode === 0 ? null : 'COMMAND_FAILED');
    if (outcome.outputTruncated)
      active.job.warningCodes.push('OUTPUT_TRUNCATED');
    if (active.terminal) {
      const lost =
        outcome.termination !== 'verified' ||
        (outcome.failureCode === 'COMMAND_FAILED' &&
          outcome.exitCode === null &&
          outcome.signal === null &&
          !active.job.stopReason);
      const nextState: TerminalControlState = lost ? 'worker_lost' : 'terminal';
      active.terminal.controlState = nextState;
      try {
        active.terminal.control?.setState(nextState);
      } catch {
        /* Already transitioned. */
      }
    }
    if (active.preflightDone) this.queueFinalize(active, false);
  }

  private requestStop(
    active: IActiveRun,
    reason: NonNullable<IRunJob['stopReason']>,
  ): void {
    if (
      active.job.phase === 'done' ||
      active.job.phase === 'finalizing' ||
      active.work
    )
      return;
    active.job.stopReason ??= reason;
    active.job.status = 'stopping';
    active.job.phase = 'stopping';
    if (active.terminal) {
      active.terminal.controlState = 'stopping';
      try {
        active.terminal.control?.setState('stopping');
      } catch {
        /* Already transitioned. */
      }
    }
    this.clearDeadline(active);
    active.controller.abort();
    if (active.preflightDone)
      this.queueFinalize(active, active.process !== null);
  }

  private queueFinalize(active: IActiveRun, stop: boolean): void {
    if (active.work || !active.job.gateHeld) return;
    active.work = Promise.resolve()
      .then(() => this.finalize(active, stop))
      .catch(() => {
        // Fail closed; never release an unacknowledged cleanup or expose raw errors.
        active.job.failureCode = 'INTERNAL_SERVER_ERROR';
        active.job.status =
          active.job.spawned && !active.job.terminationVerified
            ? 'termination_failed'
            : 'failed';
        active.job.auditWritten = false;
        active.job.phase = 'done';
        active.job.finishedAt = this.runtime.now().toISOString();
        this.clearDeadline(active);
      })
      .finally(() => {
        active.work = null;
      });
  }

  private classify(active: IActiveRun): void {
    const job = active.job;
    if (job.spawned && !job.terminationVerified) {
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
    } else if (active.runFailure) {
      job.status = 'failed';
      job.failureCode = active.runFailure;
    } else {
      job.status = 'completed';
      job.failureCode = null;
    }
  }

  private async finalize(active: IActiveRun, stop: boolean): Promise<void> {
    const job = active.job;
    job.phase = 'finalizing';
    this.clearDeadline(active);
    if (stop && active.process && !job.terminationVerified) {
      try {
        const verified = await active.process.stop();
        job.terminationVerified = verified === 'verified';
      } catch {
        job.terminationVerified = false;
      }
      if (job.terminationVerified) {
        // Mutations may have continued after an earlier unconfirmed stop.
        active.refreshed = active.diskCleared = active.analysisStaled = false;
      }
    }
    if (!job.spawned) job.terminationVerified = true;
    this.classify(active);
    if (active.terminal) {
      const finalState: TerminalControlState =
        job.status === 'termination_failed' ||
        (active.outcome?.failureCode === 'COMMAND_FAILED' &&
          active.outcome.exitCode === null &&
          active.outcome.signal === null &&
          !job.stopReason)
          ? 'worker_lost'
          : 'terminal';
      active.terminal.controlState = finalState;
      try {
        active.terminal.control?.setState(finalState);
      } catch {
        /* Already transitioned. */
      }
    }
    if (!active.logsClosed) {
      active.logs.flush(true);
      active.terminal?.buffer.finish();
      active.logsClosed = true;
    }
    this.syncLogs(active);
    this.syncTerminal(active);
    if (job.spawned) {
      if (!active.refreshed) {
        try {
          await this.runtime.invalidation.refreshProject(job.path);
          active.refreshed = true;
        } catch {
          /* Retry explicitly. */
        }
      }
      if (!active.diskCleared) {
        try {
          this.runtime.invalidation.clearDiskUsage();
          active.diskCleared = true;
        } catch {
          /* Try the other invalidators. */
        }
      }
      if (!active.analysisStaled) {
        try {
          this.runtime.invalidation.staleAnalysis(job.path);
          active.analysisStaled = true;
        } catch {
          /* Audit the incomplete cleanup. */
        }
      }
    }
    job.refreshRequired =
      job.spawned &&
      !(active.refreshed && active.diskCleared && active.analysisStaled);
    if (job.refreshRequired && job.failureCode === null) {
      job.failureCode = 'CACHE_INVALIDATION_FAILED';
      job.status = 'failed';
    }
    const audit = auditState(job);
    if (!job.auditWritten || active.lastAudit !== audit) {
      job.auditWritten = false;
      try {
        await this.runtime.audit.writeResult(this.snapshot(active));
        job.auditWritten = true;
        active.lastAudit = audit;
      } catch {
        job.failureCode = 'AUDIT_WRITE_FAILED';
        if (job.status === 'completed') job.status = 'failed';
      }
    }
    if (
      (!job.spawned || job.terminationVerified) &&
      !job.refreshRequired &&
      job.auditWritten
    ) {
      this.runtime.gate.leave(active.token);
      job.gateHeld = false;
    }
    job.phase = 'done';
    job.finishedAt = this.runtime.now().toISOString();
  }
}
