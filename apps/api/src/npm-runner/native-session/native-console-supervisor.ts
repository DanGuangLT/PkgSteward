import { execa } from 'execa';
import { win32 } from 'node:path';
import * as fs from 'node:fs/promises';
import type { IRunnerFs } from '@/npm-runner/interfaces/npm-runner.types';
import type {
  INativeSessionIdentity,
  NativeBridgeCommand,
  NativeBridgeFrame,
  NativeCoordinatorCommand,
  NativeSupervisorFrame,
} from '@/npm-runner/native-session/native-protocol';
import {
  NativeCommandSequence,
  parseBridgeToSupervisorFrame,
  parseCoordinatorToSupervisorFrame,
} from '@/npm-runner/native-session/native-protocol';
import {
  runnerIdentity,
  sameRunnerIdentity,
} from '@/npm-runner/toolchain/runner-tool';
import { isFullyQualifiedPath, toComparable } from '@/common/utils/path.util';
import { windowsSystemRoot } from '@/platform/windows/windows-process-snapshot';

export interface INativeExitOutcome {
  exitCode: number | null;
  signal: string | null;
}
export interface INativeParentPort {
  send(frame: NativeSupervisorFrame | NativeBridgeFrame): void;
  onMessage(listener: (raw: unknown) => void): () => void;
  onDisconnect(listener: () => void): () => void;
}
export interface INativeChild {
  readonly pid: number | undefined;
  send(frame: NativeCoordinatorCommand | NativeBridgeCommand): void;
  disconnect(): void;
  onMessage(listener: (raw: unknown) => void): () => void;
  onExit(
    listener: (exitCode: number | null, signal: string | null) => void,
  ): () => void;
  onDisconnect(listener: () => void): () => void;
}
export interface INativeLaunchOptions {
  detached: boolean;
  windowsHide: boolean;
  ipc: true;
  serialization: 'json';
  stdin: 'ignore';
  stdout: 'ignore';
  stderr: 'ignore';
  shell: false;
  extendEnv: false;
  env: NodeJS.ProcessEnv;
}
export type NativeNodeSpawn = (
  file: string,
  args: string[],
  options: INativeLaunchOptions,
) => INativeChild;

