jest.mock('execa', () => ({ execa: jest.fn() }));

import { EventEmitter } from 'node:events';
import { execa } from 'execa';
import { launchRun } from '@/npm-runner/runner-process';
import type { IRunProcessCallbacks } from '@/npm-runner/runner-process';
import type { IRunClock } from '@/npm-runner/runner-logs';
import type { IRunnerCommand } from '@/npm-runner/interfaces/npm-runner.types';
import type {
  IRunnerProcessIdentity,
  IWindowsRunnerProcess,
} from '@/platform/windows/windows-runner-process';

class TestOutput extends EventEmitter {
  destroyed = false;
  readableEnded = false;
  destroy = jest.fn(() => {
    this.destroyed = true;
    this.emit('close');
    return this;
  });
  close(): void {
    this.readableEnded = true;
    this.emit('end');
    this.emit('close');
  }
}

interface TestResult {
  exitCode?: number;
  signal?: string;
  failed?: boolean;
  killed?: boolean;
}

function makeChild() {
  let resolve!: (result: TestResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<TestResult>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const events = new EventEmitter();
  const child = Object.assign(promise, {
    pid: 10,
    stdout: new TestOutput(),
    stderr: new TestOutput(),
    kill: jest.fn(() => true),
    on: (...args: Parameters<EventEmitter['on']>) => events.on(...args),
    once: (...args: Parameters<EventEmitter['once']>) => events.once(...args),
    off: (...args: Parameters<EventEmitter['off']>) => events.off(...args),
    removeListener: (...args: Parameters<EventEmitter['removeListener']>) =>
      events.removeListener(...args),
  });
  const finish = (
    result: TestResult = { exitCode: 0 },
    closeStreams = true,
  ): void => {
    events.emit('exit', result.exitCode ?? null, result.signal ?? null);
    if (closeStreams) {
      child.stdout.close();
      child.stderr.close();
      events.emit('close', result.exitCode ?? null, result.signal ?? null);
    }
    resolve(result);
  };
  return { child, events, finish, reject };
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
  ReturnType<typeof makeChild>['child'],
  [string, readonly string[], Record<string, unknown>]
>;
const root: IRunnerProcessIdentity = {
  pid: 10,
  creationTime: '2026-11-03T02:00:00.000Z',
};
const descendant: IRunnerProcessIdentity = {
  pid: 11,
  creationTime: '2026-11-03T02:00:01.000Z',
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
  for (let index = 0; index < 12; index++) await Promise.resolve();
};

describe('launchRun', () => {
  let fixture: ReturnType<typeof makeChild>;
  let clock: TestClock;
  let controller: AbortController;
  let onOutput: jest.Mock<void, ['stdout' | 'stderr', Buffer]>;
  let onExit: jest.Mock<void, [Parameters<IRunProcessCallbacks['onExit']>[0]]>;
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
    },
  ) =>
    launchRun(
      command,
      env,
      { onOutput, onExit, signal: controller.signal },
      { processes, clock },
    );

  beforeEach(() => {
    fixture = makeChild();
    clock = new TestClock();
    controller = new AbortController();
    onOutput = jest.fn<void, ['stdout' | 'stderr', Buffer]>();
    onExit = jest.fn<void, [Parameters<IRunProcessCallbacks['onExit']>[0]]>();
    capture = jest
      .fn<
        ReturnType<IWindowsRunnerProcess['capture']>,
        Parameters<IWindowsRunnerProcess['capture']>
      >()
      .mockResolvedValue({ status: 'ok', identity: root });
    descendants = jest
      .fn<
        ReturnType<IWindowsRunnerProcess['descendants']>,
        Parameters<IWindowsRunnerProcess['descendants']>
      >()
      .mockResolvedValue({ status: 'ok', identities: [] });
    stopTree = jest
      .fn<
        ReturnType<IWindowsRunnerProcess['stopTree']>,
        Parameters<IWindowsRunnerProcess['stopTree']>
      >()
      .mockResolvedValue('attempted');
    verifyGone = jest
      .fn<
        ReturnType<IWindowsRunnerProcess['verifyGone']>,
        Parameters<IWindowsRunnerProcess['verifyGone']>
      >()
      .mockResolvedValue('verified');
    processes = { capture, descendants, stopTree, verifyGone };
    execaMock.mockReset().mockReturnValue(fixture.child);
  });

  it('launches once with explicit streaming options, caller env and no command deadline', async () => {
    const env = Object.freeze({
      SystemRoot: 'C:\\Windows',
      APP_VALUE: 'PRIVATE_ENV',
    });
    const run = start(env);
    expect(run.pid).toBe(10);
    expect(execaMock).toHaveBeenCalledTimes(1);
    expect(execaMock).toHaveBeenCalledWith(
      command.file,
      command.args,
      expect.objectContaining({
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
      }),
    );
    const options = execaMock.mock.calls[0][2];
    expect(options).not.toHaveProperty('timeout');
    // Abort must take the identity-checked adapter path, not execa's implicit kill.
    expect(options).not.toHaveProperty('cancelSignal');
    await ticks();
    expect(capture).toHaveBeenCalledWith(10);
    expect(descendants).not.toHaveBeenCalled();
    expect(clock.pending.size).toBe(0);
    clock.advance(60_000);
    await ticks();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(descendants).not.toHaveBeenCalled();
    expect(onExit).not.toHaveBeenCalled();
    fixture.finish();
    await run.settled;
  });

  it('forwards Buffer chunks immediately before root capture resolves, without a browser', async () => {
    let identify!: (
      result: Awaited<ReturnType<IWindowsRunnerProcess['capture']>>,
    ) => void;
    capture.mockReturnValue(
      new Promise((resolve) => {
        identify = resolve;
      }),
    );
    const run = start();
    const out = Buffer.from([0xf0, 0x9f]);
    const err = Buffer.from('stderr\n');
    fixture.child.stdout.emit('data', out);
    fixture.child.stderr.emit('data', err);
    expect(onOutput.mock.calls).toEqual([
      ['stdout', out],
      ['stderr', err],
    ]);
    expect(onOutput.mock.calls[0][1]).toBe(out);
    identify({ status: 'ok', identity: root });
    fixture.finish();
    await run.settled;
  });

  it('verifies natural exit and reports a normal zero exit only once', async () => {
    const run = start();
    fixture.finish();
    const result = await run.settled;
    expect(result).toEqual({
      exitCode: 0,
      signal: null,
      failureCode: null,
      termination: 'verified',
      outputTruncated: false,
    });
    expect(descendants).toHaveBeenCalledWith(root, expect.any(Array));
    expect(verifyGone).toHaveBeenCalledWith(expect.arrayContaining([root]));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith(result);
    expect(stopTree).not.toHaveBeenCalled();
  });

  it('verifies a fast root exit with no children when capture misses the root', async () => {
    let identify!: (
      result: Awaited<ReturnType<IWindowsRunnerProcess['capture']>>,
    ) => void;
    capture.mockReturnValue(
      new Promise((resolve) => {
        identify = resolve;
      }),
    );
    clock.time = Date.parse(root.creationTime);
    const run = start();
    fixture.finish({ exitCode: 7, failed: true });
    clock.advance(1000);
    await ticks();
    expect(onExit).not.toHaveBeenCalled();
    identify({ status: 'unknown' });
    await expect(run.settled).resolves.toMatchObject({
      exitCode: 7,
      failureCode: 'COMMAND_FAILED',
      termination: 'verified',
    });
    const fallbackRoot = {
      pid: 10,
      creationTime: '2026-11-03T01:59:58.000Z',
    };
    expect(descendants).toHaveBeenCalledWith(fallbackRoot, [fallbackRoot]);
    expect(verifyGone).toHaveBeenCalledWith([fallbackRoot]);
    expect(stopTree).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('stops a live orphan after the root exits before capture resolves', async () => {
    let identify!: (
      result: Awaited<ReturnType<IWindowsRunnerProcess['capture']>>,
    ) => void;
    capture.mockReturnValue(
      new Promise((resolve) => {
        identify = resolve;
      }),
    );
    descendants.mockResolvedValue({ status: 'ok', identities: [descendant] });
    let completeVerification!: (result: 'verified' | 'unconfirmed') => void;
    verifyGone.mockReturnValue(
      new Promise((resolve) => {
        completeVerification = resolve;
      }),
    );
    clock.time = Date.parse(root.creationTime);
    const run = start();
    fixture.finish();
    clock.advance(1000);
    identify({ status: 'unknown' });
    await ticks();
    const fallbackRoot = {
      pid: 10,
      creationTime: '2026-11-03T01:59:58.000Z',
    };
    expect(descendants).toHaveBeenCalledWith(fallbackRoot, [fallbackRoot]);
    expect(stopTree).toHaveBeenCalledWith(fallbackRoot, [descendant]);
    expect(verifyGone).toHaveBeenCalledWith([fallbackRoot, descendant]);
    expect(onExit).not.toHaveBeenCalled();
    expect(stopTree.mock.invocationCallOrder[0]).toBeLessThan(
      verifyGone.mock.invocationCallOrder[0],
    );
    completeVerification('verified');
    await expect(run.settled).resolves.toMatchObject({
      exitCode: 0,
      termination: 'verified',
    });
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('stops surviving descendants on ordinary parent exit before reporting success', async () => {
    descendants.mockResolvedValue({ status: 'ok', identities: [descendant] });
    let completeVerification!: (result: 'verified' | 'unconfirmed') => void;
    verifyGone.mockReturnValue(
      new Promise((resolve) => {
        completeVerification = resolve;
      }),
    );
    const run = start();
    fixture.finish();
    await ticks();
    expect(stopTree).toHaveBeenCalledWith(
      root,
      expect.arrayContaining([descendant]),
    );
    expect(onExit).not.toHaveBeenCalled();
    completeVerification('verified');
    await expect(run.settled).resolves.toMatchObject({
      exitCode: 0,
      termination: 'verified',
    });
    expect(verifyGone).toHaveBeenCalledWith(
      expect.arrayContaining([root, descendant]),
    );
  });

  it('reports termination uncertainty if an orphan survives a zero parent exit', async () => {
    descendants.mockResolvedValue({ status: 'ok', identities: [descendant] });
    verifyGone.mockResolvedValue('unconfirmed');
    const run = start();
    fixture.finish();
    await expect(run.settled).resolves.toMatchObject({
      exitCode: 0,
      termination: 'unconfirmed',
    });
  });

  it('preserves a nonzero exit as COMMAND_FAILED rather than throwing', async () => {
    const run = start();
    fixture.finish({ exitCode: 7, failed: true });
    await expect(run.settled).resolves.toMatchObject({
      exitCode: 7,
      signal: null,
      failureCode: 'COMMAND_FAILED',
      termination: 'verified',
    });
  });

  it('preserves a forced-kill null exit code instead of coercing it to zero', async () => {
    const run = start();
    fixture.finish({ signal: 'SIGTERM', failed: true, killed: true });
    await expect(run.settled).resolves.toMatchObject({
      exitCode: null,
      signal: 'SIGTERM',
    });
  });

  it('normalizes a synchronous spawn failure without leaking the error or spawning again', async () => {
    execaMock.mockImplementation(() => {
      throw new Error('PRIVATE_ENV_SPAWN_ERROR');
    });
    const run = start();
    const result = await run.settled;
    expect(result).toMatchObject({
      exitCode: null,
      signal: null,
      failureCode: 'SPAWN_FAILED',
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
    expect(execaMock).toHaveBeenCalledTimes(1);
    expect(stopTree).not.toHaveBeenCalled();
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('normalizes asynchronous spawn rejection with no PID, never taskkilling an unknown PID', async () => {
    fixture.child.pid = undefined;
    const run = start();
    fixture.child.stdout.close();
    fixture.child.stderr.close();
    fixture.reject(
      Object.assign(new Error('PRIVATE_COMMAND_LINE'), { code: 'ENOENT' }),
    );
    await expect(run.settled).resolves.toMatchObject({
      exitCode: null,
      failureCode: 'SPAWN_FAILED',
    });
    expect(capture).not.toHaveBeenCalled();
    expect(stopTree).not.toHaveBeenCalled();
  });

  it('does not spawn when already aborted and safely settles without a process', async () => {
    controller.abort();
    const run = start();
    expect(run.pid).toBeNull();
    await expect(run.settled).resolves.toMatchObject({
      exitCode: null,
      termination: 'verified',
    });
    expect(execaMock).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    await expect(run.stop()).resolves.toBe('verified');
  });

  it('remembers stop before spawn identity exists and stops once the spawn event arrives', async () => {
    fixture.child.pid = undefined;
    const run = start();
    const stopping = run.stop();
    await ticks();
    expect(stopTree).not.toHaveBeenCalled();
    fixture.child.pid = root.pid;
    fixture.events.emit('spawn');
    await ticks();
    fixture.finish({ signal: 'SIGTERM' });
    await expect(stopping).resolves.toBe('verified');
    await run.settled;
    expect(capture).toHaveBeenCalledWith(root.pid);
    expect(stopTree).toHaveBeenCalledTimes(1);
  });

  it('serializes repeated stop calls with snapshot → taskkill → independent verification', async () => {
    descendants.mockResolvedValue({ status: 'ok', identities: [descendant] });
    const run = start();
    await ticks();
    const first = run.stop();
    const second = run.stop();
    await ticks();
    fixture.finish({ signal: 'SIGTERM' });
    await expect(first).resolves.toBe('verified');
    await expect(second).resolves.toBe('verified');
    await run.settled;
    expect(stopTree).toHaveBeenCalledTimes(1);
    expect(descendants.mock.invocationCallOrder[0]).toBeLessThan(
      stopTree.mock.invocationCallOrder[0],
    );
    expect(stopTree.mock.invocationCallOrder[0]).toBeLessThan(
      verifyGone.mock.invocationCallOrder[0],
    );
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('routes signal abort through the same identity-checked stop path', async () => {
    const run = start();
    await ticks();
    controller.abort();
    await ticks();
    fixture.finish({ signal: 'SIGTERM' });
    await run.settled;
    expect(stopTree).toHaveBeenCalledTimes(1);
    expect(verifyGone).toHaveBeenCalled();
    expect(fixture.child.kill).not.toHaveBeenCalled();
  });

  it('never upgrades taskkill success or execa killed=true into proof of stop', async () => {
    verifyGone.mockResolvedValue('unconfirmed');
    const run = start();
    await ticks();
    const stopping = run.stop();
    await ticks();
    fixture.finish({ killed: true, signal: 'SIGTERM' });
    await expect(stopping).resolves.toBe('unconfirmed');
    await expect(run.settled).resolves.toMatchObject({
      termination: 'unconfirmed',
    });
  });

  it('allows verification to establish absence even when taskkill itself failed', async () => {
    stopTree.mockResolvedValue('unconfirmed');
    const run = start();
    await ticks();
    const stopping = run.stop();
    fixture.finish({ signal: 'SIGTERM' });
    await expect(stopping).resolves.toBe('verified');
    await expect(run.settled).resolves.toMatchObject({
      termination: 'verified',
    });
  });

  it('bounds an unconfirmed stop even when the child promise and pipes remain open', async () => {
    verifyGone.mockResolvedValue('unconfirmed');
    const run = start();
    await ticks();
    const stopping = run.stop();
    await ticks();
    clock.advance(1000);
    await expect(stopping).resolves.toBe('unconfirmed');
    await expect(run.settled).resolves.toMatchObject({
      exitCode: null,
      termination: 'unconfirmed',
      outputTruncated: true,
    });
    expect(onExit).toHaveBeenCalledTimes(1);
    fixture.reject(new Error('PRIVATE_LATE_CHILD_REJECTION'));
    await ticks();
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('permits an explicit verification retry after an unconfirmed stop', async () => {
    verifyGone
      .mockResolvedValueOnce('unconfirmed')
      .mockResolvedValue('verified');
    const run = start();
    await ticks();
    const first = run.stop();
    fixture.finish({ signal: 'SIGTERM' });
    await expect(first).resolves.toBe('unconfirmed');
    await run.settled;
    await expect(run.stop()).resolves.toBe('verified');
    expect(verifyGone).toHaveBeenCalledTimes(2);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the root is still alive and identity capture is unknown', async () => {
    capture.mockResolvedValue({ status: 'unknown' });
    const run = start();
    await ticks();
    const stopping = run.stop();
    await ticks();
    clock.advance(1000);
    await expect(stopping).resolves.toBe('unconfirmed');
    await expect(run.settled).resolves.toMatchObject({
      termination: 'unconfirmed',
    });
    expect(descendants).not.toHaveBeenCalled();
    expect(verifyGone).not.toHaveBeenCalled();
    expect(stopTree).not.toHaveBeenCalled();
    expect(fixture.child.kill).not.toHaveBeenCalled();
    fixture.finish();
  });

  it('does not release uncertainty when the descendant snapshot fails', async () => {
    descendants.mockResolvedValue({ status: 'unknown' });
    const run = start();
    await ticks();
    const stopping = run.stop();
    fixture.finish();
    await expect(stopping).resolves.toBe('unconfirmed');
    await expect(run.settled).resolves.toMatchObject({
      termination: 'unconfirmed',
    });
  });

  it('normalizes helper rejection/timeout to an unconfirmed stop without rejecting settled', async () => {
    verifyGone.mockRejectedValue(
      Object.assign(new Error('PRIVATE_HELPER'), { timedOut: true }),
    );
    const run = start();
    await ticks();
    const stopping = run.stop();
    fixture.finish();
    await expect(stopping).resolves.toBe('unconfirmed');
    await expect(run.settled).resolves.toMatchObject({
      termination: 'unconfirmed',
    });
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it.each(['stdout', 'stderr'] as const)(
    'stops on %s stream error while continuing to drain',
    async (stream) => {
      const run = start();
      await ticks();
      fixture.child[stream].emit('error', new Error('PRIVATE_STREAM_ERROR'));
      fixture.child.stdout.emit('data', Buffer.from('remaining output'));
      await ticks();
      fixture.finish({ signal: 'SIGTERM' });
      const result = await run.settled;
      expect(result.failureCode).toBe('COMMAND_FAILED');
      expect(stopTree).toHaveBeenCalledTimes(1);
      expect(onOutput).toHaveBeenCalledWith(
        'stdout',
        Buffer.from('remaining output'),
      );
      expect(JSON.stringify(result)).not.toContain('PRIVATE_');
      expect(onExit).toHaveBeenCalledTimes(1);
    },
  );

  it('waits for trailing stream data after parent exit before onExit', async () => {
    const run = start();
    await ticks();
    fixture.finish({ exitCode: 0 }, false);
    await ticks();
    expect(onExit).not.toHaveBeenCalled();
    fixture.child.stdout.emit('data', Buffer.from('tail'));
    fixture.child.stdout.close();
    fixture.child.stderr.close();
    await run.settled;
    expect(onOutput).toHaveBeenCalledWith('stdout', Buffer.from('tail'));
    expect(onOutput.mock.invocationCallOrder[0]).toBeLessThan(
      onExit.mock.invocationCallOrder[0],
    );
    expect(clock.pending.size).toBe(0);
  });

  it('bounds final drain to 1s and destroys inherited pipes that never close', async () => {
    const run = start();
    fixture.finish({ exitCode: 0 }, false);
    await ticks();
    clock.advance(999);
    await ticks();
    expect(onExit).not.toHaveBeenCalled();
    clock.advance(1);
    await expect(run.settled).resolves.toMatchObject({ outputTruncated: true });
    expect(fixture.child.stdout.destroy).toHaveBeenCalledTimes(1);
    expect(fixture.child.stderr.destroy).toHaveBeenCalledTimes(1);
    expect(clock.pending.size).toBe(0);
  });

  it('handles close/abort races and late child rejection without double terminalization', async () => {
    const run = start();
    await ticks();
    controller.abort();
    fixture.child.stdout.close();
    fixture.child.stderr.close();
    fixture.events.emit('exit', null, 'SIGTERM');
    fixture.events.emit('close', null, 'SIGTERM');
    fixture.reject(
      Object.assign(new Error('PRIVATE_LATE_REJECTION'), {
        exitCode: undefined,
        signal: 'SIGTERM',
        killed: true,
      }),
    );
    const result = await run.settled;
    expect(result.exitCode).toBeNull();
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(execaMock).toHaveBeenCalledTimes(1);
    await run.stop();
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
