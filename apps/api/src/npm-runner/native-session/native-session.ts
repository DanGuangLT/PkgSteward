import { AppException } from '@/common/exceptions/app.exception';
import type {
  INativeInitCommand,
  INativeSessionIdentity,
  NativeBridgeFrame,
  NativeCoordinatorCommand,
  NativeSupervisorFrame,
} from '@/npm-runner/native-session/native-protocol';
import {
  NativeCommandSequence,
  parseCoordinatorToSupervisorFrame,
  parseSupervisorToCoordinatorFrame,
} from '@/npm-runner/native-session/native-protocol';
import type {
  INativeChild,
  INativeExitOutcome,
  NativeNodeSpawn,
} from '@/npm-runner/native-session/native-console-supervisor';
import { nativeLaunchOptions } from '@/npm-runner/native-session/native-console-supervisor';
import type {
  INativeConsolePreflight,
  INativeProcessIdentity,
  IWindowsNativeConsole,
} from '@/platform/windows/windows-native-console';

export type NativeSessionPhase =
  | 'launching'
  | 'supervisor_ready'
  | 'bridge_starting'
  | 'bridge_ready'
  | 'initial_running'
  | 'initial_finished'
  | 'shell_starting'
  | 'shell_running'
  | 'stopping'
  | 'lost'
  | 'closed';
export type NativeTermination =
  | 'session_exit'
  | 'user_stop'
  | 'initial_timeout'
  | 'handshake_timeout'
  | 'parent_exit'
  | 'ipc_lost'
  | 'window_closed'
  | 'protocol_error'
  | 'start_failed'
  | 'journal_failed'
  | 'termination_unconfirmed';
export interface INativeSessionSnapshot extends INativeSessionIdentity {
  schema: 1;
  fingerprint: string;
  phase: NativeSessionPhase;
  entries: {
    execPath: string;
    supervisorFile: string;
    bridgeFile: string;
    shellFile: string;
  };
  identities: {
    supervisor?: INativeProcessIdentity;
    bridge?: INativeProcessIdentity;
    initial?: INativeProcessIdentity;
    shell?: INativeProcessIdentity;
  };
  tracked: INativeProcessIdentity[];
  initialRetired: boolean;
  initialOutcome: INativeExitOutcome | null;
  sessionOutcome: INativeExitOutcome | null;
  termination: NativeTermination | null;
}
export interface INativeSessionResult {
  phase: 'closed' | 'lost';
  termination: NativeTermination;
  initialOutcome: INativeExitOutcome | null;
  sessionOutcome: INativeExitOutcome | null;
  cleanupVerified: boolean;
}
export interface INativeSessionOptions {
  identity: INativeSessionIdentity;
  fingerprint: string;
  apiPid: number;
  preflight: INativeConsolePreflight;
  init: INativeInitCommand;
  initialTimeoutMs?: number;
  handshakeTimeoutMs?: number;
}
export interface INativeSessionCallbacks {
  onState?(snapshot: INativeSessionSnapshot): void;
  onInitSent?(): void;
  onInitialSpawned?(pid: number): void;
  onInitialOutcome?(outcome: INativeExitOutcome): void;
  onSettled?(result: INativeSessionResult): void;
}
export interface INativeSessionDeps {
  platform: IWindowsNativeConsole;
  spawn: NativeNodeSpawn;
  /** Service owns the intent audit; rejection must prevent every launch. */
  writeIntent(): Promise<void>;
  /** Optional pre-init revalidation after bridge handshake, before sending init. */
  beforeInit?(): Promise<void>;
  /** Resolves only after a durable write. No environment/typed commands supplied. */
  persist(snapshot: INativeSessionSnapshot): Promise<void>;
  callbacks?: INativeSessionCallbacks;
  /** Register synchronous process exit cleanup; never await work in an exit listener. */
  onProcessExit(listener: () => void): () => void;
  setTimer(
    callback: () => void,
    milliseconds: number,
  ): ReturnType<typeof setTimeout>;
  clearTimer(timer: ReturnType<typeof setTimeout>): void;
}
export interface INativeSession {
  start(): Promise<void>;
  stop(reason: NativeTermination): Promise<INativeSessionResult>;
  retryCleanup?(): Promise<INativeSessionResult>;
  settled: Promise<INativeSessionResult>;
  snapshot(): INativeSessionSnapshot;
}
class NativeSessionFault extends AppException {
  constructor(readonly termination: NativeTermination) {
    super(409, 'Native session could not continue', termination);
  }
}
function fault(reason: NativeTermination): never {
  throw new NativeSessionFault(reason);
}
const copyIdentity = (id: INativeProcessIdentity): INativeProcessIdentity => ({
  ...id,
});