/** No unref or automatic execa exit-kill: IPC disconnect owns supervisor cleanup. */
export const spawnNativeNode: NativeNodeSpawn = (file, args, options) => {
  const child = execa(file, args, {
    ...options,
    cleanup: false,
    killDescendants: false,
    preferLocal: false,
    buffer: false,
    reject: false,
    verbose: 'none',
  });
  // Consume spawn errors; the normalized exit listener reports failure once.
  void child.catch(() => undefined);
  const native = child.nodeChildProcess;
  const sendErrors = new Set<() => void>();
  return {
    get pid() {
      return child.pid;
    },
    send(frame) {
      native.send(frame, (error: Error | null) => {
        if (error) for (const listener of sendErrors) listener();
      });
    },
    disconnect() {
      if (native.connected) native.disconnect();
    },
    onMessage(listener) {
      native.on('message', listener);
      return () => {
        native.off('message', listener);
      };
    },
    onDisconnect(listener) {
      native.on('disconnect', listener);
      sendErrors.add(listener);
      return () => {
        native.off('disconnect', listener);
        sendErrors.delete(listener);
      };
    },
    onExit(listener) {
      let sent = false;
      const done = (code: number | null, signal: string | null) => {
        if (!sent) {
          sent = true;
          listener(code, signal);
        }
      };
      const error = () => done(null, null);
      native.on('exit', done);
      native.on('error', error);
      return () => {
        native.off('exit', done);
        native.off('error', error);
      };
    },
  };
};
export function nativeLaunchOptions(
  systemRoot: string,
  detached: boolean,
): INativeLaunchOptions {
  return {
    detached,
    windowsHide: detached,
    ipc: true,
    serialization: 'json',
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
    shell: false,
    extendEnv: false,
    env: { SystemRoot: systemRoot, Path: win32.join(systemRoot, 'System32') },
  };
}
export interface INativeSupervisorDeps {
  identity: INativeSessionIdentity;
  execPath: string;
  entryDir: string;
  systemRoot: string | undefined;
  fs: Pick<IRunnerFs, 'lstat' | 'realpath'>;
  parent: INativeParentPort;
  spawn: NativeNodeSpawn;
  taskkill(file: string, args: string[], timeoutMs: number): Promise<void>;
}
export function createNativeConsoleSupervisor(deps: INativeSupervisorDeps): {
  settled: Promise<void>;
} {
  const sequence = new NativeCommandSequence(deps.identity);
  const root = windowsSystemRoot(deps.systemRoot);
  const bridgeFile = win32.join(deps.entryDir, 'native-console-entry.js');
  let child: INativeChild | null = null;
  let childLive = false;
  let bridgeSessionEnded = false;
  let stopping = false;
  let finished = false;
  let queue = Promise.resolve();
  let cleanup: Promise<void> | null = null;
  const removers: (() => void)[] = [];
  let resolve!: () => void;
  const settled = new Promise<void>((done) => {
    resolve = done;
  });
  const send = (frame: NativeSupervisorFrame) => {
    try {
      deps.parent.send(frame);
    } catch {
      stopping = true;
    }
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    for (const remove of removers.splice(0)) remove();
    resolve();
  };
  const stopChild = async () => {
    if (!child || !childLive) return;
    try {
      child.send({ ...deps.identity, type: 'stop' });
    } catch {
      /* taskkill remains required */
    }
    if (!root || !child.pid) return;
    await deps.taskkill(
      win32.join(root, 'System32', 'taskkill.exe'),
      ['/PID', String(child.pid), '/T', '/F'],
      10_000,
    );
  };
  const shutdown = (): Promise<void> => {
    stopping = true;
    cleanup ??= (async () => {
      try {
        await stopChild();
      } catch {
        /* API independently verifies cleanup */
      } finally {
        finish();
      }
    })();
    return cleanup;
  };
  const fail = (code: 'START_FAILED' | 'PROTOCOL_ERROR') => {
    stopping = true;
    send({
      ...deps.identity,
      type: 'supervisor-error',
      code,
      message: 'Native supervisor failed',
    });
    queue = queue.then(shutdown).catch(shutdown);
  };
  const checkFile = async (file: string): Promise<boolean> => {
    const before = runnerIdentity(file, await deps.fs.lstat(file));
    return (
      before.stat.isFile() &&
      !before.stat.isSymbolicLink() &&
      toComparable(await deps.fs.realpath(file), 'win32') ===
        toComparable(file, 'win32') &&
      sameRunnerIdentity(before.stat, await deps.fs.lstat(file))
    );
  };
  const handle = async (frame: NativeCoordinatorCommand) => {
    if (stopping) {
      await shutdown();
      return;
    }
    if (frame.type === 'spawn-bridge') {
      if (
        !root ||
        !isFullyQualifiedPath(deps.execPath, 'win32') ||
        win32.basename(deps.execPath).toLowerCase() !== 'node.exe' ||
        toComparable(frame.execPath, 'win32') !==
          toComparable(deps.execPath, 'win32') ||
        !isFullyQualifiedPath(deps.entryDir, 'win32') ||
        !(await checkFile(deps.execPath)) ||
        !(await checkFile(bridgeFile))
      ) {
        fail('START_FAILED');
        return;
      }
      if (stopping) {
        await shutdown();
        return;
      }
      // Store the returned handle even if spawn synchronously triggers disconnect.
      child = deps.spawn(
        deps.execPath,
        [bridgeFile, deps.identity.jobId, String(deps.identity.generation)],
        nativeLaunchOptions(root, false),
      );
      childLive = true;
      removers.push(
        child.onExit((exitCode, signal) => {
          childLive = false;
          send({ ...deps.identity, type: 'bridge-exit', exitCode, signal });
          if (!stopping) finish();
        }),
      );
      removers.push(
        child.onMessage((raw) => {
          if (stopping || finished) return;
          try {
            send({
              ...deps.identity,
              type: 'bridge-frame',
              payload: (() => {
                const frame = parseBridgeToSupervisorFrame(raw, deps.identity);
                if (frame.type === 'session-exit') bridgeSessionEnded = true;
                return frame;
              })(),
            });
          } catch {
            fail('PROTOCOL_ERROR');
          }
        }),
      );
      removers.push(
        child.onDisconnect(() => {
          if (childLive && !stopping && !bridgeSessionEnded)
            fail('START_FAILED');
        }),
      );
      if (!Number.isSafeInteger(child.pid) || !child.pid || child.pid <= 0) {
        fail('START_FAILED');
        return;
      }
      send({ ...deps.identity, type: 'bridge-spawned', pid: child.pid });
      if (stopping) await shutdown();
    } else {
      if (!child || !childLive) {
        fail('PROTOCOL_ERROR');
        return;
      }
      child.send(frame);
    }
  };
  // Register before supervisor-ready and before any asynchronous validation/spawn.
  removers.push(
    deps.parent.onDisconnect(() => {
      stopping = true;
      queue = queue.then(shutdown).catch(shutdown);
    }),
  );
  removers.push(
    deps.parent.onMessage((raw) => {
      if (finished) return;
      let frame: NativeCoordinatorCommand;
      try {
        frame = sequence.accept(raw);
      } catch {
        fail('PROTOCOL_ERROR');
        return;
      }
      if (frame.type === 'stop') {
        stopping = true;
        queue = queue.then(shutdown).catch(shutdown);
        return;
      }
      queue = queue
        .then(() => handle(frame))
        .catch(() => {
          fail('START_FAILED');
        });
    }),
  );
  send({ ...deps.identity, type: 'supervisor-ready' });
  return { settled };
}

