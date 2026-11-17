import {
  createNativeSession,
  type INativeSessionSnapshot,
} from './native-session';
import type { INativeChild } from './native-console-supervisor';
import type {
  IWindowsNativeConsole,
  NativeIdentityResult,
} from '../../platform/windows/windows-native-console';

const identity = {
  jobId: '11111111-1111-4111-8111-111111111111',
  generation: 1,
};
const created = '2026-11-17T00:00:00.000Z';
const flush = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};
function setup(overrides?: { beforeInit?: () => Promise<void> }) {
  let receive!: (raw: unknown) => void;
  let disconnect!: () => void;
  let exit!: (code: number | null, signal: string | null) => void;
  let processExit!: () => void;
  const order: string[] = [];
  const remove = jest.fn();
  const child = {
    pid: 10,
    send: jest.fn((f) => {
      order.push(`send:${f.type}`);
    }),
    disconnect: jest.fn(),
    onMessage: (fn) => {
      receive = fn;
      return remove;
    },
    onDisconnect: (fn) => {
      disconnect = fn;
      return remove;
    },
    onExit: (fn) => {
      exit = fn;
      return remove;
    },
  } satisfies INativeChild;
  const preflight = {
    execPath: 'C:\\node\\node.exe',
    supervisorFile:
      'C:\\api\\dist\\npm-runner\\native-session\\native-console-supervisor.js',
    bridgeFile:
      'C:\\api\\dist\\npm-runner\\native-session\\native-console-entry.js',
    shell: 'cmd' as const,
    shellFile: 'C:\\Windows\\System32\\cmd.exe',
    shellArgs: ['/d'],
    systemRoot: 'C:\\Windows',
    files: [],
  };
  const platform = {
    revalidate: jest.fn().mockResolvedValue(true),
    capture: jest.fn(
      (
        pid: number,
        executablePath: string,
        parentPid: number,
      ): Promise<NativeIdentityResult> =>
        Promise.resolve({
          status: 'ok',
          identity: { pid, executablePath, parentPid, creationTime: created },
        }),
    ),
    descendants: jest.fn(
      (...args: Parameters<IWindowsNativeConsole['descendants']>) => {
        void args;
        return Promise.resolve({ status: 'ok', identities: [] });
      },
    ),
    stopTree: jest.fn().mockResolvedValue('attempted'),
    verifyGone: jest.fn().mockResolvedValue('verified'),
  };
  const snapshots: INativeSessionSnapshot[] = [];
  const persist = jest.fn((snapshot: INativeSessionSnapshot) => {
    order.push(`persist:${snapshot.phase}`);
    snapshots.push(snapshot);
    return Promise.resolve();
  });
  const callbacks = {
    onState: jest.fn(),
    onInitSent: jest.fn(),
    onInitialSpawned: jest.fn(),
    onInitialOutcome: jest.fn(),
    onSettled: jest.fn(() => {
      order.push('settled');
    }),
  };
  const timers: { callback: () => void; ms: number; cleared: boolean }[] = [];
  const spawn = jest.fn(() => {
    order.push('spawn');
    return child;
  });
  const session = createNativeSession(
    {
      platform: platform as unknown as IWindowsNativeConsole,
      spawn,
      writeIntent: jest.fn(() => {
        order.push('intent');
        return Promise.resolve();
      }),
      ...(overrides?.beforeInit ? { beforeInit: overrides.beforeInit } : {}),
      persist,
      callbacks,
      onProcessExit: (fn) => {
        processExit = fn;
        return remove;
      },
      setTimer: (callback, ms) => {
        const timer = { callback, ms, cleared: false };
        timers.push(timer);
        return timer as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: (timer) => {
        (timer as unknown as { cleared: boolean }).cleared = true;
      },
    },
    {
      identity,
      apiPid: 1,
      fingerprint: 'fingerprint',
      preflight,
      initialTimeoutMs: 30_000,
      init: {
        ...identity,
        type: 'init',
        initialFile: 'C:\\node\\node.exe',
        initialArgs: ['C:\\npm\\npm-cli.js'],
        cwd: 'C:\\project',
        env: { SECRET: 'never journal' },
        shell: 'cmd',
        shellFile: preflight.shellFile,
        shellArgs: ['/d'],
        shellEnv: {},
      },
    },
  );
  const message = async (frame: object) => {
    receive({ ...identity, ...frame });
    await flush();
  };
  const bridgeFrame = (frame: object) =>
    message({ type: 'bridge-frame', payload: { ...identity, ...frame } });
  const initial = async () => {
    await session.start();
    await message({ type: 'supervisor-ready' });
    await message({ type: 'bridge-spawned', pid: 20 });
    await bridgeFrame({ type: 'bridge-ready', pid: 20 });
    await bridgeFrame({ type: 'initial-spawned', pid: 30 });
  };
  return {
    session,
    initial,
    message,
    bridgeFrame,
    disconnect: () => disconnect(),
    exit: () => exit(1, null),
    processExit: () => processExit(),
    platform,
    child,
    persist,
    snapshots,
    order,
    callbacks,
    timers,
    spawn,
  };
}
describe('native session coordinator barriers', () => {
  it('accepts shell reuse of independently retired initial PID and cleans only the new identity', async () => {
    const s = setup();
    await s.initial();
    await s.bridgeFrame({ type: 'initial-result', exitCode: 0, signal: null });
    const initialIdentity = s.session.snapshot().identities.initial!;
    expect(s.session.snapshot().initialRetired).toBe(true);
    const shellIdentity = {
      pid: 30,
      executablePath: 'C:\\Windows\\System32\\cmd.exe',
      parentPid: 20,
      creationTime: '2026-11-17T00:00:01.000Z',
    };
    s.platform.capture.mockResolvedValueOnce({
      status: 'ok',
      identity: shellIdentity,
    });
    await s.bridgeFrame({ type: 'shell-spawned', pid: 30 });
    expect(s.session.snapshot()).toMatchObject({
      phase: 'shell_running',
      identities: { shell: shellIdentity },
    });
    expect(s.callbacks.onSettled).not.toHaveBeenCalled();
    s.platform.descendants.mockClear();
    s.platform.verifyGone.mockClear();
    await s.bridgeFrame({ type: 'session-exit', exitCode: 0, signal: null });
    expect(await s.session.settled).toMatchObject({
      phase: 'closed',
      termination: 'session_exit',
      cleanupVerified: true,
    });
    expect(s.platform.descendants).toHaveBeenCalledWith(
      expect.arrayContaining([shellIdentity]),
      [],
    );
    expect(s.platform.descendants).not.toHaveBeenCalledWith(
      expect.arrayContaining([initialIdentity]),
      expect.anything(),
    );
    expect(s.platform.verifyGone).toHaveBeenCalledWith(
      expect.arrayContaining([shellIdentity]),
    );
    expect(s.platform.verifyGone).not.toHaveBeenCalledWith(
      expect.arrayContaining([initialIdentity]),
    );
  });
  it('continues rejecting a PID assigned to an active bridge when capturing initial identity', async () => {
    const s = setup();
    await s.session.start();
    await s.message({ type: 'supervisor-ready' });
    await s.message({ type: 'bridge-spawned', pid: 20 });
    await s.bridgeFrame({ type: 'bridge-ready', pid: 20 });
    await s.bridgeFrame({ type: 'initial-spawned', pid: 20 });
    expect(await s.session.settled).toMatchObject({
      termination: 'protocol_error',
    });
    expect(s.session.snapshot().identities.initial).toBeUndefined();
    expect(
      s.child.send.mock.calls.some(([frame]) => frame.type === 'open-shell-go'),
    ).toBe(false);
  });
  it('journals launching before spawn and verified identities before commands; preserves nonzero initial separately', async () => {
    const s = setup();
    await s.initial();
    expect(s.order.slice(0, 3)).toEqual([
      'intent',
      'persist:launching',
      'spawn',
    ]);
    expect(s.order.indexOf('persist:supervisor_ready')).toBeLessThan(
      s.order.indexOf('send:spawn-bridge'),
    );
    expect(s.order.indexOf('persist:bridge_ready')).toBeLessThan(
      s.order.indexOf('send:init'),
    );
    expect(s.spawn).toHaveBeenCalledWith(
      'C:\\node\\node.exe',
      expect.any(Array),
      expect.objectContaining({ detached: true, windowsHide: true, ipc: true }),
    );
    await s.bridgeFrame({ type: 'initial-result', exitCode: 7, signal: null });
    expect(s.platform.verifyGone).toHaveBeenCalledWith([
      expect.objectContaining({ pid: 30 }),
    ]);
    expect(s.session.snapshot().initialRetired).toBe(true);
    expect(s.callbacks.onInitialOutcome).toHaveBeenCalledWith({
      exitCode: 7,
      signal: null,
    });
    expect(s.child.send).toHaveBeenLastCalledWith({
      ...identity,
      type: 'open-shell-go',
    });
    expect(s.callbacks.onSettled).not.toHaveBeenCalled();
    await s.bridgeFrame({ type: 'shell-spawned', pid: 40 });
    await s.bridgeFrame({ type: 'session-exit', exitCode: 0, signal: null });
    const result = await s.session.settled;
    expect(result).toMatchObject({
      initialOutcome: { exitCode: 7, signal: null },
      sessionOutcome: { exitCode: 0, signal: null },
      cleanupVerified: true,
      termination: 'session_exit',
    });
    expect(JSON.stringify(s.snapshots)).not.toContain('never journal');
    const lastSeeds = s.platform.descendants.mock.calls.at(-1)?.[0];
    expect(lastSeeds).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ pid: 30 })]),
    );
  });
  it('starts initial timeout only at init and never installs shell idle timeout', async () => {
    const s = setup();
    await s.session.start();
    expect(s.timers.some((t) => t.ms === 30_000)).toBe(false);
    await s.message({ type: 'supervisor-ready' });
    await s.message({ type: 'bridge-spawned', pid: 20 });
    await s.bridgeFrame({ type: 'bridge-ready', pid: 20 });
    const initialTimer = s.timers.find((t) => t.ms === 30_000)!;
    expect(initialTimer).toBeDefined();
    await s.bridgeFrame({ type: 'initial-spawned', pid: 30 });
    await s.bridgeFrame({ type: 'initial-result', exitCode: 0, signal: null });
    expect(initialTimer.cleared).toBe(true);
    await s.bridgeFrame({ type: 'shell-spawned', pid: 40 });
    expect(s.timers.filter((t) => !t.cleared)).toHaveLength(0);
    await s.session.stop('user_stop');
  });
  it('latches stop during durable persistence and drains it before settled callback', async () => {
    const s = setup();
    await s.initial();
    let release!: () => void;
    s.persist.mockImplementationOnce((snapshot) => {
      s.order.push(`pending:${snapshot.phase}`);
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const resultMessage = s.bridgeFrame({
      type: 'initial-result',
      exitCode: 0,
      signal: null,
    });
    await flush();
    const stopped = s.session.stop('user_stop');
    expect(s.callbacks.onSettled).not.toHaveBeenCalled();
    release();
    await resultMessage;
    await stopped;
    expect(
      s.child.send.mock.calls.some(([f]) => f.type === 'open-shell-go'),
    ).toBe(false);
    expect(s.order.at(-1)).toBe('settled');
    const writes = s.persist.mock.calls.length;
    await s.bridgeFrame({ type: 'shell-spawned', pid: 40 });
    expect(s.persist).toHaveBeenCalledTimes(writes);
  });
  it('cross-checks bridge-ready PID and rejects unconfirmed initial cleanup without opening shell', async () => {
    const s = setup();
    await s.session.start();
    await s.message({ type: 'supervisor-ready' });
    await s.message({ type: 'bridge-spawned', pid: 20 });
    await s.bridgeFrame({ type: 'bridge-ready', pid: 21 });
    expect((await s.session.settled).termination).toBe('protocol_error');
    expect(s.child.send.mock.calls.some(([f]) => f.type === 'init')).toBe(
      false,
    );
    const other = setup();
    await other.initial();
    other.platform.verifyGone.mockResolvedValue('unconfirmed');
    await other.bridgeFrame({
      type: 'initial-result',
      exitCode: 1,
      signal: null,
    });
    expect(await other.session.settled).toMatchObject({
      phase: 'lost',
      cleanupVerified: false,
    });
    expect(
      other.child.send.mock.calls.some(([f]) => f.type === 'open-shell-go'),
    ).toBe(false);
  });
  it('fences early disconnect while supervisor identity journal is in flight', async () => {
    const s = setup();
    let release!: () => void;
    s.persist
      .mockImplementationOnce(() => Promise.resolve())
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
    const start = s.session.start();
    await flush();
    s.disconnect();
    await flush();
    expect(s.callbacks.onSettled).not.toHaveBeenCalled();
    release();
    await start;
    await s.session.settled;
    expect(
      s.child.send.mock.calls.some(([f]) => f.type === 'spawn-bridge'),
    ).toBe(false);
    expect(s.child.disconnect).toHaveBeenCalled();
  });
  it('process exit only disconnects IPC synchronously so supervisor can finish its cleanup', async () => {
    const s = setup();
    await s.session.start();
    s.processExit();
    expect(s.child.disconnect).toHaveBeenCalledTimes(1);
    expect(s.platform.stopTree).not.toHaveBeenCalled();
    await s.session.stop('parent_exit');
  });
  it('reports unknown cleanup if a spawned supervisor cannot be identified', async () => {
    const s = setup();
    s.platform.capture.mockResolvedValue({ status: 'unknown' } as never);
    await s.session.start();
    expect(await s.session.settled).toMatchObject({
      phase: 'lost',
      cleanupVerified: false,
    });
    expect(s.child.disconnect).toHaveBeenCalled();
  });
  it('never spawns after launching journal failure and reports journal failure truthfully', async () => {
    const s = setup();
    s.persist.mockRejectedValueOnce(new Error('disk full'));
    await s.session.start();
    expect(s.spawn).not.toHaveBeenCalled();
    expect(await s.session.settled).toMatchObject({
      phase: 'lost',
      termination: 'journal_failed',
    });
  });
  it('initial timeout latches synchronously before a late successful result can open the shell', async () => {
    const s = setup();
    await s.initial();
    const timer = s.timers.find((entry) => entry.ms === 30_000)!;
    timer.callback();
    await s.bridgeFrame({ type: 'initial-result', exitCode: 0, signal: null });
    expect(await s.session.settled).toMatchObject({
      termination: 'initial_timeout',
    });
    expect(
      s.child.send.mock.calls.some(([frame]) => frame.type === 'open-shell-go'),
    ).toBe(false);
  });
  it('stops before sending init or arming initial timer when beforeInit rejects', async () => {
    const beforeInit = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error('INPUT_CHANGED'));
    const s = setup({ beforeInit });
    await s.session.start();
    await s.message({ type: 'supervisor-ready' });
    await s.message({ type: 'bridge-spawned', pid: 20 });
    await s.bridgeFrame({ type: 'bridge-ready', pid: 20 });
    expect(beforeInit).toHaveBeenCalledTimes(1);
    expect(await s.session.settled).toMatchObject({
      phase: 'closed',
      termination: 'start_failed',
      cleanupVerified: true,
      initialOutcome: null,
    });
    expect(
      s.child.send.mock.calls.some(
        ([frame]) => frame.type === 'init' || frame.type === 'open-shell-go',
      ),
    ).toBe(false);
    expect(s.timers.some((entry) => entry.ms === 30_000)).toBe(false);
    expect(s.callbacks.onInitSent).not.toHaveBeenCalled();
  });
  it('does not send init if user stops while beforeInit is pending', async () => {
    let release!: () => void;
    const beforeInit = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const s = setup({ beforeInit });
    await s.session.start();
    await s.message({ type: 'supervisor-ready' });
    await s.message({ type: 'bridge-spawned', pid: 20 });
    const readyPromise = s.bridgeFrame({ type: 'bridge-ready', pid: 20 });
    await flush();
    expect(beforeInit).toHaveBeenCalledTimes(1);
    const stopPromise = s.session.stop('user_stop');
    release();
    await readyPromise;
    expect(await stopPromise).toMatchObject({
      termination: 'user_stop',
      cleanupVerified: true,
    });
    expect(
      s.child.send.mock.calls.some(([frame]) => frame.type === 'init'),
    ).toBe(false);
    expect(s.callbacks.onInitSent).not.toHaveBeenCalled();
  });
  it('notifies onInitSent and onInitialSpawned even when initial identity capture fails unknown', async () => {
    const s = setup();
    await s.session.start();
    await s.message({ type: 'supervisor-ready' });
    await s.message({ type: 'bridge-spawned', pid: 20 });
    await s.bridgeFrame({ type: 'bridge-ready', pid: 20 });
    expect(s.callbacks.onInitSent).toHaveBeenCalledTimes(1);
    s.platform.capture.mockResolvedValueOnce({ status: 'unknown' });
    await s.bridgeFrame({ type: 'initial-spawned', pid: 30 });
    expect(s.callbacks.onInitialSpawned).toHaveBeenCalledWith(30);
    expect(await s.session.settled).toMatchObject({
      termination: 'start_failed',
      cleanupVerified: true,
    });
  });
  it('supports retryCleanup after unconfirmed cleanup and handles fast session-exit during shell capture', async () => {
    const s = setup();
    await s.session.start();
    await s.message({ type: 'supervisor-ready' });
    await s.message({ type: 'bridge-spawned', pid: 20 });
    await s.bridgeFrame({ type: 'bridge-ready', pid: 20 });
    await s.bridgeFrame({ type: 'initial-spawned', pid: 30 });
    await s.bridgeFrame({
      type: 'initial-result',
      exitCode: 0,
      signal: null,
    });

    let releaseCapture!: () => void;
    const pendingCapture = new Promise<void>((resolve) => {
      releaseCapture = resolve;
    });
    s.platform.capture.mockImplementationOnce(async (pid, file, parentPid) => {
      await pendingCapture;
      return {
        status: 'ok' as const,
        identity: {
          pid,
          creationTime: String(pid * 100),
          executablePath: file,
          parentPid,
        },
      };
    });
    void s.bridgeFrame({ type: 'shell-spawned', pid: 40 });
    await Promise.resolve();
    void s.bridgeFrame({ type: 'session-exit', exitCode: 0, signal: null });
    s.platform.verifyGone
      .mockResolvedValueOnce('present')
      .mockResolvedValueOnce('verified');

    releaseCapture();
    const first = await s.session.settled;
    expect(first).toMatchObject({
      phase: 'lost',
      termination: 'termination_unconfirmed',
      cleanupVerified: false,
      sessionOutcome: { exitCode: 0, signal: null },
    });

    const retried = await s.session.retryCleanup!();
    expect(retried).toMatchObject({
      phase: 'closed',
      termination: 'session_exit',
      cleanupVerified: true,
      sessionOutcome: { exitCode: 0, signal: null },
    });
    expect(s.session.snapshot().phase).toBe('closed');
  });
});