/** Serialized lifecycle with synchronous stop latch and awaited journal barriers. */
export function createNativeSession(
  deps: INativeSessionDeps,
  options: INativeSessionOptions,
): INativeSession {
  const identity = { ...options.identity };
  const initFrame = parseCoordinatorToSupervisorFrame(options.init, identity);
  if (
    initFrame.type !== 'init' ||
    initFrame.shell !== options.preflight.shell ||
    initFrame.shellFile !== options.preflight.shellFile ||
    JSON.stringify(initFrame.shellArgs) !==
      JSON.stringify(options.preflight.shellArgs)
  )
    fault('protocol_error');
  const sequence = new NativeCommandSequence(identity);
  const state: INativeSessionSnapshot = {
    schema: 1,
    ...identity,
    fingerprint: options.fingerprint,
    phase: 'launching',
    entries: {
      execPath: options.preflight.execPath,
      supervisorFile: options.preflight.supervisorFile,
      bridgeFile: options.preflight.bridgeFile,
      shellFile: options.preflight.shellFile,
    },
    identities: {},
    tracked: [],
    initialRetired: false,
    initialOutcome: null,
    sessionOutcome: null,
    termination: null,
  };
  let child: INativeChild | null = null;
  let started = false;
  let stopped = false;
  let finished = false;
  let journalFailed = false;
  let supervisorReady = false;
  let bridgeReady = false;
  let spawnBridgeSent = false;
  let initSent = false;
  let shellGoSent = false;
  let cleanupRunning = false;
  let queue = Promise.resolve();
  let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  let initialTimer: ReturnType<typeof setTimeout> | undefined;
  const removers: (() => void)[] = [];
  let resolve!: (result: INativeSessionResult) => void;
  const settled = new Promise<INativeSessionResult>((done) => {
    resolve = done;
  });
  const snapshot = (): INativeSessionSnapshot => ({
    ...state,
    entries: { ...state.entries },
    identities: Object.fromEntries(
      Object.entries(state.identities).map(([key, value]) => [
        key,
        copyIdentity(value),
      ]),
    ),
    tracked: state.tracked.map(copyIdentity),
    initialOutcome: state.initialOutcome ? { ...state.initialOutcome } : null,
    sessionOutcome: state.sessionOutcome ? { ...state.sessionOutcome } : null,
  });
  const notifyState = () => {
    try {
      deps.callbacks?.onState?.(snapshot());
    } catch {
      /* observers do not change process ownership */
    }
  };
  const persist = async () => {
    try {
      await deps.persist(snapshot());
    } catch {
      journalFailed = true;
      fault('journal_failed');
    }
    notifyState();
  };
  const clearHandshake = () => {
    if (handshakeTimer !== undefined) deps.clearTimer(handshakeTimer);
    handshakeTimer = undefined;
  };
  const clearInitial = () => {
    if (initialTimer !== undefined) deps.clearTimer(initialTimer);
    initialTimer = undefined;
  };
  const liveSeeds = (): INativeProcessIdentity[] => {
    const ids = state.identities;
    return [
      ids.bridge,
      ...(state.initialRetired ? [] : [ids.initial]),
      ids.shell,
    ].filter((id): id is INativeProcessIdentity => !!id);
  };
  const allOwned = (): INativeProcessIdentity[] => {
    const ids = [
      state.identities.supervisor,
      ...liveSeeds(),
      ...state.tracked,
    ].filter((id): id is INativeProcessIdentity => !!id);
    return [
      ...new Map(
        ids.map((id) => [`${id.pid}:${id.creationTime}`, id]),
      ).values(),
    ];
  };
  const capture = async (
    role: keyof INativeSessionSnapshot['identities'],
    pid: number,
    file: string,
    parentPid: number,
  ) => {
    const result = await deps.platform.capture(pid, file, parentPid);
    if (result.status !== 'ok') fault('start_failed');
    if (
      Object.entries(state.identities).some(
        ([ownedRole, owned]) =>
          !(ownedRole === 'initial' && state.initialRetired) &&
          owned.pid === result.identity.pid,
      )
    )
      fault('protocol_error');
    state.identities[role] = result.identity;
  };
  const send = (frame: NativeCoordinatorCommand) => {
    if (stopped || finished) return;
    sequence.accept(frame);
    if (!child) fault('start_failed');
    child.send(frame);
  };
  let originalTermination: NativeTermination | null = null;
  const verifyCleanup = async (): Promise<boolean> => {
    try {
      const supervisor = state.identities.supervisor;
      const tree = await deps.platform.descendants(
        [...(supervisor ? [supervisor] : []), ...liveSeeds()],
        state.tracked,
      );
      if (tree.status !== 'ok') return false;
      state.tracked = tree.identities;
      try {
        await persist();
      } catch {
        /* no launch/go allowed after this point */
      }
      const attempt = await deps.platform.stopTree(liveSeeds(), state.tracked);
      return (
        (!child || !!supervisor) &&
        attempt === 'attempted' &&
        (await deps.platform.verifyGone(allOwned())) === 'verified'
      );
    } catch {
      return false;
    }
  };
  const applyCleanupOutcome = async (
    base: NativeTermination,
    verified: boolean,
  ): Promise<INativeSessionResult> => {
    state.phase = verified && !journalFailed ? 'closed' : 'lost';
    state.termination =
      !verified && base === 'session_exit' ? 'termination_unconfirmed' : base;
    try {
      await persist();
    } catch {
      state.phase = 'lost';
    }
    return {
      phase: state.phase === 'closed' ? 'closed' : 'lost',
      termination: journalFailed ? 'journal_failed' : state.termination,
      cleanupVerified: verified,
      initialOutcome: state.initialOutcome ? { ...state.initialOutcome } : null,
      sessionOutcome: state.sessionOutcome ? { ...state.sessionOutcome } : null,
    };
  };
  const finish = async (reason: NativeTermination) => {
    if (finished || cleanupRunning) return;
    cleanupRunning = true;
    stopped = true;
    const rawTermination = state.termination ?? reason;
    const base =
      rawTermination === 'window_closed' &&
      state.sessionOutcome &&
      state.identities.shell
        ? 'session_exit'
        : rawTermination;
    originalTermination ??= base;
    state.termination = base;
    state.phase = 'stopping';
    clearHandshake();
    clearInitial();
    try {
      await persist();
    } catch {
      /* still clean known handles after journal failure */
    }
    // Disconnect authorizes supervisor taskkill; do not kill the supervisor first.
    try {
      child?.send({ ...identity, type: 'stop' });
    } catch {
      /* disconnect fallback */
    }
    try {
      child?.disconnect();
    } catch {
      /* already closed */
    }
    const verified = await verifyCleanup();
    const result = await applyCleanupOutcome(originalTermination, verified);
    finished = true;
    for (const remove of removers.splice(0)) {
      try {
        remove();
      } catch {
        /* listener already removed */
      }
    }
    // No asynchronous writer remains: every message/persist uses the same queue.
    try {
      deps.callbacks?.onSettled?.(result);
    } catch {
      /* service observer isolated */
    }
    resolve(result);
  };
  const enqueue = (work: () => Promise<void>): Promise<void> => {
    queue = queue.then(async () => {
      if (finished) return;
      try {
        await work();
      } catch (error) {
        stopped = true;
        await finish(
          error instanceof NativeSessionFault
            ? error.termination
            : 'start_failed',
        );
      }
    });
    return queue;
  };
  const stop = (reason: NativeTermination): Promise<INativeSessionResult> => {
    if (!finished) {
      stopped = true;
      state.termination ??= reason;
      void enqueue(() => finish(reason));
    }
    return settled;
  };
  const armHandshake = () => {
    clearHandshake();
    handshakeTimer = deps.setTimer(
      () => {
        void stop('handshake_timeout');
      },
      Math.max(15_000, options.handshakeTimeoutMs ?? 15_000),
    );
  };
  const maybeSpawnBridge = async () => {
    if (
      stopped ||
      spawnBridgeSent ||
      !supervisorReady ||
      !state.identities.supervisor
    )
      return;
    state.phase = 'bridge_starting';
    await persist();
    if (stopped) return;
    spawnBridgeSent = true;
    send({
      ...identity,
      type: 'spawn-bridge',
      execPath: state.entries.execPath,
    });
  };
  const maybeInit = async () => {
    if (stopped || initSent || !bridgeReady || !state.identities.bridge) return;
    state.phase = 'bridge_ready';
    await persist();
    if (stopped) return;
    if (!(await deps.platform.revalidate(options.preflight)))
      fault('start_failed');
    if (stopped) return;
    if (deps.beforeInit) {
      await deps.beforeInit();
      if (stopped) return;
    }
    initSent = true;
    clearHandshake();
    // Timer is armed at the actual send, after every durable barrier.
    if (options.initialTimeoutMs !== undefined)
      initialTimer = deps.setTimer(() => {
        void stop('initial_timeout');
      }, options.initialTimeoutMs);
    send(initFrame);
    try {
      deps.callbacks?.onInitSent?.();
    } catch {
      /* observer isolated */
    }
  };
  const handleBridge = async (frame: NativeBridgeFrame) => {
    if (stopped) return;
    switch (frame.type) {
      case 'bridge-ready':
        if (
          !spawnBridgeSent ||
          bridgeReady ||
          !state.identities.bridge ||
          frame.pid !== state.identities.bridge.pid
        )
          fault('protocol_error');
        bridgeReady = true;
        await maybeInit();
        return;
      case 'initial-spawned':
        if (!initSent || state.identities.initial || !state.identities.bridge)
          fault('protocol_error');
        try {
          deps.callbacks?.onInitialSpawned?.(frame.pid);
        } catch {
          /* observer isolated */
        }
        await capture(
          'initial',
          frame.pid,
          initFrame.initialFile,
          state.identities.bridge.pid,
        );
        state.phase = 'initial_running';
        await persist();
        return;
      case 'initial-result': {
        if (!initSent || !state.identities.initial || state.initialOutcome)
          fault('protocol_error');
        clearInitial();
        state.initialOutcome = {
          exitCode: frame.exitCode,
          signal: frame.signal,
        };
        state.phase = 'initial_finished';
        await persist();
        if (stopped) return;
        const initial = state.identities.initial;
        const tree = await deps.platform.descendants([initial], []);
        if (tree.status !== 'ok') fault('termination_unconfirmed');
        // Children left by the initial command cannot overlap the manual prompt.
        state.tracked = tree.identities;
        await persist();
        if (stopped) return;
        if (
          (await deps.platform.stopTree([initial], tree.identities)) !==
            'attempted' ||
          (await deps.platform.verifyGone([initial, ...tree.identities])) !==
            'verified'
        )
          fault('termination_unconfirmed');
        state.initialRetired = true;
        state.tracked = [];
        await persist();
        try {
          deps.callbacks?.onInitialOutcome?.({ ...state.initialOutcome });
        } catch {
          /* observer isolated */
        }
        if (stopped) return;
        if (frame.exitCode === null || frame.signal !== null) {
          await finish('window_closed');
          return;
        }
        if (!(await deps.platform.revalidate(options.preflight)))
          fault('start_failed');
        if (stopped) return;
        state.phase = 'shell_starting';
        await persist();
        if (stopped) return;
        armHandshake();
        shellGoSent = true;
        send({ ...identity, type: 'open-shell-go' });
        return;
      }
      case 'shell-spawned':
        if (
          !shellGoSent ||
          state.identities.shell ||
          !state.identities.bridge ||
          !state.initialRetired
        )
          fault('protocol_error');
        await capture(
          'shell',
          frame.pid,
          options.preflight.shellFile,
          state.identities.bridge.pid,
        );
        state.phase = 'shell_running';
        await persist();
        clearHandshake();
        return;
      case 'session-exit':
        if (!state.identities.shell || state.sessionOutcome)
          fault('protocol_error');
        state.sessionOutcome = {
          exitCode: frame.exitCode,
          signal: frame.signal,
        };
        stopped = true;
        await finish('session_exit');
        return;
      case 'bridge-error':
        fault(
          frame.code === 'PROTOCOL_ERROR' ? 'protocol_error' : 'start_failed',
        );
    }
  };
  const handle = async (frame: NativeSupervisorFrame) => {
    if (stopped) return;
    switch (frame.type) {
      case 'supervisor-ready':
        if (supervisorReady) fault('protocol_error');
        supervisorReady = true;
        await maybeSpawnBridge();
        return;
      case 'bridge-spawned':
        if (
          !spawnBridgeSent ||
          state.identities.bridge ||
          !state.identities.supervisor
        )
          fault('protocol_error');
        await capture(
          'bridge',
          frame.pid,
          state.entries.execPath,
          state.identities.supervisor.pid,
        );
        await persist();
        return;
      case 'bridge-frame':
        await handleBridge(frame.payload);
        return;
      case 'bridge-exit':
        stopped = true;
        await finish('window_closed');
        return;
      case 'supervisor-error':
        fault(
          frame.code === 'PROTOCOL_ERROR' ? 'protocol_error' : 'start_failed',
        );
    }
  };
  const start = (): Promise<void> => {
    if (started) return queue;
    started = true;
    return enqueue(async () => {
      if (stopped) return;
      await deps.writeIntent();
      if (stopped) return;
      await persist();
      if (stopped) return;
      if (!(await deps.platform.revalidate(options.preflight)))
        fault('start_failed');
      if (stopped) return;
      // Register synchronous parent-exit cleanup before creating any handle.
      removers.push(
        deps.onProcessExit(() => {
          stopped = true;
          state.termination ??= 'parent_exit';
          try {
            child?.disconnect();
          } catch {
            /* no async work in exit */
          }
        }),
      );
      child = deps.spawn(
        state.entries.execPath,
        [
          state.entries.supervisorFile,
          identity.jobId,
          String(identity.generation),
        ],
        nativeLaunchOptions(options.preflight.systemRoot, true),
      );
      removers.push(
        child.onMessage((raw) => {
          if (finished) return;
          let frame: NativeSupervisorFrame;
          try {
            frame = parseSupervisorToCoordinatorFrame(raw, identity);
          } catch {
            void stop('protocol_error');
            return;
          }
          // Loss/window-close frames preempt an in-flight journal before queued work.
          if (
            frame.type === 'bridge-exit' ||
            frame.type === 'supervisor-error' ||
            (frame.type === 'bridge-frame' &&
              (frame.payload.type === 'session-exit' ||
                frame.payload.type === 'bridge-error'))
          ) {
            if (
              frame.type === 'bridge-frame' &&
              frame.payload.type === 'session-exit'
            ) {
              state.sessionOutcome = {
                exitCode: frame.payload.exitCode,
                signal: frame.payload.signal,
              };
              void stop(
                state.identities.shell ? 'session_exit' : 'window_closed',
              );
            } else
              void stop(
                frame.type === 'bridge-exit'
                  ? 'window_closed'
                  : frame.type === 'supervisor-error' &&
                      frame.code === 'PROTOCOL_ERROR'
                    ? 'protocol_error'
                    : 'start_failed',
              );
            return;
          }
          void enqueue(() => handle(frame));
        }),
      );
      removers.push(
        child.onDisconnect(() => {
          void stop('ipc_lost');
        }),
      );
      removers.push(
        child.onExit(() => {
          void stop('window_closed');
        }),
      );
      if (!child.pid) fault('start_failed');
      armHandshake();
      await capture(
        'supervisor',
        child.pid,
        state.entries.execPath,
        options.apiPid,
      );
      state.phase = 'supervisor_ready';
      await persist();
      if (stopped) return;
      await maybeSpawnBridge();
    });
  };
  let retryQueue: Promise<INativeSessionResult> | null = null;
  const retryCleanup = (): Promise<INativeSessionResult> => {
    const base = retryQueue ?? settled;
    const next = base.then(async () => {
      try {
        child?.disconnect();
      } catch {
        /* already closed */
      }
      const verified = await verifyCleanup();
      const term = originalTermination ?? state.termination ?? 'user_stop';
      return applyCleanupOutcome(term, verified);
    });
    retryQueue = next;
    return next;
  };
  return { start, stop, retryCleanup, settled, snapshot };
}
