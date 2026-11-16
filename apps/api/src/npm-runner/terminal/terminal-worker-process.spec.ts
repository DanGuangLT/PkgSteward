jest.mock('execa', () => ({ execa: jest.fn() }));

import { EventEmitter } from 'node:events';
import { execa } from 'execa';
import {
  launchTerminalRun,
  type ITerminalRunCallbacks,
  type ITerminalWorkerSubprocess,
} from '@/npm-runner/terminal/terminal-worker-process';
import type { IRunClock } from '@/npm-runner/execution/runner-logs';
import type { IRunnerCommand } from '@/npm-runner/interfaces/npm-runner.types';
import type {
  ITerminalIdentity,
  ITerminalInputFrame,
  ParentTerminalFrame,
  WorkerTerminalFrame,
} from '@/npm-runner/terminal/terminal-protocol';
import type {
  IRunnerProcessIdentity,
  IWindowsRunnerProcess,
} from '@/platform/windows/windows-runner-process';

interface TestResult {
  exitCode?: number;
  signal?: string;
  failed?: boolean;
  killed?: boolean;
}

function makeWorkerChild(initialPid: number | null = 10) {
  const startPid = initialPid ?? undefined;
  let resolve!: (result: TestResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<TestResult>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const events = new EventEmitter();
  const sent: unknown[] = [];
  const sendMock = jest.fn(
    (frame: unknown, callback?: (error: Error | null) => void) => {
      sent.push(frame);
      callback?.(null);
      return true;
    },
  );
  const disconnectMock = jest.fn(() => {
    native.connected = false;
  });
  const native = Object.assign(events, {
    pid: startPid,
    connected: true,
    send: sendMock,
    disconnect: disconnectMock,
    kill: jest.fn(() => true),
  });
  const processIdentity: { pid: number | undefined } = { pid: startPid };
  const child = Object.assign(promise, processIdentity, {
    nodeChildProcess: native,
  }) as unknown as ITerminalWorkerSubprocess & {
    pid: number | undefined;
    nodeChildProcess: typeof native;
  };
  const emitFromWorker = (frame: unknown) => {
    events.emit('message', frame);
  };
  const disconnect = () => {
    native.connected = false;
    events.emit('disconnect');
  };
  const finishHelper = (result: TestResult = { exitCode: 0 }): void => {
    native.connected = false;
    events.emit('exit', result.exitCode ?? null, result.signal ?? null);
    events.emit('close', result.exitCode ?? null, result.signal ?? null);
    resolve(result);
  };
  return {
    child,
    events,
    native,
    sent,
    sendMock,
    disconnectMock,
    emitFromWorker,
    disconnect,
    finishHelper,
    reject,
  };
}

class TestClock implements IRunClock {
  time = 0;
  nextId = 0;
  pending = new Map<number, { at: number; callback: () => void }>();
  now = (): number => this.time;
  setTimeout = (callback: () => void, delayMs: number): number => {
    const id = this.nextId++;
    this.pending.set(id, { at: this.time + delayMs, callback });
    return id;
  };
  clearTimeout = (handle: unknown): void => {
    if (typeof handle === 'number') this.pending.delete(handle);
  };
  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      const next = [...this.pending.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      this.time = next[1].at;
      this.pending.delete(next[0]);
      next[1].callback();
    }
    this.time = end;
  }
}

const execaMock = execa as unknown as jest.Mock<
  ReturnType<typeof makeWorkerChild>['child'],
  [string, readonly string[], Record<string, unknown>]
>;

