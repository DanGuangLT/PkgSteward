import type { ChildProcess } from 'node:child_process';
import type { IRunnerCommand } from './interfaces/npm-runner.types';
import type { IRunClock } from './runner-logs';
import type {
  IRunnerProcessIdentity,
  IWindowsRunnerProcess,
  RunnerStopOutcome,
} from '../platform/windows/windows-runner-process';
import { execa } from 'execa';

export interface IRunProcessExit {
  exitCode: number | null;
  signal: string | null;
  failureCode: 'SPAWN_FAILED' | 'COMMAND_FAILED' | null;
  termination: RunnerStopOutcome;
  outputTruncated: boolean;
}

export interface IRunProcess {
  readonly pid: number | null;
  readonly settled: Promise<IRunProcessExit>;
  stop(): Promise<RunnerStopOutcome>;
}

export interface IRunProcessCallbacks {
  onOutput(stream: 'stdout' | 'stderr', chunk: Buffer): void;
  onExit(result: IRunProcessExit): void;
  signal: AbortSignal;
}

export interface IRunProcessDeps {
  processes: IWindowsRunnerProcess;
  clock: IRunClock;
}

export function launchRun(
  command: IRunnerCommand,
  env: Readonly<NodeJS.ProcessEnv>,
  callbacks: IRunProcessCallbacks,
  deps: IRunProcessDeps,
): IRunProcess {
  const spawn = () =>
    execa(command.file, command.args, {
      cwd: command.cwd,
      env,
      extendEnv: false,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      buffer: false,
      encoding: 'buffer',
      all: false,
      verbose: 'none',
      shell: false,
      preferLocal: false,
      windowsHide: false,
      detached: false,
      cleanup: true,
      killDescendants: true,
      reject: false,
    });
  let child: ReturnType<typeof spawn> | null = null;
  let resolveSettled!: (result: IRunProcessExit) => void;
  const settled = new Promise<IRunProcessExit>((resolve) => {
    resolveSettled = resolve;
  });
  let resolveIdentity!: (identity: IRunnerProcessIdentity | null) => void;
  const identityReady = new Promise<IRunnerProcessIdentity | null>(
    (resolve) => {
      resolveIdentity = resolve;
    },
  );
  let identityStarted = false;
  let spawned = false;
  let launchedAt = 0;
  let parentDone = false;
  let exitCode: number | null = null;
  let signal: string | null = null;
  let failureCode: IRunProcessExit['failureCode'] = null;
  let streamFailed = false;
  let published = false;
  let stopped = false;
  let activeStop: Promise<RunnerStopOutcome> | null = null;
  let lastOutcome: RunnerStopOutcome | null = null;
  const tracked = new Map<string, IRunnerProcessIdentity>();
  const outputClosed = { stdout: true, stderr: true };
  let completeDrain: ((truncated: boolean) => void) | null = null;
  let drain: Promise<boolean> | null = null;

  const identify = (): void => {
    const pid = child?.pid;
    if (
      identityStarted ||
      typeof pid !== 'number' ||
      !Number.isSafeInteger(pid) ||
      pid <= 0
    )
      return;
    spawned = true;
    identityStarted = true;
    // Capture is deliberately once per launch; there is no background CIM timer.
    try {
      void deps.processes.capture(pid).then(
        (result) =>
          resolveIdentity(result.status === 'ok' ? result.identity : null),
        () => resolveIdentity(null),
      );
    } catch {
      resolveIdentity(null);
    }
  };
  const checkDrain = (): void => {
    if (parentDone && outputClosed.stdout && outputClosed.stderr)
      completeDrain?.(false);
  };
  const waitDrain = (): Promise<boolean> => {
    if (drain) return drain;
    if (parentDone && outputClosed.stdout && outputClosed.stderr)
      return Promise.resolve(false);
    drain = new Promise<boolean>((resolve) => {
      let finished = false;
      const timer = deps.clock.setTimeout(() => {
        completeDrain?.(true);
        if (!outputClosed.stdout) child?.stdout?.destroy();
        if (!outputClosed.stderr) child?.stderr?.destroy();
      }, 1000);
      completeDrain = (truncated) => {
        if (finished) return;
        finished = true;
        deps.clock.clearTimeout(timer);
        completeDrain = null;
        resolve(truncated);
      };
    });
    return drain;
  };
  const publish = async (termination: RunnerStopOutcome): Promise<void> => {
    if (published) return;
    const outputTruncated = await waitDrain();
    if (published) return;
    published = true;
    callbacks.signal.removeEventListener('abort', abort);
    const result: IRunProcessExit = {
      exitCode,
      signal,
      failureCode: streamFailed ? 'COMMAND_FAILED' : failureCode,
      termination,
      outputTruncated,
    };
    resolveSettled(result);
    try {
      callbacks.onExit(result);
    } catch {
      /* Consumer failure cannot restart a process. */
    }
  };
  const cleanup = async (kill: boolean): Promise<RunnerStopOutcome> => {
    let root = await identityReady;
    if (!root) {
      if (!spawned) return 'verified';
      const pid = child?.pid;
      if (!parentDone || typeof pid !== 'number') return 'unconfirmed';
      // A quick exit can precede capture; retain a launch-time floor for orphans.
      root = { pid, creationTime: new Date(launchedAt - 2000).toISOString() };
    }
    tracked.set(`${root.pid}:${root.creationTime}`, root);
    try {
      const tree = await deps.processes.descendants(root, [
        ...tracked.values(),
      ]);
      if (tree.status !== 'ok') return 'unconfirmed';
      for (const identity of tree.identities)
        tracked.set(`${identity.pid}:${identity.creationTime}`, identity);
      if (kill || stopped || tree.identities.length > 0) {
        const descendants = [...tracked.values()].filter(
          (identity) => identity.pid !== root.pid,
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
    stopped = true;
    if (activeStop) return activeStop;
    if (published && lastOutcome === 'verified') return 'verified';
    const attempt = async (): Promise<RunnerStopOutcome> => {
      const outcome = await cleanup(true);
      lastOutcome = outcome;
      await publish(outcome);
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
      await publish(outcome);
      return outcome;
    };
    activeStop = attempt();
    try {
      await activeStop;
    } finally {
      activeStop = null;
    }
  };
  const parentResult = (value: unknown, rejected: boolean): void => {
    if (parentDone) return;
    parentDone = true;
    if (!identityStarted) resolveIdentity(null);
    const result =
      value !== null && typeof value === 'object'
        ? (value as { exitCode?: unknown; signal?: unknown; failed?: unknown })
        : {};
    exitCode =
      typeof result.exitCode === 'number' && Number.isInteger(result.exitCode)
        ? result.exitCode
        : null;
    signal = typeof result.signal === 'string' ? result.signal : null;
    failureCode = !spawned
      ? 'SPAWN_FAILED'
      : rejected || result.failed === true || exitCode !== 0
        ? 'COMMAND_FAILED'
        : null;
    checkDrain();
    if (!published) void naturalExit();
  };
  const api: IRunProcess = {
    get pid() {
      return child?.pid ?? null;
    },
    settled,
    stop,
  };
  if (callbacks.signal.aborted) {
    parentDone = true;
    resolveIdentity(null);
    lastOutcome = 'verified';
    void publish('verified');
    return api;
  }
  callbacks.signal.addEventListener('abort', abort, { once: true });
  try {
    launchedAt = deps.clock.now();
    child = spawn();
    const native = child as unknown as ChildProcess;
    for (const stream of ['stdout', 'stderr'] as const) {
      const output = child[stream];
      outputClosed[stream] = !output;
      if (!output) continue;
      output.on('data', (chunk: Buffer) => {
        if (published) return;
        try {
          callbacks.onOutput(stream, chunk);
        } catch {
          streamFailed = true;
          void stop();
        }
      });
      const close = (): void => {
        outputClosed[stream] = true;
        checkDrain();
      };
      output.on('end', close);
      output.on('close', close);
      output.on('error', () => {
        streamFailed = true;
        void stop();
      });
    }
    native.once('spawn', identify);
    // Execa's promise can wait on inherited pipes after the root has exited.
    // Observe the native exit now so orphan cleanup cannot wait on those pipes.
    native.once('exit', (code: number | null, exitSignal: string | null) => {
      parentResult(
        { exitCode: code, signal: exitSignal, failed: code !== 0 },
        false,
      );
    });
    native.on('error', () => {
      if (!identityStarted && !child?.pid) resolveIdentity(null);
    });
    // Attach rejection consumption immediately, including after a bounded stop.
    void child.then(
      (result) => parentResult(result, false),
      (error: unknown) => parentResult(error, true),
    );
    identify();
  } catch {
    parentResult(null, true);
  }
  return api;
}
