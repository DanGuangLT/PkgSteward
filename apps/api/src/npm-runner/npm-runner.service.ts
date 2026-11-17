import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  AppException,
  NotFoundException,
  ValidationException,
} from '@/common/exceptions/app.exception';
import type { INpmRunnerService } from '@/npm-runner/interfaces/npm-runner.service.interface';
import { NPM_RUNNER_RUNTIME } from '@/npm-runner/interfaces/npm-runner.runtime';
import type { INpmRunnerRuntime } from '@/npm-runner/interfaces/npm-runner.runtime';
import type {
  IRecoveryClearRequest,
  IRecoveryClearResult,
  IRunJob,
  IRunLogPage,
  IRunRecoveryHold,
  IRunRequest,
  IRunStart,
  IRunnerContext,
  IRunnerInput,
  IRunnerInputDeps,
  NativeSessionPhase,
  RunFailureCode,
  RunLatestResult,
} from '@/npm-runner/interfaces/npm-runner.types';
import { RUN_FAILURE_CODES } from '@/npm-runner/interfaces/npm-runner.types';
import { toComparable } from '@/common/utils/path.util';
import {
  readRunnerInput,
  revalidateRunnerInput,
} from '@/npm-runner/toolchain/runner-input';
import {
  buildRunCommand,
  isRunnerScriptName,
} from '@/npm-runner/execution/runner-command';
import {
  buildInteractiveShellEnv,
  buildRunnerEnvironment,
} from '@/npm-runner/toolchain/runner-environment';
import { runnerFailure } from '@/npm-runner/toolchain/runner-tool';
import { createRunLogStore } from '@/npm-runner/execution/runner-logs';
import type { IRunLogStore } from '@/npm-runner/execution/runner-logs';
import type {
  IRunProcess,
  IRunProcessExit,
} from '@/npm-runner/execution/runner-process';
import type { INativeExitOutcome } from '@/npm-runner/native-session/native-console-supervisor';
import type { INativeInitCommand } from '@/npm-runner/native-session/native-protocol';
import type {
  INativeSession,
  INativeSessionResult,
  INativeSessionSnapshot,
  NativeSessionPhase as InternalNativePhase,
} from '@/npm-runner/native-session/native-session';