const identity: ITerminalIdentity = {
  jobId: '00000000-0000-4000-8000-000000000010',
  generation: 1,
};
const helperRoot: IRunnerProcessIdentity = {
  pid: 10,
  creationTime: '2026-11-16T02:00:00.000Z',
};
const commandIdentity: IRunnerProcessIdentity = {
  pid: 200,
  creationTime: '2026-11-16T02:00:01.000Z',
};
const orphanIdentity: IRunnerProcessIdentity = {
  pid: 201,
  creationTime: '2026-11-16T02:00:02.000Z',
};
const otherIdentity: IRunnerProcessIdentity = {
  pid: 999,
  creationTime: '2026-11-16T01:00:00.000Z',
};
const command: IRunnerCommand = {
  file: 'C:\\Program Files\\nodejs\\node.exe',
  args: [
    'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
    'run-script',
    '--',
    'dev',
  ],
  cwd: 'D:\\Dự án\\test-app',
  manager: 'npm',
  version: '11.6.0',
};
const ticks = async (): Promise<void> => {
  for (let index = 0; index < 16; index++) await Promise.resolve();
};
const inputFrame = (
  sequence = 1,
  text = 'y\r',
  writerGeneration = 1,
): ITerminalInputFrame => ({
  ...identity,
  type: 'input',
  writerGeneration,
  sequence,
  text,
});