export interface INativeProcessPortProcess {
  readonly connected?: boolean;
  send?(
    frame: NativeSupervisorFrame | NativeBridgeFrame,
    callback: (error: Error | null) => void,
  ): unknown;
  on(event: 'message', listener: (raw: unknown) => void): unknown;
  on(event: 'disconnect', listener: () => void): unknown;
  off(event: 'message', listener: (raw: unknown) => void): unknown;
  off(event: 'disconnect', listener: () => void): unknown;
}
export function nativeProcessPort(
  target: INativeProcessPortProcess = process,
): INativeParentPort {
  let lost = false;
  let listening = false;
  const listeners = new Set<() => void>();
  const onLoss = () => {
    if (lost) return;
    lost = true;
    for (const listener of [...listeners]) listener();
  };
  return {
    send(frame) {
      if (lost || !target.connected || !target.send) {
        onLoss();
        throw new Error('IPC disconnected');
      }
      try {
        // Node emits an uncaught process error for asynchronous write failures
        // without a callback; route those failures through the same loss latch.
        target.send(frame, (error) => {
          if (error) onLoss();
        });
      } catch (error) {
        onLoss();
        throw error;
      }
    },
    onMessage(fn) {
      const onMessage = (raw: unknown) => {
        if (!lost) fn(raw);
      };
      target.on('message', onMessage);
      return () => {
        target.off('message', onMessage);
      };
    },
    onDisconnect(fn) {
      if (lost) {
        fn();
        return () => undefined;
      }
      const notify = () => {
        fn();
      };
      listeners.add(notify);
      if (!listening) {
        target.on('disconnect', onLoss);
        listening = true;
      }
      return () => {
        listeners.delete(notify);
        if (listening && listeners.size === 0) {
          target.off('disconnect', onLoss);
          listening = false;
        }
      };
    },
  };
}
export function nativeCliIdentity(
  argv: readonly string[],
): INativeSessionIdentity | null {
  if (argv.length !== 2 || !process.send || !process.connected) return null;
  const identity = { jobId: argv[0], generation: Number(argv[1]) };
  if (String(identity.generation) !== argv[1]) return null;
  try {
    parseCoordinatorToSupervisorFrame({ ...identity, type: 'stop' }, identity);
    return identity;
  } catch {
    return null;
  }
}
if (require.main === module) {
  const identity = nativeCliIdentity(process.argv.slice(2));
  if (!identity) process.exitCode = 1;
  else {
    const supervisor = createNativeConsoleSupervisor({
      identity,
      execPath: process.execPath,
      entryDir: __dirname,
      systemRoot: process.env.SystemRoot,
      fs,
      parent: nativeProcessPort(),
      spawn: spawnNativeNode,
      async taskkill(file, args, timeout) {
        const result = await execa(file, args, {
          timeout,
          windowsHide: true,
          shell: false,
          stdin: 'ignore',
          stdout: 'ignore',
          stderr: 'ignore',
          preferLocal: false,
          reject: false,
        });
        if (result.exitCode !== 0) throw new Error('Cleanup unconfirmed');
      },
    });
    void supervisor.settled.then(() => {
      if (process.connected) process.disconnect();
    });
  }
}