interface IActiveRun {
  job: IRunJob;
  request: IRunRequest;
  fingerprint: string;
  token: symbol;
  controller: AbortController;
  logs: IRunLogStore;
  useNative: boolean;
  native: INativeSession | null;
  nativeLaunched: boolean;
  nativeResult: INativeSessionResult | null;
  initialOutcome: INativeExitOutcome | null;
  observedShellOpen: boolean;
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
const NATIVE_PHASE_RANK: Readonly<Record<NativeSessionPhase, number>> = {
  starting: 0,
  initial_running: 1,
  initial_finished: 2,
  shell_open: 3,
  stopping: 4,
  closed: 5,
  lost: 5,
};
const mapNativePhase = (phase: InternalNativePhase): NativeSessionPhase => {
  switch (phase) {
    case 'launching':
    case 'supervisor_ready':
    case 'bridge_starting':
    case 'bridge_ready':
      return 'starting';
    case 'initial_running':
      return 'initial_running';
    case 'initial_finished':
    case 'shell_starting':
      return 'initial_finished';
    case 'shell_running':
      return 'shell_open';
    case 'stopping':
      return 'stopping';
    case 'closed':
      return 'closed';
    case 'lost':
      return 'lost';
  }
};
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
export class NpmRunnerService
  implements INpmRunnerService, OnModuleInit, OnModuleDestroy
{
  private current: IActiveRun | null = null;
  private closed = false;
  private recoveryHold: IRunRecoveryHold | null = null;
  private recoveryHoldToken: symbol | null = null;
  private recoveryReady: boolean;
  private clearingRecoveryInFlight = false;

  constructor(
    @Inject(NPM_RUNNER_RUNTIME) private readonly runtime: INpmRunnerRuntime,
  ) {
    this.recoveryReady = this.runtime.recovery === undefined;
  }

  async onModuleInit(): Promise<void> {
    if (!this.runtime.recovery) {
      this.recoveryReady = true;
      return;
    }
    let gateAcquisitionFailed = false;
    try {
      const startup = await this.runtime.recovery.evaluateOnStartup();
      if (startup.active) {
        this.recoveryHold = startup.hold
          ? { ...startup.hold }
          : {
              active: true,
              reason: startup.reason ?? 'UNRESOLVED_NATIVE_SESSION',
              journalPath:
                startup.journalPath ?? this.runtime.recovery.journalPath,
            };
        if (!this.recoveryHoldToken) {
          const token = this.runtime.gate.tryEnter();
          if (!token) {
            gateAcquisitionFailed = true;
            throw new AppException(
              500,
              'Failed to acquire startup recovery hold gate',
              'INTERNAL_SERVER_ERROR',
            );
          }
          this.recoveryHoldToken = token;
        }
      } else {
        this.recoveryHold = null;
      }
    } catch (error) {
      if (!this.recoveryHold) {
        this.recoveryHold = {
          active: true,
          reason: 'CORRUPT_OR_PARTIAL_JOURNAL',
          journalPath: this.runtime.recovery.journalPath,
        };
      }
      if (!this.recoveryHoldToken) {
        const token = this.runtime.gate.tryEnter();
        if (!token) {
          gateAcquisitionFailed = true;
          if (error instanceof AppException) throw error;
          throw new AppException(
            500,
            'Failed to acquire startup recovery hold gate',
            'INTERNAL_SERVER_ERROR',
          );
        }
        this.recoveryHoldToken = token;
      }
      if (error instanceof AppException) throw error;
    } finally {
      if (!gateAcquisitionFailed) {
        this.recoveryReady = true;
      }
    }
  }

  async context(path: string): Promise<IRunnerContext> {
    const [input, nativeConsoleAvailable] = await Promise.all([
      readRunnerInput(
        path,
        this.runtime.input.getScanSnapshot(),
        this.runtime.input,
      ),
      this.runtime.native
        ? this.runtime.native.capability()
        : Promise.resolve(false),
    ]);
    return {
      requestPath: input.requestPath,
      path: input.path,
      scanId: input.scanId,
      inputHash: input.inputHash,
      manager: input.manager,
      version: input.tool?.version ?? null,
      available: input.reason === null && input.tool !== null,
      nativeConsoleAvailable,
      recoveryHold: this.recoveryHold ? { ...this.recoveryHold } : null,
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
    if (!this.recoveryReady || this.recoveryHold?.active) {
      const hold: IRunRecoveryHold = this.recoveryHold
        ? { ...this.recoveryHold }
        : {
            active: true,
            reason: 'RECOVERY_LOADING',
            journalPath: this.runtime.recovery?.journalPath ?? '',
          };
      throw new AppException(
        409,
        'Native terminal recovery hold is active',
        'CONFLICT',
        {
          reason: 'RECOVERY_HOLD',
          recoveryHold: hold,
        },
      );
    }
    const retained = this.current;
    const consoleShell =
      input.consoleShell === undefined ? 'cmd' : input.consoleShell;
    if (consoleShell !== 'cmd' && consoleShell !== 'powershell')
      throw new ValidationException('consoleShell must be cmd or powershell');
    // Synchronous lexical comparison only; allowlist/realpath validation stays in preflight.
    const fingerprint = JSON.stringify([
      toComparable(input.path, this.runtime.input.platform),
      input.action,
      input.package ?? null,
      input.script ?? null,
      input.inputHash,
      consoleShell,
    ]);
    if (retained?.job.requestId === input.requestId) {
      if (retained.fingerprint !== fingerprint)
        throw new AppException(
          409,
          'Request ID was used with different input',
          'CONFLICT',
          {
            reason: 'REQUEST_MISMATCH',
            jobId: retained.job.jobId,
          },
        );
      return Promise.resolve(this.startSnapshot(retained.job));
    }
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
      const useNative = this.runtime.native !== undefined;
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
        ...(useNative
          ? {
              nativeSession: {
                shell: consoleShell,
                generation: 1,
                phase: 'starting' as const,
                available: true,
                sessionResult: null,
              },
              initialCommand: null,
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
        request: { ...input, consoleShell },
        fingerprint,
        token,
        controller: new AbortController(),
        logs,
        useNative,
        native: null,
        nativeLaunched: false,
        nativeResult: null,
        initialOutcome: null,
        observedShellOpen: false,
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
      if (!useNative) this.armDeadline(active);
    } catch (error) {
      this.current = retained;
      this.runtime.gate.leave(token);
      throw error;
    }
    const accepted = this.startSnapshot(active.job);
    active.preflight = this.preflight(active);
    return Promise.resolve(accepted);
  }

  latest(): RunLatestResult {
    if (this.current) return this.snapshot(this.current);
    if (this.recoveryHold?.active) {
      return { recoveryHold: { ...this.recoveryHold }, job: null };
    }
    throw new NotFoundException('Latest command run');
  }

  async clearRecovery(
    body: IRecoveryClearRequest,
  ): Promise<IRecoveryClearResult> {
    if (this.closed)
      throw new AppException(
        503,
        'Runner is shutting down',
        'SERVICE_UNAVAILABLE',
      );
    if (body.confirm !== true)
      throw new ValidationException('confirm must be true');
    if (
      this.current &&
      (this.current.job.status === 'running' ||
        this.current.job.status === 'stopping' ||
        (this.current.job.gateHeld &&
          this.current.token !== this.recoveryHoldToken))
    ) {
      throw new AppException(
        409,
        'A command run is already active',
        'CONFLICT',
        {
          reason: 'RUNNING',
          jobId: this.current.job.jobId,
          requestPath: this.current.job.requestPath,
        },
      );
    }
    if (this.clearingRecoveryInFlight) {
      throw new AppException(
        409,
        'Recovery clear is already in progress',
        'CONFLICT',
        {
          reason: 'RECOVERY_HOLD',
          recoveryHold: this.recoveryHold
            ? { ...this.recoveryHold }
            : {
                active: true,
                reason: 'UNRESOLVED_NATIVE_SESSION',
                journalPath: this.runtime.recovery?.journalPath ?? '',
              },
        },
      );
    }
    const hold = this.recoveryHold;
    if (!hold?.active || !this.runtime.recovery) {
      return { cleared: false, recoveryHold: null };
    }
    this.clearingRecoveryInFlight = true;
    try {
      if (
        !this.runtime.audit.writeRecoveryIntent ||
        !this.runtime.audit.writeRecoveryResult
      ) {
        throw runnerFailure('AUDIT_WRITE_FAILED');
      }
      const operationId = this.runtime.uuid();
      try {
        await this.runtime.audit.writeRecoveryIntent(operationId, hold);
      } catch {
        throw runnerFailure('AUDIT_WRITE_FAILED');
      }
      const check = await this.runtime.recovery.verifyClearable();
      if (!check.clearable) {
        try {
          await this.runtime.audit.writeRecoveryResult(
            operationId,
            hold,
            'blocked',
            'RECOVERY_HOLD',
          );
        } catch {
          /* keep primary RECOVERY_HOLD conflict */
        }
        throw new AppException(
          409,
          'Native console processes may still be active; close them before clearing recovery hold',
          'CONFLICT',
          {
            reason: 'RECOVERY_HOLD',
            recoveryHold: { ...hold },
          },
        );
      }
      try {
        this.runtime.invalidation.clearDiskUsage();
        if (this.runtime.invalidation.staleAllAnalyses) {
          this.runtime.invalidation.staleAllAnalyses();
        } else if (this.current) {
          this.runtime.invalidation.staleAnalysis(this.current.job.path);
        }
      } catch {
        try {
          await this.runtime.audit.writeRecoveryResult(
            operationId,
            hold,
            'failed',
            'CACHE_INVALIDATION_FAILED',
          );
        } catch {
          /* preserve CACHE_INVALIDATION_FAILED */
        }
        throw runnerFailure('CACHE_INVALIDATION_FAILED');
      }
      try {
        await this.runtime.audit.writeRecoveryResult(
          operationId,
          hold,
          'cleared',
          null,
        );
      } catch {
        throw runnerFailure('AUDIT_WRITE_FAILED');
      }
      try {
        await this.runtime.recovery.removeMarkers();
      } catch {
        this.recoveryHold = {
          active: true,
          reason: 'JOURNAL_REMOVAL_FAILED',
          journalPath: this.runtime.recovery.journalPath,
        };
        throw new AppException(
          500,
          'Failed to remove native recovery journal marker',
          'INTERNAL_SERVER_ERROR',
        );
      }
      const token = this.recoveryHoldToken;
      this.recoveryHold = null;
      this.recoveryHoldToken = null;
      if (token) this.runtime.gate.leave(token);
      if (this.current && this.current.token === token) {
        this.current.job.gateHeld = false;
        this.current.job.recoveryHold = null;
      }
      return { cleared: true, recoveryHold: null };
    } finally {
      this.clearingRecoveryInFlight = false;
    }
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
    if (
      !active.job.gateHeld ||
      active.work ||
      this.recoveryHold?.active ||
      active.token === this.recoveryHoldToken ||
      active.job.failureCode === 'RECOVERY_HOLD'
    )
      return Promise.resolve(this.snapshot(active));
    if (active.job.phase === 'done') {
      active.job.status = 'stopping';
      active.job.phase = 'stopping';
      this.queueFinalize(
        active,
        (active.useNative ? active.nativeLaunched : active.job.spawned) &&
          !active.job.terminationVerified,
      );
    } else {
      this.requestStop(active, 'cancel');
    }
    return Promise.resolve(this.snapshot(active));
  }

  async onModuleDestroy(): Promise<void> {
    this.closed = true;
    const active = this.current;
    if (!active || !active.job.gateHeld) return;
    if (!active.work) {
      if (
        this.recoveryHold?.active ||
        active.token === this.recoveryHoldToken ||
        active.job.failureCode === 'RECOVERY_HOLD'
      ) {
        return;
      }
      if (active.job.phase === 'done')
        this.queueFinalize(
          active,
          (active.useNative ? active.nativeLaunched : active.job.spawned) &&
            !active.job.terminationVerified,
        );
      else this.requestStop(active, 'shutdown');
    }
    let budget: ReturnType<typeof setTimeout> | undefined;
    const completion = async () => {
      await active.preflight;
      await active.native?.settled;
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

  private snapshot(active: IActiveRun): IRunJob {
    this.syncLogs(active);
    if (
      active.useNative ||
      this.recoveryHold !== null ||
      this.runtime.recovery !== undefined
    ) {
      active.job.recoveryHold = this.recoveryHold
        ? { ...this.recoveryHold }
        : null;
    }
    return structuredClone(active.job);
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

  private extractFailureCode(error: unknown): RunFailureCode {
    const details: unknown =
      error !== null && typeof error === 'object' && 'details' in error
        ? error.details
        : undefined;
    const reason =
      details !== null && typeof details === 'object' && 'reason' in details
        ? details.reason
        : undefined;
    return (
      RUN_FAILURE_CODES.find((code) => code === reason) ??
      'INTERNAL_SERVER_ERROR'
    );
  }

  private async preflightNative(
    active: IActiveRun,
    deps: IRunnerInputDeps,
    command: ReturnType<typeof buildRunCommand>,
    env: NodeJS.ProcessEnv,
    initialInput: IRunnerInput,
  ): Promise<void> {
    const native = this.runtime.native!;
    const shell = active.request.consoleShell ?? 'cmd';
    const nativePreflight = await native.preflight(shell);
    deps.signal.throwIfAborted();
    if (nativePreflight.status !== 'ok') {
      if (active.job.nativeSession) active.job.nativeSession.available = false;
      throw runnerFailure('NATIVE_CONSOLE_UNAVAILABLE');
    }
    const shellEnv = buildInteractiveShellEnv(this.runtime.env);
    let currentInput = await revalidateRunnerInput(
      initialInput,
      active.request.inputHash,
      deps,
    );
    deps.signal.throwIfAborted();
    this.inputMetadata(active, currentInput);
    const init: INativeInitCommand = {
      jobId: active.job.jobId,
      generation: 1,
      type: 'init',
      initialFile: command.file,
      initialArgs: [...command.args],
      cwd: currentInput.path,
      env,
      shell: nativePreflight.value.shell,
      shellFile: nativePreflight.value.shellFile,
      shellArgs: [...nativePreflight.value.shellArgs],
      shellEnv,
    };
    const session = native.createSession({
      identity: { jobId: active.job.jobId, generation: 1 },
      fingerprint: active.fingerprint,
      preflight: nativePreflight.value,
      init,
      initialTimeoutMs: this.runtime.timeoutMs,
      writeIntent: async () => {
        try {
          await this.runtime.audit.writeIntent(this.snapshot(active));
        } catch {
          active.runFailure ??= 'AUDIT_WRITE_FAILED';
          throw runnerFailure('AUDIT_WRITE_FAILED');
        }
      },
      beforeInit: async () => {
        try {
          deps.signal.throwIfAborted();
          const latest = await revalidateRunnerInput(
            currentInput,
            active.request.inputHash,
            deps,
          );
          deps.signal.throwIfAborted();
          this.inputMetadata(active, latest);
          currentInput = latest;
        } catch (error: unknown) {
          if (!active.job.stopReason && !active.runFailure)
            active.runFailure = this.extractFailureCode(error);
          throw error;
        }
      },
      callbacks: {
        onState: (snap) => this.acceptNativeState(active, snap),
        onInitSent: () => {
          active.job.mayHaveChanged = true;
        },
        onInitialSpawned: () => {
          active.job.spawned = true;
          active.job.mayHaveChanged = true;
        },
        onInitialOutcome: (outcome) =>
          this.acceptNativeInitialOutcome(active, outcome),
        onSettled: (result) => this.acceptNativeSettled(active, result),
      },
    });
    active.native = session;
    active.job.phase = active.job.stopReason ? 'stopping' : 'executing';
    void session.settled.then(
      (result) => this.acceptNativeSettled(active, result),
      () =>
        this.acceptNativeSettled(active, {
          phase: 'lost',
          termination: 'start_failed',
          initialOutcome: active.initialOutcome,
          sessionOutcome: null,
          cleanupVerified: false,
        }),
    );
    if (active.job.stopReason !== null || deps.signal.aborted) {
      const stopReason =
        active.job.stopReason === 'shutdown'
          ? 'parent_exit'
          : active.job.stopReason === 'timeout'
            ? 'initial_timeout'
            : 'user_stop';
      void session.stop(stopReason);
    } else {
      active.nativeLaunched = true;
      void session.start();
    }
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
      if (active.useNative) {
        await this.preflightNative(active, deps, command, env, input);
        return;
      }
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
        const process: IRunProcess = this.runtime.launch(command, env, {
          signal: deps.signal,
          onOutput: (stream, bytes) => {
            active.job.spawned = active.job.mayHaveChanged = true;
            active.logs.append(stream, bytes);
          },
          onExit: (result) => this.acceptExit(active, result),
        });
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
        active.runFailure = this.extractFailureCode(error);
      }
    } finally {
      active.preflightDone = true;
      if (active.useNative) {
        if (
          (!active.native || active.nativeResult) &&
          !active.work &&
          (active.nativeResult ||
            active.runFailure !== null ||
            active.job.stopReason !== null)
        ) {
          this.queueFinalize(active, false);
        }
      } else if (!active.process || active.outcome || active.job.stopReason) {
        this.queueFinalize(
          active,
          active.job.stopReason !== null && active.process !== null,
        );
      }
    }
  }

  private acceptNativeState(
    active: IActiveRun,
    snap: INativeSessionSnapshot,
  ): void {
    if (snap.phase === 'shell_running') active.observedShellOpen = true;
    if (snap.identities.initial) {
      active.job.spawned = true;
      active.job.mayHaveChanged = true;
    }
    if (snap.initialOutcome) {
      active.initialOutcome = { ...snap.initialOutcome };
      active.job.initialCommand = { ...snap.initialOutcome };
      active.job.exitCode = snap.initialOutcome.exitCode;
      active.job.signal = snap.initialOutcome.signal;
    }
    if (active.job.nativeSession && !active.nativeResult) {
      const nextPhase = mapNativePhase(snap.phase);
      const currentPhase = active.job.nativeSession.phase;
      if (
        NATIVE_PHASE_RANK[nextPhase] > NATIVE_PHASE_RANK[currentPhase] &&
        (!active.job.stopReason || NATIVE_PHASE_RANK[nextPhase] >= 4)
      ) {
        active.job.nativeSession.phase = nextPhase;
      }
      if (snap.sessionOutcome)
        active.job.nativeSession.sessionResult = { ...snap.sessionOutcome };
    }
  }

  private acceptNativeInitialOutcome(
    active: IActiveRun,
    outcome: INativeExitOutcome,
  ): void {
    active.initialOutcome = { ...outcome };
    active.job.initialCommand = { ...outcome };
    active.job.exitCode = outcome.exitCode;
    active.job.signal = outcome.signal;
    if (
      active.job.nativeSession &&
      !active.nativeResult &&
      (active.job.nativeSession.phase === 'starting' ||
        active.job.nativeSession.phase === 'initial_running')
    ) {
      active.job.nativeSession.phase = 'initial_finished';
    }
    if (outcome.exitCode !== 0 || outcome.signal !== null)
      active.runFailure ??= 'COMMAND_FAILED';
  }

  private acceptNativeSettled(
    active: IActiveRun,
    result: INativeSessionResult,
  ): void {
    if (active.nativeResult) return;
    active.nativeResult = result;
    const job = active.job;
    if (result.initialOutcome) {
      active.initialOutcome = { ...result.initialOutcome };
      job.initialCommand = { ...result.initialOutcome };
      job.exitCode = result.initialOutcome.exitCode;
      job.signal = result.initialOutcome.signal;
      if (
        result.initialOutcome.exitCode !== 0 ||
        result.initialOutcome.signal !== null
      ) {
        active.runFailure ??= 'COMMAND_FAILED';
      }
    }
    if (job.nativeSession) {
      job.nativeSession.phase = result.phase;
      job.nativeSession.sessionResult = result.sessionOutcome
        ? { ...result.sessionOutcome }
        : null;
    }
    if (result.termination === 'initial_timeout') job.stopReason ??= 'timeout';
    else if (result.termination === 'user_stop') job.stopReason ??= 'cancel';
    else if (result.termination === 'parent_exit')
      job.stopReason ??= 'shutdown';
    job.terminationVerified = result.cleanupVerified;
    if (active.preflightDone) this.queueFinalize(active, false);
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
    if (active.preflightDone) this.queueFinalize(active, false);
  }

  private requestStop(
    active: IActiveRun,
    reason: NonNullable<IRunJob['stopReason']>,
  ): void {
    if (
      active.job.phase === 'done' ||
      active.job.phase === 'finalizing' ||
      active.work ||
      (active.job.phase === 'stopping' && active.native !== null)
    )
      return;
    active.job.stopReason ??= reason;
    active.job.status = 'stopping';
    active.job.phase = 'stopping';
    if (active.job.nativeSession && !active.nativeResult) {
      active.job.nativeSession.phase = 'stopping';
    }
    this.clearDeadline(active);
    active.controller.abort();
    if (active.native) {
      void active.native.stop(
        reason === 'shutdown'
          ? 'parent_exit'
          : reason === 'timeout'
            ? 'initial_timeout'
            : 'user_stop',
      );
      return;
    }
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
          (active.job.spawned || active.nativeLaunched) &&
          !active.job.terminationVerified
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

  private classifyNative(active: IActiveRun): void {
    const job = active.job;
    const result = active.nativeResult;
    if (
      !job.terminationVerified ||
      result?.termination === 'termination_unconfirmed'
    ) {
      job.status = 'termination_failed';
      job.failureCode = 'TERMINATION_UNCONFIRMED';
      return;
    }
    if (
      job.stopReason ||
      result?.termination === 'user_stop' ||
      result?.termination === 'initial_timeout' ||
      result?.termination === 'parent_exit'
    ) {
      const reason =
        job.stopReason ??
        (result?.termination === 'initial_timeout'
          ? 'timeout'
          : result?.termination === 'parent_exit'
            ? 'shutdown'
            : 'cancel');
      job.stopReason = reason;
      job.status = reason === 'timeout' ? 'timed_out' : 'cancelled';
      job.failureCode =
        reason === 'timeout'
          ? 'TIMED_OUT'
          : reason === 'shutdown'
            ? 'SHUTDOWN'
            : 'CANCELLED';
      return;
    }
    if (!result) {
      job.status = 'failed';
      job.failureCode = active.runFailure ?? 'INTERNAL_SERVER_ERROR';
      return;
    }
    switch (result.termination) {
      case 'protocol_error':
        job.status = 'failed';
        job.failureCode = 'NATIVE_PROTOCOL_ERROR';
        return;
      case 'handshake_timeout':
        job.status = 'timed_out';
        job.failureCode = 'TIMED_OUT';
        return;
      case 'ipc_lost':
        job.status = 'failed';
        job.failureCode = 'SESSION_INTERRUPTED';
        return;
      case 'journal_failed':
        job.status = 'failed';
        job.failureCode = 'INTERNAL_SERVER_ERROR';
        return;
      case 'start_failed':
        job.status = 'failed';
        job.failureCode = active.runFailure ?? 'SPAWN_FAILED';
        return;
      case 'window_closed':
      case 'session_exit': {
        const outcome = result.initialOutcome ?? active.initialOutcome;
        if (
          !active.observedShellOpen ||
          result.phase !== 'closed' ||
          !outcome
        ) {
          job.status = 'failed';
          job.failureCode = 'SESSION_INTERRUPTED';
          return;
        }
        if (outcome.exitCode === 0 && outcome.signal === null) {
          job.status = 'completed';
          job.failureCode = null;
        } else {
          job.status = 'failed';
          job.failureCode = active.runFailure ?? 'COMMAND_FAILED';
        }
        return;
      }
    }
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
    if (active.useNative) {
      if (
        stop &&
        active.native?.retryCleanup &&
        active.nativeLaunched &&
        !job.terminationVerified
      ) {
        try {
          const retried = await active.native.retryCleanup();
          active.nativeResult = retried;
          if (job.nativeSession) {
            job.nativeSession = {
              ...job.nativeSession,
              phase: retried.phase,
            };
          }
          job.terminationVerified =
            retried.cleanupVerified &&
            retried.termination !== 'termination_unconfirmed';
        } catch {
          job.terminationVerified = false;
        }
        if (job.terminationVerified) {
          // Mutations may have continued after an earlier unconfirmed cleanup.
          active.refreshed = active.diskCleared = active.analysisStaled = false;
        }
      }
      if (!active.nativeLaunched) job.terminationVerified = true;
      this.classifyNative(active);
    } else {
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
    }
    if (!active.logsClosed) {
      active.logs.flush(true);
      active.logsClosed = true;
    }
    this.syncLogs(active);
    const needsInvalidation = active.useNative
      ? job.mayHaveChanged || active.observedShellOpen
      : job.spawned;
    if (needsInvalidation) {
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
          if (active.useNative && this.runtime.invalidation.staleAllAnalyses) {
            this.runtime.invalidation.staleAllAnalyses();
          } else {
            this.runtime.invalidation.staleAnalysis(job.path);
          }
          active.analysisStaled = true;
        } catch {
          /* Audit the incomplete cleanup. */
        }
      }
    }
    const invalidationFailed =
      needsInvalidation &&
      !(active.refreshed && active.diskCleared && active.analysisStaled);
    job.refreshRequired = active.useNative
      ? needsInvalidation
      : invalidationFailed;
    if (invalidationFailed && job.failureCode === null) {
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
    const terminationOk = active.useNative
      ? job.terminationVerified
      : !job.spawned || job.terminationVerified;
    if (terminationOk && !invalidationFailed && job.auditWritten) {
      if (active.useNative && this.runtime.recovery) {
        try {
          await this.runtime.recovery.removeMarkers({
            jobId: job.jobId,
            generation: 1,
          });
          this.runtime.gate.leave(active.token);
          job.gateHeld = false;
        } catch {
          this.recoveryHold = {
            active: true,
            reason: 'JOURNAL_REMOVAL_FAILED',
            journalPath: this.runtime.recovery.journalPath,
          };
          this.recoveryHoldToken = active.token;
          job.recoveryHold = { ...this.recoveryHold };
          job.failureCode = 'RECOVERY_HOLD';
          if (job.status === 'completed') job.status = 'failed';
        }
      } else {
        this.runtime.gate.leave(active.token);
        job.gateHeld = false;
      }
    }
    job.phase = 'done';
    job.finishedAt = this.runtime.now().toISOString();
  }
}
