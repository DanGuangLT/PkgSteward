import type { ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { execa } from 'execa';
import type { Options as ExecaOptions } from 'execa';
import type {
  IRunProcess,
  IRunProcessCallbacks,
  IRunProcessDeps,
  IRunProcessExit,
} from '@/npm-runner/execution/runner-process';
import type { IRunnerCommand } from '@/npm-runner/interfaces/npm-runner.types';
import {
  assertTerminalIdentity,
  assertTerminalSize,
  parseTerminalFrame,
  terminalFailure,
  terminalInteger,
} from '@/npm-runner/terminal/terminal-protocol';
import type {
  ITerminalIdentity,
  ITerminalInputFrame,
  ITerminalSize,
  ParentTerminalFrame,
  TerminalDeliveryStatus,
  WorkerTerminalFrame,
} from '@/npm-runner/terminal/terminal-protocol';
import type {
  IRunnerProcessIdentity,
  RunnerStopOutcome,
} from '@/platform/windows/windows-runner-process';

export const TERMINAL_HANDSHAKE_TIMEOUT_MS = 15_000;
export const TERMINAL_INPUT_ACK_TIMEOUT_MS = 5_000;

export interface ITerminalWorkerSubprocess extends PromiseLike<unknown> {
  readonly pid?: number;
  readonly nodeChildProcess: ChildProcess;
}

export interface ITerminalRunProcess extends IRunProcess {
  readonly ready: Promise<boolean>;
  write(frame: ITerminalInputFrame): Promise<TerminalDeliveryStatus>;
  resize(size: ITerminalSize, writerGeneration: number): Promise<void>;
}

export interface ITerminalRunCallbacks extends IRunProcessCallbacks {
  onTerminalOutput?(text: string): void;
  onTerminalAck?(
    ack: Extract<WorkerTerminalFrame, { type: 'input-ack' }>,
  ): void;
}

export interface ITerminalRunDeps extends IRunProcessDeps {
  spawnWorker?: (
    file: string,
    args: readonly string[],
    options: ExecaOptions,
  ) => ITerminalWorkerSubprocess;
  workerFile?: string;
}

interface IPendingWrite {
  writerGeneration: number;
  sequence: number;
  timer: unknown;
  resolve(status: TerminalDeliveryStatus): void;
}

const identityKey = (value: IRunnerProcessIdentity): string =>
  `${value.pid}:${value.creationTime}`;

const sanitizeEnv = (
  env: Readonly<NodeJS.ProcessEnv>,
): Record<string, string> => {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') sanitized[key] = value;
  }
  return sanitized;
};