describe('launchTerminalRun', () => {
  let fixture: ReturnType<typeof makeWorkerChild>;
  let clock: TestClock;
  let controller: AbortController;
  let onOutput: jest.Mock<void, ['stdout' | 'stderr', Buffer]>;
  let onTerminalOutput: jest.Mock<void, [string]>;
  let onTerminalAck: jest.Mock<
    void,
    [Extract<WorkerTerminalFrame, { type: 'input-ack' }>]
  >;
  let onExit: jest.Mock<void, [Parameters<ITerminalRunCallbacks['onExit']>[0]]>;
  let capture: jest.Mock<
    ReturnType<IWindowsRunnerProcess['capture']>,
    Parameters<IWindowsRunnerProcess['capture']>
  >;
  let descendants: jest.Mock<
    ReturnType<IWindowsRunnerProcess['descendants']>,
    Parameters<IWindowsRunnerProcess['descendants']>
  >;
  let stopTree: jest.Mock<
    ReturnType<IWindowsRunnerProcess['stopTree']>,
    Parameters<IWindowsRunnerProcess['stopTree']>
  >;
  let verifyGone: jest.Mock<
    ReturnType<IWindowsRunnerProcess['verifyGone']>,
    Parameters<IWindowsRunnerProcess['verifyGone']>
  >;
  let processes: IWindowsRunnerProcess;

  const start = (
    env: Readonly<NodeJS.ProcessEnv> = {
      SystemRoot: 'C:\\Windows',
      APP_VALUE: 'ok',
      OPTIONAL_UNSET: undefined,
    },
    initialSize?: { cols: number; rows: number },
    extraDeps?: { workerFile?: string },
  ) =>
    launchTerminalRun(
      command,
      env,
      {
        onOutput,
        onTerminalOutput,
        onTerminalAck,
        onExit,
        signal: controller.signal,
      },
      { processes, clock, ...extraDeps },
      identity,
      initialSize,
    );

  const reachReady = async () => {
    const run = start();
    await ticks();
    fixture.emitFromWorker({
      ...identity,
      type: 'ready',
      pid: commandIdentity.pid,
    });
    await ticks();
    await expect(run.ready).resolves.toBe(true);
    return run;
  };

  beforeEach(() => {
    fixture = makeWorkerChild(helperRoot.pid);
    clock = new TestClock();
    controller = new AbortController();
    onOutput = jest.fn<void, ['stdout' | 'stderr', Buffer]>();
    onTerminalOutput = jest.fn<void, [string]>();
    onTerminalAck = jest.fn<
      void,
      [Extract<WorkerTerminalFrame, { type: 'input-ack' }>]
    >();
    onExit = jest.fn<void, [Parameters<ITerminalRunCallbacks['onExit']>[0]]>();
    capture = jest.fn((pid: number) => {
      if (pid === helperRoot.pid)
        return Promise.resolve({ status: 'ok' as const, identity: helperRoot });
      if (pid === commandIdentity.pid)
        return Promise.resolve({
          status: 'ok' as const,
          identity: commandIdentity,
        });
      if (pid === otherIdentity.pid)
        return Promise.resolve({
          status: 'ok' as const,
          identity: otherIdentity,
        });
      return Promise.resolve({ status: 'unknown' as const });
    });
    descendants = jest
      .fn<
        ReturnType<IWindowsRunnerProcess['descendants']>,
        Parameters<IWindowsRunnerProcess['descendants']>
      >()
      .mockResolvedValue({
        status: 'ok' as const,
        identities: [commandIdentity],
      });
    stopTree = jest
      .fn<
        ReturnType<IWindowsRunnerProcess['stopTree']>,
        Parameters<IWindowsRunnerProcess['stopTree']>
      >()
      .mockResolvedValue('attempted' as const);
    verifyGone = jest
      .fn<
        ReturnType<IWindowsRunnerProcess['verifyGone']>,
        Parameters<IWindowsRunnerProcess['verifyGone']>
      >()
      .mockResolvedValue('verified' as const);
    processes = { capture, descendants, stopTree, verifyGone };
    execaMock.mockReset().mockReturnValue(fixture.child);
  });

  it('captures helper OS identity BEFORE sending init, strips undefined env and clears handshake timer on ready', async () => {
    let resolveHelperCapture!: (
      result: Awaited<ReturnType<IWindowsRunnerProcess['capture']>>,
    ) => void;
    capture.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveHelperCapture = resolve;
        }),
    );

    const run = start(
      {
        SystemRoot: 'C:\\Windows',
        PRIVATE_TOKEN: 'ok',
        REMOVED_VAR: undefined,
      },
      { cols: 120, rows: 40 },
      { workerFile: 'D:\\TEST\\terminal-worker-entry.js' },
    );

    expect(run.pid).toBe(helperRoot.pid);
    expect(execaMock).toHaveBeenCalledTimes(1);
    expect(execaMock).toHaveBeenCalledWith(
      process.execPath,
      [
        'D:\\TEST\\terminal-worker-entry.js',
        identity.jobId,
        String(identity.generation),
      ],
      expect.objectContaining({
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
        cleanup: true,
        killDescendants: true,
        reject: false,
      }),
    );
    const execaOptions = execaMock.mock.calls[0][2];
    expect(execaOptions).not.toHaveProperty('timeout');
    expect(execaOptions).not.toHaveProperty('cancelSignal');
    expect(execaOptions).not.toHaveProperty('env');

    await ticks();
    expect(capture).toHaveBeenCalledWith(helperRoot.pid);
    expect(fixture.sendMock).not.toHaveBeenCalled();

    resolveHelperCapture({ status: 'ok', identity: helperRoot });
    await ticks();

    expect(fixture.sendMock).toHaveBeenCalledTimes(1);
    const init = fixture.sent[0] as ParentTerminalFrame;
    expect(init).toEqual({
      ...identity,
      type: 'init',
      file: command.file,
      args: command.args,
      cwd: command.cwd,
      env: { SystemRoot: 'C:\\Windows', PRIVATE_TOKEN: 'ok' },
      cols: 120,
      rows: 40,
    });
    expect(capture.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.sendMock.mock.invocationCallOrder[0],
    );

    // Input is refused before command identity + descendant membership are confirmed.
    await expect(run.write(inputFrame(1))).resolves.toBe('not_delivered');
    expect(fixture.sendMock).toHaveBeenCalledTimes(1);

    fixture.emitFromWorker({
      ...identity,
      type: 'ready',
      pid: commandIdentity.pid,
    });
    await ticks();
    await expect(run.ready).resolves.toBe(true);
    expect(capture).toHaveBeenCalledWith(commandIdentity.pid);
    expect(descendants).toHaveBeenCalledWith(
      helperRoot,
      expect.arrayContaining([helperRoot]),
    );

    // Handshake timer cleared after ready: long runtime > 15s stays alive.
    expect(clock.pending.size).toBe(0);
    clock.advance(60_000);
    await ticks();
    expect(onExit).not.toHaveBeenCalled();

    fixture.emitFromWorker({
      ...identity,
      type: 'exit',
      exitCode: 0,
      signal: null,
    });
    fixture.finishHelper({ exitCode: 0 });
    const settled = await run.settled;
    expect(settled).toMatchObject({
      exitCode: 0,
      failureCode: null,
      termination: 'verified',
    });
  });

  it('requires command identity and descendant verification before resolving ready=true or accepting input', async () => {
    let resolveDescendants!: (
      result: Awaited<ReturnType<IWindowsRunnerProcess['descendants']>>,
    ) => void;
    descendants.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDescendants = resolve;
        }),
    );

    const run = start();
    await ticks();
    fixture.emitFromWorker({
      ...identity,
      type: 'ready',
      pid: commandIdentity.pid,
    });
    await ticks();

    await expect(run.write(inputFrame(1))).resolves.toBe('not_delivered');
    expect(
      fixture.sent.filter((f) => (f as ParentTerminalFrame).type === 'input'),
    ).toEqual([]);

    resolveDescendants({ status: 'ok', identities: [commandIdentity] });
    await expect(run.ready).resolves.toBe(true);

    const writePromise = run.write(inputFrame(1, 'echo ok\r'));
    await ticks();
    fixture.emitFromWorker({
      ...identity,
      type: 'input-ack',
      writerGeneration: 1,
      sequence: 1,
      status: 'delivered',
    });
    await expect(writePromise).resolves.toBe('delivered');
  });

  it('fails closed when helper capture returns unknown before init and never sends init', async () => {
    capture.mockResolvedValueOnce({ status: 'unknown' });
    const run = start();
    await expect(run.ready).resolves.toBe(false);
    const result = await run.settled;
    expect(fixture.sendMock).not.toHaveBeenCalled();
    expect(result.termination).toBe('unconfirmed');
    expect(stopTree).not.toHaveBeenCalled();
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('bounds startup handshake to 15s and cleans up helper tree without respawning', async () => {
    const run = start();
    await ticks();
    clock.advance(14_999);
    await ticks();
    expect(onExit).not.toHaveBeenCalled();

    clock.advance(1);
    await expect(run.ready).resolves.toBe(false);
    const result = await run.settled;
    expect(result).toMatchObject({
      exitCode: null,
      failureCode: 'COMMAND_FAILED',
      termination: 'verified',
    });
    expect(execaMock).toHaveBeenCalledTimes(1);
    expect(stopTree).toHaveBeenCalledTimes(1);
    expect(verifyGone).toHaveBeenCalledWith(
      expect.arrayContaining([helperRoot]),
    );
  });

  it('cleans up leftover descendants and helper on natural command exit', async () => {
    const run = await reachReady();
    descendants.mockResolvedValueOnce({
      status: 'ok',
      identities: [commandIdentity, orphanIdentity],
    });
    fixture.emitFromWorker({
      ...identity,
      type: 'exit',
      exitCode: 0,
      signal: null,
    });
    const result = await run.settled;
    expect(result).toEqual({
      exitCode: 0,
      signal: null,
      failureCode: null,
      termination: 'verified',
      outputTruncated: false,
    });
    expect(stopTree).toHaveBeenCalledWith(
      helperRoot,
      expect.arrayContaining([commandIdentity, orphanIdentity]),
    );
    expect(verifyGone).toHaveBeenCalledWith(
      expect.arrayContaining([helperRoot, commandIdentity, orphanIdentity]),
    );
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('does not let zero exit override unconfirmed termination', async () => {
    const run = await reachReady();
    verifyGone.mockResolvedValue('unconfirmed');
    fixture.emitFromWorker({
      ...identity,
      type: 'exit',
      exitCode: 0,
      signal: null,
    });
    const result = await run.settled;
    expect(result).toMatchObject({
      exitCode: 0,
      failureCode: null,
      termination: 'unconfirmed',
    });
  });

  it('handles quick command exit before command capture: refuses input, preserves exit, verifies helper tree', async () => {
    let resolveCmdCapture!: (
      result: Awaited<ReturnType<IWindowsRunnerProcess['capture']>>,
    ) => void;
    capture.mockImplementation((pid: number) => {
      if (pid === helperRoot.pid)
        return Promise.resolve({ status: 'ok', identity: helperRoot });
      return new Promise((resolve) => {
        resolveCmdCapture = resolve;
      });
    });
    descendants.mockResolvedValue({ status: 'ok', identities: [] });

    const run = start();
    await ticks();
    fixture.emitFromWorker({
      ...identity,
      type: 'ready',
      pid: commandIdentity.pid,
    });
    await ticks();
    fixture.emitFromWorker({
      ...identity,
      type: 'exit',
      exitCode: 7,
      signal: null,
    });
    resolveCmdCapture({ status: 'unknown' });

    await expect(run.ready).resolves.toBe(false);
    const settled = await run.settled;
    expect(settled).toMatchObject({
      exitCode: 7,
      failureCode: 'COMMAND_FAILED',
      termination: 'verified',
    });
    await expect(run.write(inputFrame(1))).resolves.toBe('not_delivered');
  });

  it('rejects ready PID outside helper descendants without ever passing arbitrary PID to stopTree', async () => {
    descendants.mockResolvedValue({ status: 'ok', identities: [] });
    const run = start();
    await ticks();
    fixture.emitFromWorker({
      ...identity,
      type: 'ready',
      pid: otherIdentity.pid,
    });
    await expect(run.ready).resolves.toBe(false);
    const settled = await run.settled;
    expect(settled.failureCode).toBe('COMMAND_FAILED');
    expect(settled.termination).toBe('unconfirmed');
    const stopArgs = stopTree.mock.calls.flatMap(([, list]) => list);
    expect(stopArgs.some((item) => item.pid === otherIdentity.pid)).toBe(false);
  });

  it('fails closed on wrong-job, malformed, or duplicate-ready worker frames', async () => {
    const run = await reachReady();
    // Wrong jobId frame is ignored without stopping the active run? Wait: prompt says wrong-job/malformed/duplicate-ready fail closed and trigger cleanup
    fixture.emitFromWorker({
      jobId: '00000000-0000-4000-8000-000000000099',
      generation: 1,
      type: 'output',
      text: 'spoofed',
    });
    await ticks();
    expect(onTerminalOutput).not.toHaveBeenCalled();
    const settled = await run.settled;
    expect(settled.failureCode).toBe('COMMAND_FAILED');
    expect(stopTree).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('fails closed on duplicate ready frame', async () => {
    const run = await reachReady();
    fixture.emitFromWorker({
      ...identity,
      type: 'ready',
      pid: commandIdentity.pid,
    });
    const settled = await run.settled;
    expect(settled.failureCode).toBe('COMMAND_FAILED');
    expect(stopTree).toHaveBeenCalledTimes(1);
  });

  it('handles crash before ready (disconnect after init) as unconfirmed potential orphan and never reports zero exit', async () => {
    const run = start();
    await ticks();
    fixture.disconnect();
    fixture.finishHelper({ exitCode: 0 });
    await expect(run.ready).resolves.toBe(false);
    const settled = await run.settled;
    expect(settled.exitCode).toBeNull();
    expect(settled.failureCode).toBe('COMMAND_FAILED');
    expect(settled.termination).toBe('unconfirmed');
  });

  it('handles worker START_FAILED cleanly when helper tree is verified gone', async () => {
    descendants.mockResolvedValue({ status: 'ok', identities: [] });
    const run = start();
    await ticks();
    fixture.emitFromWorker({
      ...identity,
      type: 'error',
      code: 'START_FAILED',
    });
    await expect(run.ready).resolves.toBe(false);
    const settled = await run.settled;
    expect(settled).toMatchObject({
      exitCode: null,
      failureCode: 'SPAWN_FAILED',
      termination: 'verified',
    });
  });

  it('handles crash after ready: resolves pending write as unknown and cleans full tree', async () => {
    const run = await reachReady();
    const pendingWrite = run.write(inputFrame(1));
    await ticks();
    fixture.disconnect();
    fixture.finishHelper({ exitCode: 1 });
    await expect(pendingWrite).resolves.toBe('unknown');
    const settled = await run.settled;
    expect(settled.exitCode).toBeNull();
    expect(settled.failureCode).toBe('COMMAND_FAILED');
    expect(settled.termination).toBe('verified');
    expect(stopTree).toHaveBeenCalledWith(
      helperRoot,
      expect.arrayContaining([commandIdentity]),
    );
  });

  it('normalizes synchronous spawn throw and async reject without PID', async () => {
    execaMock.mockImplementationOnce(() => {
      throw new Error('PRIVATE_SPAWN_FAIL');
    });
    const syncRun = start();
    await expect(syncRun.ready).resolves.toBe(false);
    await expect(syncRun.settled).resolves.toMatchObject({
      exitCode: null,
      failureCode: 'SPAWN_FAILED',
      termination: 'verified',
    });
    expect(capture).not.toHaveBeenCalled();

    const asyncChild = makeWorkerChild(null);
    execaMock.mockReturnValueOnce(asyncChild.child);
    const asyncRun = start();
    asyncChild.reject(new Error('PRIVATE_ASYNC_REJECT'));
    await expect(asyncRun.ready).resolves.toBe(false);
    await expect(asyncRun.settled).resolves.toMatchObject({
      exitCode: null,
      failureCode: 'SPAWN_FAILED',
      termination: 'verified',
    });
    expect(capture).not.toHaveBeenCalled();
  });

  it('does not spawn when already aborted and remembers stop before spawn identity arrives', async () => {
    controller.abort();
    const abortedRun = start();
    expect(abortedRun.pid).toBeNull();
    await expect(abortedRun.ready).resolves.toBe(false);
    await expect(abortedRun.settled).resolves.toMatchObject({
      exitCode: null,
      termination: 'verified',
    });
    expect(execaMock).not.toHaveBeenCalled();

    controller = new AbortController();
    const delayed = makeWorkerChild(null);
    execaMock.mockReturnValueOnce(delayed.child);
    const run = start();
    const stopping = run.stop();
    await ticks();
    expect(stopTree).not.toHaveBeenCalled();
    delayed.child.pid = helperRoot.pid;
    delayed.native.pid = helperRoot.pid;
    delayed.events.emit('spawn');
    await ticks();
    delayed.finishHelper({ signal: 'SIGTERM' });
    await expect(stopping).resolves.toBe('verified');
    await expect(run.ready).resolves.toBe(false);
    await run.settled;
    expect(capture).toHaveBeenCalledWith(helperRoot.pid);
    expect(delayed.sendMock).not.toHaveBeenCalled();
  });

  it('serializes repeated stop calls and permits cleanup retry after unconfirmed without respawning', async () => {
    verifyGone
      .mockResolvedValueOnce('unconfirmed')
      .mockResolvedValueOnce('verified');
    const run = await reachReady();
    const first = run.stop();
    const second = run.stop();
    await expect(first).resolves.toBe('unconfirmed');
    await expect(second).resolves.toBe('unconfirmed');
    await run.settled;
    expect(stopTree).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);

    await expect(run.stop()).resolves.toBe('verified');
    expect(verifyGone).toHaveBeenCalledTimes(2);
    expect(execaMock).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('returns unconfirmed on unknown descendants or helper rejection without rejecting settled', async () => {
    const run = await reachReady();
    descendants.mockResolvedValueOnce({ status: 'unknown' });
    await expect(run.stop()).resolves.toBe('unconfirmed');
    await expect(run.settled).resolves.toMatchObject({
      termination: 'unconfirmed',
    });

    verifyGone.mockRejectedValueOnce(new Error('PRIVATE_VERIFY_ERROR'));
    await expect(run.stop()).resolves.toBe('unconfirmed');
  });

  it('handles missing input-ack timeout (5s) -> unknown, send throw -> unknown, and forwards late ack', async () => {
    const run = await reachReady();

    // Missing ack within 5s -> unknown; late ack still invokes onTerminalAck
    const p1 = run.write(inputFrame(1, 'hello\r'));
    await ticks();
    clock.advance(4999);
    await ticks();
    clock.advance(1);
    await expect(p1).resolves.toBe('unknown');

    const lateAck: Extract<WorkerTerminalFrame, { type: 'input-ack' }> = {
      ...identity,
      type: 'input-ack',
      writerGeneration: 1,
      sequence: 1,
      status: 'delivered',
    };
    fixture.emitFromWorker(lateAck);
    expect(onTerminalAck).toHaveBeenCalledWith(lateAck);

    // Send throw -> unknown without replay
    fixture.sendMock.mockImplementationOnce(() => {
      throw new Error('PRIVATE_IPC_WRITE_ERROR');
    });
    await expect(run.write(inputFrame(2, 'next\r'))).resolves.toBe('unknown');

    // Wrong job frame rejected
    await expect(
      run.write({
        ...inputFrame(3),
        jobId: '00000000-0000-4000-8000-000000000099',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('forwards output frames to both onTerminalOutput and stdout Buffer onOutput, and fails safely if callback throws', async () => {
    const run = await reachReady();
    fixture.emitFromWorker({ ...identity, type: 'output', text: 'line1\r\n' });
    expect(onTerminalOutput).toHaveBeenCalledWith('line1\r\n');
    expect(onOutput).toHaveBeenCalledWith(
      'stdout',
      Buffer.from('line1\r\n', 'utf8'),
    );

    onOutput.mockImplementationOnce(() => {
      throw new Error('PRIVATE_CONSUMER_ERROR');
    });
    fixture.emitFromWorker({ ...identity, type: 'output', text: 'boom\r\n' });
    const settled = await run.settled;
    expect(settled.failureCode).toBe('COMMAND_FAILED');
    expect(stopTree).toHaveBeenCalledTimes(1);
  });

  it('forwards resize frames when ready and throws RESIZE_FAILED when send fails', async () => {
    const run = await reachReady();
    await expect(
      run.resize({ cols: 132, rows: 40 }, 2),
    ).resolves.toBeUndefined();
    expect(fixture.sent.at(-1)).toEqual({
      ...identity,
      type: 'resize',
      writerGeneration: 2,
      cols: 132,
      rows: 40,
    });

    fixture.sendMock.mockImplementationOnce(() => {
      throw new Error('PRIVATE_RESIZE_ERR');
    });
    await expect(run.resize({ cols: 80, rows: 24 }, 2)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('defaults workerFile to sibling terminal-worker-entry.js and routes AbortSignal through verified cleanup', async () => {
    const run = await reachReady();
    expect(execaMock.mock.calls[0][1][0]).toMatch(
      /[\\/]terminal-worker-entry\.js$/,
    );

    await expect(run.resize({ cols: 10, rows: 10 }, 0)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    controller.abort();
    const settled = await run.settled;
    expect(settled).toMatchObject({
      failureCode: 'COMMAND_FAILED',
      termination: 'verified',
    });
    expect(stopTree).toHaveBeenCalledTimes(1);
    expect(verifyGone).toHaveBeenCalledTimes(1);
    expect(fixture.native.kill).not.toHaveBeenCalled();

    await expect(run.resize({ cols: 80, rows: 24 }, 1)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('verifies fast helper exit before helper capture without sending init', async () => {
    let resolveCapture!: (
      result: Awaited<ReturnType<IWindowsRunnerProcess['capture']>>,
    ) => void;
    capture.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCapture = resolve;
        }),
    );
    descendants.mockResolvedValue({ status: 'ok', identities: [] });
    clock.time = Date.parse(helperRoot.creationTime);
    const run = start();
    fixture.finishHelper({ exitCode: 1 });
    await ticks();
    resolveCapture({ status: 'unknown' });
    await expect(run.ready).resolves.toBe(false);
    await expect(run.settled).resolves.toMatchObject({
      failureCode: 'SPAWN_FAILED',
      termination: 'verified',
    });
    expect(fixture.sendMock).not.toHaveBeenCalled();
  });
});
