import {
  createNativeConsoleSupervisor,
  nativeLaunchOptions,
  nativeProcessPort,
  spawnNativeNode,
  type INativeChild,
  type INativeParentPort,
} from './native-console-supervisor';
import { EventEmitter } from 'node:events';
import { execa } from 'execa';
jest.mock('execa', () => ({ execa: jest.fn() }));
import type {
  NativeCoordinatorCommand,
  NativeSupervisorFrame,
} from './native-protocol';

const identity = {
  jobId: '11111111-1111-4111-8111-111111111111',
  generation: 1,
};
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function setup(parent?: INativeParentPort) {
  let message!: (raw: unknown) => void;
  let disconnect!: () => void;
  let childMessage!: (raw: unknown) => void;
  let childExit!: (code: number | null, signal: string | null) => void;
  let childDisconnect!: () => void;
  const remove = jest.fn();
  const child = {
    pid: 20,
    send: jest.fn(),
    disconnect: jest.fn(),
    onMessage: (fn) => {
      childMessage = fn;
      return remove;
    },
    onExit: (fn) => {
      childExit = fn;
      return remove;
    },
    onDisconnect: (fn) => {
      childDisconnect = fn;
      return remove;
    },
  } satisfies INativeChild;
  const send = jest.fn((frame: NativeSupervisorFrame) => {
    void frame;
  });
  const spawn = jest.fn().mockReturnValue(child);
  const taskkill = jest.fn().mockResolvedValue(undefined);
  const stat = {
    dev: 1,
    ino: 1,
    size: 1,
    mtimeMs: 1,
    ctimeMs: 1,
    isFile: () => true,
    isSymbolicLink: () => false,
  };
  const fs = {
    lstat: jest.fn().mockResolvedValue(stat),
    realpath: jest.fn((file: string) => Promise.resolve(file)),
  };
  const supervisor = createNativeConsoleSupervisor({
    identity,
    execPath: 'C:\\node\\node.exe',
    entryDir: 'C:\\PkgSteward\\dist\\npm-runner\\native-session',
    systemRoot: 'C:\\Windows',
    fs,
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
    spawn,
    taskkill,
  });
  const request = (frame: object) => message({ ...identity, ...frame });
  return {
    supervisor,
    request,
    disconnect: () => disconnect(),
    childMessage: (raw: unknown) => childMessage(raw),
    childExit: (code: number | null) => childExit(code, null),
    childDisconnect: () => childDisconnect(),
    child,
    spawn,
    taskkill,
    send,
    fs,
  };
}
describe('native supervisor', () => {
  it('latches asynchronous parent send failure while connected, awaits one bridge cleanup and removes listeners', async () => {
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
    const s = setup(nativeProcessPort(target));
    expect(callbacks).toHaveLength(1);
    target.emit('message', {
      ...identity,
      type: 'spawn-bridge',
      execPath: 'C:\\node\\node.exe',
    });
    await flush();
    target.emit('message', {
      ...identity,
      type: 'init',
      initialFile: 'C:\\node\\node.exe',
      initialArgs: [],
      cwd: 'C:\\project',
      env: {},
      shell: 'cmd',
      shellFile: 'C:\\Windows\\System32\\cmd.exe',
      shellArgs: ['/d'],
      shellEnv: {},
    });
    await flush();
    expect(s.child.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'init' }),
    );
    let release!: () => void;
    s.taskkill.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    s.childMessage({
      ...identity,
      type: 'initial-result',
      exitCode: 0,
      signal: null,
    });
    const failure = callbacks.at(-1)!;
    expect(() => failure(new Error('EPIPE'))).not.toThrow();
    // Failure latch must fence this valid late go before any queued cleanup runs.
    target.emit('message', { ...identity, type: 'open-shell-go' });
    failure(new Error('EPIPE duplicate'));
    target.emit('disconnect');
    await flush();
    expect(target.connected).toBe(true);
    expect(
      s.child.send.mock.calls.some(
        ([frame]) =>
          (frame as NativeCoordinatorCommand).type === 'open-shell-go',
      ),
    ).toBe(false);
    expect(s.taskkill).toHaveBeenCalledTimes(1);
    const settled = jest.fn();
    void s.supervisor.settled.then(settled);
    await flush();
    expect(settled).not.toHaveBeenCalled();
    release();
    await s.supervisor.settled;
    expect(target.listenerCount('message')).toBe(0);
    expect(target.listenerCount('disconnect')).toBe(0);
    failure(new Error('late callback'));
    await flush();
    expect(s.taskkill).toHaveBeenCalledTimes(1);
  });
  it('adapts execa10 native child IPC/events and consumes send errors', () => {
    const native = Object.assign(new EventEmitter(), {
      connected: true,
      send: jest.fn(),
      disconnect: jest.fn(),
    });
    const result = Object.assign(Promise.resolve({ exitCode: 0 }), {
      pid: 12,
      nodeChildProcess: native,
    });
    jest.mocked(execa).mockReturnValue(result as never);
    const child = spawnNativeNode(
      'C:\\node\\node.exe',
      [],
      nativeLaunchOptions('C:\\Windows', true),
    );
    const received = jest.fn();
    const exited = jest.fn();
    const remove = child.onMessage(received);
    child.onExit(exited);
    native.emit('message', { value: true });
    expect(received).toHaveBeenCalledWith({ value: true });
    child.send({ ...identity, type: 'stop' });
    expect(native.send).toHaveBeenCalled();
    native.emit('exit', 0, null);
    native.emit('error', new Error('late'));
    expect(exited).toHaveBeenCalledTimes(1);
    remove();
    expect(native.listenerCount('message')).toBe(0);
  });
  it('derives sibling bridge and launches an attached visible bridge with isolated IPC', async () => {
    const s = setup();
    s.request({ type: 'spawn-bridge', execPath: 'C:\\node\\node.exe' });
    await flush();
    expect(s.spawn).toHaveBeenCalledWith(
      'C:\\node\\node.exe',
      [
        'C:\\PkgSteward\\dist\\npm-runner\\native-session\\native-console-entry.js',
        identity.jobId,
        '1',
      ],
      expect.objectContaining({
        detached: false,
        windowsHide: false,
        ipc: true,
        shell: false,
        extendEnv: false,
        env: { SystemRoot: 'C:\\Windows', Path: 'C:\\Windows\\System32' },
      }),
    );
    expect(s.send).toHaveBeenCalledWith({
      ...identity,
      type: 'bridge-spawned',
      pid: 20,
    });
    const frame = { ...identity, type: 'bridge-ready', pid: 20 };
    s.childMessage(frame);
    expect(s.send).toHaveBeenLastCalledWith({
      ...identity,
      type: 'bridge-frame',
      payload: frame,
    });
    s.childExit(0);
    await s.supervisor.settled;
  });
  it('awaits taskkill before settling on parent disconnect, including a child born during disconnect', async () => {
    const s = setup();
    let release!: () => void;
    s.taskkill.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    s.spawn.mockImplementation(() => {
      s.disconnect();
      return s.child;
    });
    s.request({ type: 'spawn-bridge', execPath: 'C:\\node\\node.exe' });
    await flush();
    expect(s.taskkill).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\taskkill.exe',
      ['/PID', '20', '/T', '/F'],
      10_000,
    );
    const settled = jest.fn();
    void s.supervisor.settled.then(settled);
    await flush();
    expect(settled).not.toHaveBeenCalled();
    release();
    await s.supervisor.settled;
    expect(s.child.send).toHaveBeenCalledWith({
      ...identity,
      type: 'stop',
    } satisfies NativeCoordinatorCommand);
  });
  it('rejects bridge envelope spoofing instead of forwarding coordinator lifecycle events', async () => {
    const s = setup();
    s.request({ type: 'spawn-bridge', execPath: 'C:\\node\\node.exe' });
    await flush();
    s.childMessage({ ...identity, type: 'bridge-spawned', pid: 99 });
    await flush();
    expect(s.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'supervisor-error',
        code: 'PROTOCOL_ERROR',
      }),
    );
    await s.supervisor.settled;
    expect(s.taskkill).toHaveBeenCalledTimes(1);
  });
  it('never launches after stop during entry validation', async () => {
    const s = setup();
    s.request({ type: 'spawn-bridge', execPath: 'C:\\node\\node.exe' });
    s.request({ type: 'stop' });
    await s.supervisor.settled;
    expect(s.spawn).not.toHaveBeenCalled();
  });
  it('allows normal bridge disconnect after its session-exit without a false supervisor error', async () => {
    const s = setup();
    s.request({ type: 'spawn-bridge', execPath: 'C:\\node\\node.exe' });
    await flush();
    s.childMessage({
      ...identity,
      type: 'session-exit',
      exitCode: 0,
      signal: null,
    });
    s.childDisconnect();
    s.childExit(0);
    await s.supervisor.settled;
    expect(
      s.send.mock.calls.some(([frame]) => frame.type === 'supervisor-error'),
    ).toBe(false);
  });
});
