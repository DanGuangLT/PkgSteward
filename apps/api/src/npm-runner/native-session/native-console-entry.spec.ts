import {
  createNativeConsoleBridge,
  spawnNativeInitial,
  spawnNativeShell,
  type INativeConsoleChild,
} from './native-console-entry';
import { execa } from 'execa';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  nativeProcessPort,
  type INativeParentPort,
} from './native-console-supervisor';
jest.mock('execa', () => ({ execa: jest.fn() }));
jest.mock('node:child_process', () => ({ spawn: jest.fn() }));
import type { INativeInitCommand, NativeBridgeFrame } from './native-protocol';

const identity = {
  jobId: '11111111-1111-4111-8111-111111111111',
  generation: 1,
};
const init: INativeInitCommand = {
  ...identity,
  type: 'init',
  initialFile: 'C:\\node\\node.exe',
  initialArgs: ['C:\\npm\\npm-cli.js', 'test'],
  cwd: 'C:\\project',
  env: {
    PATH: 'C:\\node',
    NODE_OPTIONS: 'bad',
    NODE_CHANNEL_FD: '4',
    PKGSTEWARD_DATA_DIR: 'private',
    PKGSTEWARD_SPIKE_SECRET: 'private',
    PKGSTEWARD_RUNNER_NPM10_INSTALL_COMPAT: 'marker',
  },
  shell: 'cmd',
  shellFile: 'C:\\Windows\\System32\\cmd.exe',
  shellArgs: ['/d'],
  shellEnv: {
    PATH: 'C:\\node',
    USERPROFILE: 'C:\\user',
    CI: '1',
    PKGSTEWARD_SECRET: 'private',
  },
};
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function setup(tty = true, parent?: INativeParentPort) {
  let message!: (raw: unknown) => void;
  let disconnect!: () => void;
  let initialDone!: (outcome: {
    exitCode: number | null;
    signal: string | null;
  }) => void;
  let shellDone!: (outcome: {
    exitCode: number | null;
    signal: string | null;
  }) => void;
  const initial = {
    pid: 30,
    outcome: new Promise((resolve) => {
      initialDone = resolve;
    }),
    kill: jest.fn(),
  } satisfies INativeConsoleChild;
  const shell: INativeConsoleChild = {
    pid: 40,
    outcome: new Promise((resolve) => {
      shellDone = resolve;
    }),
    kill: jest.fn(),
  };
  const events: string[] = [];
  const remove = jest.fn();
  const fs = {
    openSync: jest
      .fn()
      .mockImplementationOnce(() => {
        events.push('open');
        return 10;
      })
      .mockReturnValueOnce(11),
    closeSync: jest.fn(),
  };
  const spawnInitial = jest.fn().mockReturnValue(initial);
  const spawnShell = jest.fn().mockReturnValue(shell);
  const send = jest.fn((frame: NativeBridgeFrame) => {
    void frame;
  });
  const bridge = createNativeConsoleBridge({
    identity,
    pid: 20,
    systemRoot: 'C:\\Windows',
    fs,
    isatty: () => tty,
    registerSignal: (signal) => {
      events.push(signal);
      return remove;
    },
    parent: parent ?? {
      send,
      onMessage: (fn) => {
        message = fn;
        return remove;
      },
      onDisconnect: (fn) => {
        disconnect = fn;
        return remove;
      },
    },
    spawnInitial,
    spawnShell,
  });
  return {
    bridge,
    message: (raw: unknown) => message(raw),
    disconnect: () => disconnect(),
    send,
    fs,
    events,
    spawnInitial,
    spawnShell,
    initial,
    initialDone,
    shellDone,
    remove,
  };
}
describe('native console bridge', () => {
  it('turns asynchronous parent-send failure into child stop and FD cleanup without an unhandled error', async () => {
    const callbacks: ((error: Error | null) => void)[] = [];
    const target = Object.assign(new EventEmitter(), {
      connected: true,
      send: jest.fn(
        (frame: unknown, callback?: (error: Error | null) => void) => {
          void frame;
          if (callback) callbacks.push(callback);
          return true;
        },
      ),
    });
    const s = setup(true, nativeProcessPort(target));
    expect(callbacks).toHaveLength(1);
    target.emit('message', init);
    expect(s.spawnInitial).toHaveBeenCalledTimes(1);
    const failed = callbacks.at(-1)!;
    expect(() => failed(new Error('EPIPE'))).not.toThrow();
    // Failure must synchronously latch and release owned resources.
    expect(s.initial.kill).toHaveBeenCalledTimes(1);
    expect(s.fs.closeSync.mock.calls).toEqual([[10], [11]]);
    failed(new Error('duplicate'));
    target.emit('disconnect');
    s.initialDone({ exitCode: 0, signal: null });
    await s.bridge.settled;
    target.emit('message', { ...identity, type: 'open-shell-go' });
    expect(s.spawnShell).not.toHaveBeenCalled();
    expect(s.initial.kill).toHaveBeenCalledTimes(1);
    expect(target.listenerCount('message')).toBe(0);
    expect(target.listenerCount('disconnect')).toBe(0);
  });
  it('passes arbitrary raw console FDs to execa10 without creating streams', async () => {
    const result = Object.assign(
      Promise.resolve({ exitCode: 0, signal: null }),
      { pid: 3, kill: jest.fn() },
    );
    jest.mocked(execa).mockReturnValue(result as never);
    const child = spawnNativeInitial(init.initialFile, [], {
      cwd: init.cwd,
      env: {},
      stdin: 20,
      stdout: 21,
      stderr: 21,
      shell: false,
      extendEnv: false,
      detached: false,
      windowsHide: false,
    });
    expect(execa).toHaveBeenCalledWith(
      init.initialFile,
      [],
      expect.objectContaining({
        stdin: 20,
        stdout: 21,
        stderr: 21,
      }),
    );
    expect(await child.outcome).toEqual({ exitCode: 0, signal: null });
  });
  it('spawns shell directly with exact args and handles asynchronous spawn failure', async () => {
    const native = Object.assign(new EventEmitter(), {
      pid: undefined,
      kill: jest.fn(),
    });
    jest.mocked(spawn).mockReturnValue(native as never);
    const options = {
      cwd: init.cwd,
      env: {},
      stdio: [20, 21, 21] as [number, number, number],
      shell: false as const,
      detached: false as const,
      windowsHide: false as const,
    };
    const child = spawnNativeShell(init.shellFile, ['/d'], options);
    expect(spawn).toHaveBeenCalledWith(init.shellFile, ['/d'], options);
    native.emit('error', new Error('spawn denied'));
    await expect(child.outcome).rejects.toThrow('spawn denied');
  });
  it.each([2, -1, 3.5, NaN, 2 ** 31])(
    'rejects invalid native descriptor %s before calling execa',
    (fd) => {
      jest.mocked(execa).mockClear();
      expect(() =>
        spawnNativeInitial(init.initialFile, [], {
          cwd: init.cwd,
          env: {},
          stdin: fd,
          stdout: 21,
          stderr: 21,
          shell: false,
          extendEnv: false,
          detached: false,
          windowsHide: false,
        }),
      ).toThrow();
      expect(execa).not.toHaveBeenCalled();
    },
  );
  it('installs both signal handlers before opening r+ raw TTY descriptors and closes on failure', async () => {
    const s = setup(false);
    expect(s.events).toEqual(['SIGINT', 'SIGBREAK', 'open']);
    expect(s.fs.openSync.mock.calls).toEqual([
      ['\\\\.\\CONIN$', 'r+'],
      ['\\\\.\\CONOUT$', 'r+'],
    ]);
    expect(s.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'bridge-error',
        code: 'CONSOLE_UNAVAILABLE',
      }),
    );
    await s.bridge.settled;
    expect(s.fs.closeSync.mock.calls).toEqual([[10], [11]]);
    expect(s.spawnInitial).not.toHaveBeenCalled();
  });
  it('holds a nonzero command result until explicit go, then opens exact interactive shell without /q', async () => {
    const s = setup();
    s.message(init);
    expect(s.spawnInitial).toHaveBeenCalledWith(
      init.initialFile,
      init.initialArgs,
      expect.objectContaining({
        stdin: 10,
        stdout: 11,
        stderr: 11,
        shell: false,
        extendEnv: false,
        env: {
          PATH: 'C:\\node',
          PKGSTEWARD_RUNNER_NPM10_INSTALL_COMPAT: 'marker',
        },
      }),
    );
    s.initialDone({ exitCode: 7, signal: null });
    await flush();
    expect(s.send).toHaveBeenLastCalledWith({
      ...identity,
      type: 'initial-result',
      exitCode: 7,
      signal: null,
    });
    expect(s.spawnShell).not.toHaveBeenCalled();
    s.message({ ...identity, type: 'open-shell-go' });
    expect(s.spawnShell).toHaveBeenCalledWith(
      init.shellFile,
      ['/d'],
      expect.objectContaining({
        stdio: [10, 11, 11],
        detached: false,
        windowsHide: false,
        shell: false,
        env: { PATH: 'C:\\node', USERPROFILE: 'C:\\user' },
      }),
    );
    expect(s.send).toHaveBeenLastCalledWith({
      ...identity,
      type: 'shell-spawned',
      pid: 40,
    });
    s.shellDone({ exitCode: 0, signal: null });
    await s.bridge.settled;
    expect(s.send).toHaveBeenLastCalledWith({
      ...identity,
      type: 'session-exit',
      exitCode: 0,
      signal: null,
    });
    expect(s.fs.closeSync).toHaveBeenCalledTimes(2);
  });
  it('rejects premature go and arbitrary shell arguments', async () => {
    const s = setup();
    s.message({ ...identity, type: 'open-shell-go' });
    await s.bridge.settled;
    expect(s.spawnShell).not.toHaveBeenCalled();
    const other = setup();
    other.message({ ...init, shellArgs: ['/d', '/c', 'evil'] });
    await other.bridge.settled;
    expect(other.spawnInitial).not.toHaveBeenCalled();
    expect(other.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'bridge-error', code: 'PROTOCOL_ERROR' }),
    );
  });
  it('latches disconnect before initial completion and cannot reopen shell', async () => {
    const s = setup();
    s.message(init);
    s.disconnect();
    s.initialDone({ exitCode: 0, signal: null });
    await s.bridge.settled;
    s.message({ ...identity, type: 'open-shell-go' });
    expect(s.initial.kill).toHaveBeenCalledTimes(1);
    expect(s.spawnShell).not.toHaveBeenCalled();
    expect(s.send.mock.calls.some(([f]) => f.type === 'initial-result')).toBe(
      false,
    );
  });
  it('does not leak console descriptors if disconnect arrives inside openSync', async () => {
    let disconnect!: () => void;
    const closeSync = jest.fn();
    const send = jest.fn();
    const spawnInitial = jest.fn();
    const bridge = createNativeConsoleBridge({
      identity,
      pid: 20,
      systemRoot: 'C:\\Windows',
      parent: {
        send,
        onMessage: () => () => undefined,
        onDisconnect: (fn) => {
          disconnect = fn;
          return () => undefined;
        },
      },
      registerSignal: () => () => undefined,
      isatty: () => true,
      fs: {
        openSync: jest.fn(() => {
          disconnect();
          return 15;
        }),
        closeSync,
      },
      spawnInitial,
      spawnShell: jest.fn(),
    });
    await bridge.settled;
    expect(closeSync).toHaveBeenCalledWith(15);
    expect(send).not.toHaveBeenCalled();
    expect(spawnInitial).not.toHaveBeenCalled();
  });
});
