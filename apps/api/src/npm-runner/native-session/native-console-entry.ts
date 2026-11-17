import 'reflect-metadata';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { isatty } from 'node:tty';
import { win32 } from 'node:path';
import { execa } from 'execa';
import type { Options } from 'execa';
import type {
  INativeInitCommand,
  INativeSessionIdentity,
  NativeBridgeFrame,
} from '@/npm-runner/native-session/native-protocol';
import {
  parseSupervisorToBridgeFrame,
  NativeProtocolError,
  sanitizeInitialEnv,
  sanitizeShellEnv,
} from '@/npm-runner/native-session/native-protocol';
import type {
  INativeExitOutcome,
  INativeParentPort,
} from '@/npm-runner/native-session/native-console-supervisor';
import {
  nativeCliIdentity,
  nativeProcessPort,
} from '@/npm-runner/native-session/native-console-supervisor';
import { buildInteractiveShellEnv } from '@/npm-runner/toolchain/runner-environment';
import { windowsSystemRoot } from '@/platform/windows/windows-process-snapshot';
import { toComparable } from '@/common/utils/path.util';

export interface INativeConsoleChild {
  readonly pid: number | undefined;
  outcome: Promise<INativeExitOutcome>;
  kill(): void;
}
export interface INativeInitialOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin: number;
  stdout: number;
  stderr: number;
  extendEnv: false;
  shell: false;
  detached: false;
  windowsHide: false;
}
export interface INativeShellOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdio: [number, number, number];
  shell: false;
  detached: false;
  windowsHide: false;
}
export interface INativeBridgeDeps {
  identity: INativeSessionIdentity;
  pid: number;
  systemRoot: string | undefined;
  parent: INativeParentPort;
  fs: Pick<typeof fs, 'openSync' | 'closeSync'>;
  isatty(fd: number): boolean;
  registerSignal(
    signal: 'SIGINT' | 'SIGBREAK',
    listener: () => void,
  ): () => void;
  spawnInitial(
    file: string,
    args: string[],
    options: INativeInitialOptions,
  ): INativeConsoleChild;
  spawnShell(
    file: string,
    args: string[],
    options: INativeShellOptions,
  ): INativeConsoleChild;
}
/** The shell alone uses direct spawn: execa's Windows cmd handling injects /q. */
export function spawnNativeShell(
  file: string,
  args: string[],
  options: INativeShellOptions,
): INativeConsoleChild {
  const child = spawn(file, args, options);
  return {
    get pid() {
      return child.pid;
    },
    kill() {
      child.kill();
    },
    outcome: new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (exitCode, signal) => {
        resolve({ exitCode, signal });
      });
    }),
  };
}
export function spawnNativeInitial(
  file: string,
  args: string[],
  options: INativeInitialOptions,
): INativeConsoleChild {
  if (
    ![options.stdin, options.stdout, options.stderr].every(
      (fd) => Number.isInteger(fd) && fd > 2 && fd <= 2 ** 31 - 1,
    )
  ) {
    throw new NativeProtocolError('INVALID_FRAME');
  }
  const execaOptions = {
    ...options,
    preferLocal: false,
    buffer: false,
    reject: false,
    verbose: 'none',
    cleanup: false,
    killDescendants: false,
  };
  // execa10 lib/stdio/handle.js validates native FDs up to 2^31-1, while
  // types/stdio/type.d.ts models only literals 0..9. Keep raw, validated FDs;
  // wrapping these console handles in streams changes Windows TTY behavior.
  const child = execa(file, args, execaOptions as unknown as Options);
  return {
    get pid() {
      return child.pid;
    },
    kill() {
      child.kill();
    },
    outcome: child.then((result) => ({
      exitCode: result.exitCode ?? null,
      signal: result.signal ?? null,
    })),
  };
}
export function createNativeConsoleBridge(deps: INativeBridgeDeps): {
  settled: Promise<INativeExitOutcome>;
} {
  let phase: 'console' | 'init' | 'initial' | 'go' | 'shell' | 'done' =
    'console';
  let stopped = false;
  let init: INativeInitCommand | null = null;
  let active: INativeConsoleChild | null = null;
  let input = -1;
  let output = -1;
  const fds = new Set<number>();
  const removers: (() => void)[] = [];
  let resolve!: (result: INativeExitOutcome) => void;
  const settled = new Promise<INativeExitOutcome>((done) => {
    resolve = done;
  });
  const send = (frame: NativeBridgeFrame) => {
    try {
      deps.parent.send(frame);
    } catch {
      stop();
    }
  };
  const finish = (outcome: INativeExitOutcome) => {
    if (phase === 'done') return;
    phase = 'done';
    for (const fd of fds) {
      try {
        deps.fs.closeSync(fd);
      } catch {
        /* descriptor already closed */
      }
    }
    fds.clear();
    for (const remove of removers.splice(0)) remove();
    resolve(outcome);
  };
  const stop = () => {
    if (stopped || phase === 'done') return;
    stopped = true;
    try {
      active?.kill();
    } catch {
      /* supervisor and API own verified subtree cleanup */
    }
    finish({ exitCode: null, signal: null });
  };
  const fail = (
    code:
      | 'CONSOLE_UNAVAILABLE'
      | 'START_FAILED'
      | 'PROTOCOL_ERROR'
      | 'WORKER_FAILED',
  ) => {
    send({
      ...deps.identity,
      type: 'bridge-error',
      code,
      message: 'Native console bridge failed',
    });
    stop();
  };
  const shellValid = (frame: INativeInitCommand): boolean => {
    const root = windowsSystemRoot(deps.systemRoot);
    if (!root) return false;
    const file =
      frame.shell === 'cmd'
        ? win32.join(root, 'System32', 'cmd.exe')
        : win32.join(
            root,
            'System32',
            'WindowsPowerShell',
            'v1.0',
            'powershell.exe',
          );
    const args = frame.shell === 'cmd' ? ['/d'] : ['-NoLogo', '-NoProfile'];
    return (
      toComparable(frame.shellFile, 'win32') === toComparable(file, 'win32') &&
      frame.shellArgs.length === args.length &&
      args.every((arg, index) => arg === frame.shellArgs[index])
    );
  };
  const start = (frame: INativeInitCommand, shell: boolean) => {
    try {
      let child: INativeConsoleChild;
      if (shell) {
        phase = 'shell';
        child = deps.spawnShell(frame.shellFile, frame.shellArgs, {
          cwd: frame.cwd,
          env: sanitizeShellEnv(buildInteractiveShellEnv(frame.shellEnv)),
          stdio: [input, output, output],
          shell: false,
          detached: false,
          windowsHide: false,
        });
      } else {
        phase = 'initial';
        const env = sanitizeInitialEnv(frame.env);
        for (const key of Object.keys(env))
          if (key.toUpperCase().startsWith('PKGSTEWARD_SPIKE_'))
            delete env[key];
        child = deps.spawnInitial(frame.initialFile, frame.initialArgs, {
          cwd: frame.cwd,
          env,
          stdin: input,
          stdout: output,
          stderr: output,
          shell: false,
          extendEnv: false,
          detached: false,
          windowsHide: false,
        });
      }
      active = child;
      // Consume the promise before any error path, including invalid/missing PID.
      void child.outcome.then(
        (outcome) => {
          if (active === child) active = null;
          if (stopped || phase === 'done') return;
          if (shell) {
            send({ ...deps.identity, type: 'session-exit', ...outcome });
            finish(outcome);
          } else {
            phase = 'go';
            send({ ...deps.identity, type: 'initial-result', ...outcome });
          }
        },
        () => {
          if (!stopped && phase !== 'done')
            fail(shell ? 'WORKER_FAILED' : 'START_FAILED');
        },
      );
      if (stopped) {
        try {
          child.kill();
        } catch {
          /* parent verifies */
        }
        return;
      }
      if (!Number.isSafeInteger(child.pid) || !child.pid || child.pid <= 0) {
        fail('START_FAILED');
        return;
      }
      send({
        ...deps.identity,
        type: shell ? 'shell-spawned' : 'initial-spawned',
        pid: child.pid,
      });
    } catch {
      fail('START_FAILED');
    }
  };
  // Ctrl+C and Ctrl+Break belong to the foreground program, not this bridge.
  removers.push(deps.registerSignal('SIGINT', () => undefined));
  removers.push(deps.registerSignal('SIGBREAK', () => undefined));
  removers.push(deps.parent.onDisconnect(stop));
  removers.push(
    deps.parent.onMessage((raw) => {
      if (stopped || phase === 'done') return;
      try {
        const frame = parseSupervisorToBridgeFrame(raw, deps.identity);
        if (frame.type === 'stop') {
          stop();
          return;
        }
        if (
          frame.type === 'init' &&
          phase === 'init' &&
          !init &&
          shellValid(frame)
        ) {
          init = frame;
          start(frame, false);
          return;
        }
        if (frame.type === 'open-shell-go' && phase === 'go' && init) {
          start(init, true);
          return;
        }
        fail('PROTOCOL_ERROR');
      } catch {
        fail('PROTOCOL_ERROR');
      }
    }),
  );
  try {
    for (const name of ['\\\\.\\CONIN$', '\\\\.\\CONOUT$']) {
      const fd = deps.fs.openSync(name, 'r+');
      if (!Number.isSafeInteger(fd) || fd <= 2 || fds.has(fd))
        throw new Error('Invalid console descriptor');
      if (stopped) {
        deps.fs.closeSync(fd);
        return { settled };
      }
      fds.add(fd);
      if (input === -1) input = fd;
      else output = fd;
    }
    if (!deps.isatty(input) || !deps.isatty(output))
      fail('CONSOLE_UNAVAILABLE');
    else {
      phase = 'init';
      send({ ...deps.identity, type: 'bridge-ready', pid: deps.pid });
    }
  } catch {
    fail('CONSOLE_UNAVAILABLE');
  }
  return { settled };
}
if (require.main === module) {
  const identity = nativeCliIdentity(process.argv.slice(2));
  if (!identity) process.exitCode = 1;
  else {
    const bridge = createNativeConsoleBridge({
      identity,
      pid: process.pid,
      systemRoot: process.env.SystemRoot,
      parent: nativeProcessPort(),
      fs,
      isatty,
      spawnInitial: spawnNativeInitial,
      spawnShell: spawnNativeShell,
      registerSignal(signal, fn) {
        process.on(signal, fn);
        return () => {
          process.off(signal, fn);
        };
      },
    });
    void bridge.settled.then((outcome) => {
      process.exitCode = outcome.exitCode ?? 1;
      if (process.connected) process.disconnect();
    });
  }
}