export function launchTerminalRun(
  command: IRunnerCommand,
  env: Readonly<NodeJS.ProcessEnv>,
  callbacks: ITerminalRunCallbacks,
  deps: ITerminalRunDeps,
  identity: ITerminalIdentity,
  initialSize?: ITerminalSize,
): ITerminalRunProcess {
  assertTerminalIdentity(identity);
  const size: ITerminalSize = initialSize ?? { cols: 80, rows: 24 };
  assertTerminalSize(size);
  const workerFile =
    deps.workerFile ?? join(__dirname, 'terminal-worker-entry.js');
  const spawnWorker =
    deps.spawnWorker ??
    ((file: string, args: readonly string[], options: ExecaOptions) =>
      execa(file, args, options));

  let child: ITerminalWorkerSubprocess | null = null;
  let resolveSettled!: (result: IRunProcessExit) => void;
  const settled = new Promise<IRunProcessExit>((resolve) => {
    resolveSettled = resolve;
  });
  let resolveReady!: (value: boolean) => void;
  const ready = new Promise<boolean>((resolve) => {
    resolveReady = resolve;
  });
  let resolveHelperIdentity!: (value: IRunnerProcessIdentity | null) => void;
  const helperIdentityReady = new Promise<IRunnerProcessIdentity | null>(
    (resolve) => {
      resolveHelperIdentity = resolve;
    },
  );

  let readySettled = false;
  let isReady = false;
  let helperSpawned = false;
  let helperCaptureStarted = false;
  let helperIdentity: IRunnerProcessIdentity | null = null;
  let initSent = false;
  let readyReceived = false;
  let commandIdentity: IRunnerProcessIdentity | null = null;
  let commandVerification: Promise<void> | null = null;
  let commandCaptureFailed = false;
  let commandOutsideTree = false;
  let workerLostBeforeCommandIdentity = false;
  let workerExitReceived = false;
  let workerErrorCode: 'START_FAILED' | 'WORKER_FAILED' | null = null;
  let protocolFailed = false;
  let streamFailed = false;
  let handshakeTimer: unknown = null;
  let launchedAt = 0;
  let parentDone = false;
  let ipcOpen = true;
  let exitCode: number | null = null;
  let signal: string | null = null;
  let failureCode: IRunProcessExit['failureCode'] = null;
  let published = false;
  let stopped = false;
  let closing = false;
  let activeStop: Promise<RunnerStopOutcome> | null = null;
  let lastOutcome: RunnerStopOutcome | null = null;
  let pendingWrite: IPendingWrite | null = null;
  const tracked = new Map<string, IRunnerProcessIdentity>();

  const clearHandshakeTimer = (): void => {
    if (handshakeTimer !== null) {
      deps.clock.clearTimeout(handshakeTimer);
      handshakeTimer = null;
    }
  };

  const finishReady = (value: boolean): void => {
    if (readySettled) return;
    readySettled = true;
    isReady = value;
    clearHandshakeTimer();
    resolveReady(value);
  };

  const resolvePendingWrite = (status: TerminalDeliveryStatus): void => {
    const active = pendingWrite;
    if (!active) return;
    pendingWrite = null;
    deps.clock.clearTimeout(active.timer);
    active.resolve(status);
  };

  const sendIpc = (frame: ParentTerminalFrame): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const native = child?.nodeChildProcess;
      if (
        !native ||
        !ipcOpen ||
        native.connected === false ||
        typeof native.send !== 'function'
      ) {
        reject(new Error('IPC unavailable'));
        return;
      }
      try {
        native.send(frame, (error: Error | null) => {
          if (error) reject(error);
          else resolve();
        });
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error('IPC send failed'));
      }
    });

  const disconnectIpc = (): void => {
    const native = child?.nodeChildProcess;
    if (
      native &&
      native.connected !== false &&
      typeof native.disconnect === 'function'
    ) {
      try {
        native.disconnect();
      } catch {
        /* Ignore disconnect failures during cleanup. */
      }
    }
    ipcOpen = false;
  };

  const publish = (termination: RunnerStopOutcome): void => {
    if (published) return;
    published = true;
    clearHandshakeTimer();
    finishReady(false);
    resolvePendingWrite('unknown');
    callbacks.signal.removeEventListener('abort', abort);
    const result: IRunProcessExit = {
      exitCode,
      signal,
      failureCode:
        streamFailed || protocolFailed
          ? 'COMMAND_FAILED'
          : (failureCode ??
            (workerExitReceived && exitCode === 0 ? null : 'COMMAND_FAILED')),
      termination,
      outputTruncated: false,
    };
    resolveSettled(result);
    try {
      callbacks.onExit(result);
    } catch {
      /* Consumer failure cannot restart a worker. */
    }
  };

  const cleanup = async (kill: boolean): Promise<RunnerStopOutcome> => {
    let root = await helperIdentityReady;
    if (commandVerification) await commandVerification;
    if (!root) {
      if (!helperSpawned) return 'verified';
      const pid = child?.pid;
      if (!parentDone || typeof pid !== 'number' || initSent)
        return 'unconfirmed';
      root = { pid, creationTime: new Date(launchedAt - 2000).toISOString() };
    }
    tracked.set(identityKey(root), root);
    if (
      workerLostBeforeCommandIdentity ||
      commandOutsideTree ||
      (commandCaptureFailed && !workerExitReceived)
    ) {
      try {
        const tree = await deps.processes.descendants(root, [
          ...tracked.values(),
        ]);
        if (tree.status === 'ok') {
          for (const item of tree.identities)
            tracked.set(identityKey(item), item);
          const descendants = [...tracked.values()].filter(
            (item) => item.pid !== root.pid,
          );
          try {
            await deps.processes.stopTree(root, descendants);
          } catch {
            /* Independent uncertainty remains. */
          }
          await deps.processes.verifyGone([...tracked.values()]);
        }
      } catch {
        /* Keep uncertainty on cleanup failure. */
      }
      return 'unconfirmed';
    }
    try {
      const tree = await deps.processes.descendants(root, [
        ...tracked.values(),
      ]);
      if (tree.status !== 'ok') return 'unconfirmed';
      for (const item of tree.identities) tracked.set(identityKey(item), item);
      if (kill || stopped || !parentDone || tree.identities.length > 0) {
        const descendants = [...tracked.values()].filter(
          (item) => item.pid !== root.pid,
        );
        try {
          await deps.processes.stopTree(root, descendants);
        } catch {
          /* Verify independently. */
        }
      }
      return await deps.processes.verifyGone([...tracked.values()]);
    } catch {
      return 'unconfirmed';
    }
  };

  async function stop(): Promise<RunnerStopOutcome> {
    if (!stopped && initSent && !commandIdentity && !workerExitReceived) {
      const helperAlive =
        !parentDone && ipcOpen && workerErrorCode !== 'WORKER_FAILED';
      if (!helperAlive && workerErrorCode !== 'START_FAILED')
        workerLostBeforeCommandIdentity = true;
    }
    stopped = true;
    closing = true;
    finishReady(false);
    resolvePendingWrite('unknown');
    if (initSent && ipcOpen) {
      const native = child?.nodeChildProcess;
      if (
        native &&
        native.connected !== false &&
        typeof native.send === 'function'
      ) {
        try {
          native.send({ ...identity, type: 'stop' });
        } catch {
          /* Authoritative tree stop runs next. */
        }
      }
    }
    if (activeStop) return activeStop;
    if (published && lastOutcome === 'verified') return 'verified';
    const attempt = async (): Promise<RunnerStopOutcome> => {
      const outcome = await cleanup(true);
      lastOutcome = outcome;
      disconnectIpc();
      publish(outcome);
      return outcome;
    };
    activeStop = attempt();
    try {
      return await activeStop;
    } finally {
      activeStop = null;
    }
  }

  function abort(): void {
    void stop();
  }

  const naturalExit = async (): Promise<void> => {
    if (activeStop) {
      await activeStop;
      return;
    }
    const attempt = async (): Promise<RunnerStopOutcome> => {
      const outcome = lastOutcome ?? (await cleanup(stopped));
      lastOutcome = outcome;
      disconnectIpc();
      publish(outcome);
      return outcome;
    };
    activeStop = attempt();
    try {
      await activeStop;
    } finally {
      activeStop = null;
    }
  };

  const failClosed = (): void => {
    protocolFailed = true;
    closing = true;
    if (failureCode === null)
      failureCode = initSent ? 'COMMAND_FAILED' : 'SPAWN_FAILED';
    finishReady(false);
    resolvePendingWrite('unknown');
    void stop();
  };

  const beginStartup = (): void => {
    const pid = child?.pid;
    if (
      helperCaptureStarted ||
      typeof pid !== 'number' ||
      !Number.isSafeInteger(pid) ||
      pid <= 0
    )
      return;
    helperSpawned = true;
    helperCaptureStarted = true;
    void (async () => {
      let captured: Awaited<ReturnType<typeof deps.processes.capture>>;
      try {
        captured = await deps.processes.capture(pid);
      } catch {
        captured = { status: 'unknown' };
      }
      if (captured.status !== 'ok') {
        resolveHelperIdentity(null);
        if (!stopped && !closing && !parentDone) {
          if (failureCode === null) failureCode = 'SPAWN_FAILED';
          finishReady(false);
          void stop();
        }
        return;
      }
      helperIdentity = captured.identity;
      tracked.set(identityKey(helperIdentity), helperIdentity);
      resolveHelperIdentity(helperIdentity);
      if (
        stopped ||
        closing ||
        parentDone ||
        !ipcOpen ||
        callbacks.signal.aborted
      ) {
        finishReady(false);
        return;
      }
      try {
        const initFrame = parseTerminalFrame(
          {
            ...identity,
            type: 'init',
            file: command.file,
            args: [...command.args],
            cwd: command.cwd,
            env: sanitizeEnv(env),
            cols: size.cols,
            rows: size.rows,
          },
          identity,
          'parent',
        );
        initSent = true;
        await sendIpc(initFrame);
      } catch {
        if (failureCode === null) failureCode = 'COMMAND_FAILED';
        finishReady(false);
        void stop();
      }
    })();
  };

  const verifyReadyPid = (commandPid: number): void => {
    commandVerification = (async () => {
      if (!helperIdentity || commandPid === helperIdentity.pid) {
        commandOutsideTree = true;
        failClosed();
        return;
      }
      let captured: Awaited<ReturnType<typeof deps.processes.capture>>;
      try {
        captured = await deps.processes.capture(commandPid);
      } catch {
        captured = { status: 'unknown' };
      }
      if (captured.status !== 'ok') {
        commandCaptureFailed = true;
        finishReady(false);
        if (!workerExitReceived && !stopped && !closing) {
          if (failureCode === null) failureCode = 'COMMAND_FAILED';
          void stop();
        }
        return;
      }
      const cmdId = captured.identity;
      let tree: Awaited<ReturnType<typeof deps.processes.descendants>>;
      try {
        tree = await deps.processes.descendants(helperIdentity, [
          ...tracked.values(),
        ]);
      } catch {
        tree = { status: 'unknown' };
      }
      if (tree.status !== 'ok') {
        commandCaptureFailed = true;
        finishReady(false);
        if (!workerExitReceived && !stopped && !closing) {
          if (failureCode === null) failureCode = 'COMMAND_FAILED';
          void stop();
        }
        return;
      }
      for (const item of tree.identities) tracked.set(identityKey(item), item);
      const inTree = tree.identities.some(
        (item) =>
          item.pid === cmdId.pid && item.creationTime === cmdId.creationTime,
      );
      if (!inTree) {
        commandOutsideTree = true;
        finishReady(false);
        if (!workerExitReceived && !stopped && !closing) {
          if (failureCode === null) failureCode = 'COMMAND_FAILED';
          void stop();
        }
        return;
      }
      if (
        stopped ||
        closing ||
        workerExitReceived ||
        parentDone ||
        !ipcOpen ||
        protocolFailed ||
        streamFailed
      ) {
        finishReady(false);
        return;
      }
      commandIdentity = cmdId;
      finishReady(true);
    })();
  };

  const onMessage = (raw: unknown): void => {
    let frame: WorkerTerminalFrame;
    try {
      frame = parseTerminalFrame(raw, identity, 'worker');
    } catch {
      failClosed();
      return;
    }
    switch (frame.type) {
      case 'ready':
        if (!initSent || readyReceived || stopped || closing) {
          failClosed();
          return;
        }
        readyReceived = true;
        verifyReadyPid(frame.pid);
        break;
      case 'output':
        if (!initSent || !readyReceived) {
          failClosed();
          return;
        }
        if (published) return;
        try {
          callbacks.onTerminalOutput?.(frame.text);
          callbacks.onOutput('stdout', Buffer.from(frame.text, 'utf8'));
        } catch {
          streamFailed = true;
          void stop();
        }
        break;
      case 'input-ack':
        if (!initSent || !readyReceived) {
          failClosed();
          return;
        }
        if (
          pendingWrite &&
          pendingWrite.writerGeneration === frame.writerGeneration &&
          pendingWrite.sequence === frame.sequence
        ) {
          resolvePendingWrite(frame.status);
        }
        try {
          callbacks.onTerminalAck?.(frame);
        } catch {
          /* Callback failure cannot restart or corrupt worker state. */
        }
        break;
      case 'exit':
        if (!initSent || workerExitReceived) {
          failClosed();
          return;
        }
        workerExitReceived = true;
        closing = true;
        exitCode = frame.exitCode;
        signal = frame.signal;
        if (!protocolFailed && !streamFailed && workerErrorCode === null) {
          failureCode = frame.exitCode === 0 ? null : 'COMMAND_FAILED';
        }
        finishReady(false);
        resolvePendingWrite('unknown');
        if (!published) void naturalExit();
        break;
      case 'error':
        workerErrorCode = frame.code;
        closing = true;
        if (frame.code === 'START_FAILED') {
          if (failureCode === null) failureCode = 'SPAWN_FAILED';
        } else {
          failureCode = 'COMMAND_FAILED';
          if (initSent && !commandIdentity)
            workerLostBeforeCommandIdentity = true;
        }
        finishReady(false);
        resolvePendingWrite('unknown');
        void stop();
        break;
    }
  };

  const onDisconnect = (): void => {
    ipcOpen = false;
    resolvePendingWrite('unknown');
    if (workerExitReceived || published) return;
    closing = true;
    if (initSent && !commandIdentity && workerErrorCode !== 'START_FAILED') {
      workerLostBeforeCommandIdentity = true;
    }
    if (failureCode === null) {
      failureCode = initSent ? 'COMMAND_FAILED' : 'SPAWN_FAILED';
    }
    finishReady(false);
    if (!published) void naturalExit();
  };

  const parentResult = (_value: unknown, rejected: boolean): void => {
    if (parentDone) return;
    parentDone = true;
    ipcOpen = false;
    if (!helperCaptureStarted) resolveHelperIdentity(null);
    resolvePendingWrite('unknown');
    if (!workerExitReceived) {
      closing = true;
      if (!helperSpawned) {
        failureCode = 'SPAWN_FAILED';
      } else {
        if (
          initSent &&
          !commandIdentity &&
          workerErrorCode !== 'START_FAILED' &&
          !stopped
        ) {
          workerLostBeforeCommandIdentity = true;
        }
        if (failureCode === null || rejected) {
          failureCode =
            initSent && workerErrorCode !== 'START_FAILED'
              ? 'COMMAND_FAILED'
              : 'SPAWN_FAILED';
        }
      }
      finishReady(false);
    }
    if (!published) void naturalExit();
  };

  const api: ITerminalRunProcess = {
    get pid() {
      const value = child?.pid;
      return typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value > 0
        ? value
        : null;
    },
    ready,
    settled,
    stop,
    async write(frame: ITerminalInputFrame): Promise<TerminalDeliveryStatus> {
      assertTerminalIdentity(frame, identity);
      if (frame.type !== 'input') terminalFailure(400, 'INVALID_FRAME');
      if (!isReady || stopped || closing || !ipcOpen || pendingWrite !== null) {
        return 'not_delivered';
      }
      const native = child?.nodeChildProcess;
      if (
        !native ||
        native.connected === false ||
        typeof native.send !== 'function'
      ) {
        return 'not_delivered';
      }
      return new Promise<TerminalDeliveryStatus>((resolve) => {
        const timer = deps.clock.setTimeout(() => {
          resolvePendingWrite('unknown');
        }, TERMINAL_INPUT_ACK_TIMEOUT_MS);
        pendingWrite = {
          writerGeneration: frame.writerGeneration,
          sequence: frame.sequence,
          timer,
          resolve,
        };
        try {
          native.send(frame, (error: Error | null) => {
            if (error) resolvePendingWrite('unknown');
          });
        } catch {
          resolvePendingWrite('unknown');
        }
      });
    },
    async resize(sizeUpdate: ITerminalSize, writerGeneration: number) {
      assertTerminalSize(sizeUpdate);
      if (!terminalInteger(writerGeneration))
        terminalFailure(400, 'INVALID_SEQUENCE');
      if (!isReady || stopped || closing || !ipcOpen)
        terminalFailure(409, 'RESIZE_FAILED');
      try {
        await sendIpc({
          ...identity,
          type: 'resize',
          writerGeneration,
          cols: sizeUpdate.cols,
          rows: sizeUpdate.rows,
        });
      } catch {
        terminalFailure(409, 'RESIZE_FAILED');
      }
    },
  };

  if (callbacks.signal.aborted) {
    parentDone = true;
    ipcOpen = false;
    resolveHelperIdentity(null);
    lastOutcome = 'verified';
    finishReady(false);
    published = true;
    resolveSettled({
      exitCode: null,
      signal: null,
      failureCode: null,
      termination: 'verified',
      outputTruncated: false,
    });
    try {
      callbacks.onExit({
        exitCode: null,
        signal: null,
        failureCode: null,
        termination: 'verified',
        outputTruncated: false,
      });
    } catch {
      /* Consumer failure cannot restart a worker. */
    }
    return api;
  }

  callbacks.signal.addEventListener('abort', abort, { once: true });
  handshakeTimer = deps.clock.setTimeout(() => {
    if (readySettled) return;
    if (failureCode === null)
      failureCode = initSent ? 'COMMAND_FAILED' : 'SPAWN_FAILED';
    finishReady(false);
    void stop();
  }, TERMINAL_HANDSHAKE_TIMEOUT_MS);

  try {
    launchedAt = deps.clock.now();
    child = spawnWorker(
      process.execPath,
      [workerFile, identity.jobId, String(identity.generation)],
      {
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'ignore',
        ipc: true,
        serialization: 'json',
        buffer: false,
        verbose: 'none',
        shell: false,
        preferLocal: false,
        windowsHide: true,
        extendEnv: false,
        detached: false,
        cleanup: true,
        killDescendants: true,
        reject: false,
      },
    );
    const native = child.nodeChildProcess;
    native.on('message', onMessage);
    native.on('disconnect', onDisconnect);
    native.once('spawn', beginStartup);
    native.once('exit', (code: number | null, exitSignal: string | null) => {
      parentResult(
        { exitCode: code, signal: exitSignal, failed: code !== 0 },
        false,
      );
    });
    native.on('error', () => {
      if (!helperCaptureStarted && !child?.pid) resolveHelperIdentity(null);
    });
    void Promise.resolve(child).then(
      (result) => parentResult(result, false),
      (error: unknown) => parentResult(error, true),
    );
    beginStartup();
  } catch {
    parentResult(null, true);
  }
  return api;
}
