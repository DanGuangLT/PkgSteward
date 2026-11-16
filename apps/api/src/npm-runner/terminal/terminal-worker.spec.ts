import { createTerminalWorker } from './terminal-worker';
import type {
  ITerminalWorkerDeps,
  ITerminalWorkerPty,
} from './terminal-worker';
import type { WorkerTerminalFrame } from './terminal-protocol';

const identity = {
  jobId: '00000000-0000-4000-8000-000000000001',
  generation: 1,
};
const init = {
  ...identity,
  type: 'init',
  file: 'C:/Program Files/nodejs/node.exe',
  args: ['C:/TEST/script.js'],
  cwd: 'C:/TEST',
  env: { PATH: 'C:/Program Files/nodejs' },
  cols: 80,
  rows: 24,
};
const input = (sequence: number, text = 'hello\r', writerGeneration = 1) => ({
  ...identity,
  type: 'input',
  sequence,
  writerGeneration,
  text,
});
const flush = async () => {
  for (let index = 0; index < 12; index++) await Promise.resolve();
};

function harness(spawnFailure = false) {
  let data: (text: string) => void = () => {};
  let exit: (value: { exitCode: number; signal?: number }) => void = () => {};
  const messages: WorkerTerminalFrame[] = [];
  const pty: ITerminalWorkerPty = {
    pid: 1234,
    write: jest.fn(),
    resize: jest.fn(),
    kill: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    onData: (callback) => {
      data = callback;
      return { dispose: jest.fn() };
    },
    onExit: (callback) => {
      exit = callback;
      return { dispose: jest.fn() };
    },
  };
  const deps: ITerminalWorkerDeps = {
    spawn: jest.fn(() =>
      spawnFailure
        ? Promise.reject(new Error('TEST secret failure'))
        : Promise.resolve(pty),
    ),
    send: jest.fn((frame) => {
      messages.push(frame);
      return Promise.resolve();
    }),
    disconnected: jest.fn(),
  };
  const worker = createTerminalWorker(identity, deps);
  return {
    worker,
    deps,
    pty,
    messages,
    output: (text: string) => data(text),
    exit: (code: number) => exit({ exitCode: code }),
  };
}

describe('isolated terminal worker', () => {
  it('spawns once with validated executable and argv, reports only PID then accepts input', async () => {
    const h = harness();
    h.worker.receive(init);
    await flush();
    expect(h.deps.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        file: init.file,
        args: init.args,
        cwd: init.cwd,
        cols: 80,
        rows: 24,
      }),
    );
    expect(h.messages[0]).toEqual({ ...identity, type: 'ready', pid: 1234 });
    h.worker.receive(input(1));
    await flush();
    expect(h.pty.write).toHaveBeenCalledWith('hello\r');
    expect(h.messages.at(-1)).toMatchObject({
      type: 'input-ack',
      sequence: 1,
      status: 'delivered',
    });
  });

  it('rejects input before init and cannot spawn again after failed initialization', async () => {
    const h = harness(true);
    h.worker.receive(input(1));
    await flush();
    expect(h.deps.spawn).not.toHaveBeenCalled();
    h.worker.receive(init);
    await flush();
    h.worker.receive(init);
    await flush();
    expect(h.deps.spawn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.messages)).not.toContain('secret');
    expect(h.messages).toContainEqual({
      ...identity,
      type: 'error',
      code: 'START_FAILED',
    });
  });

  it('does not deliver duplicate input twice and rejects stale writer generations', async () => {
    const h = harness();
    h.worker.receive(init);
    await flush();
    h.worker.receive(input(1));
    h.worker.receive(input(1));
    await flush();
    h.worker.receive(input(1, 'new\r', 2));
    await flush();
    h.worker.receive(input(2, 'old\r', 1));
    await flush();
    expect(h.pty.write).toHaveBeenCalledTimes(2);
    expect(h.messages.at(-1)).toMatchObject({
      type: 'input-ack',
      status: 'unknown',
    });
  });

  it('does not claim a throwing write was not delivered', async () => {
    const h = harness();
    h.worker.receive(init);
    await flush();
    (h.pty.write as jest.Mock).mockImplementation(() => {
      throw new Error('TEST maybe delivered');
    });
    h.worker.receive(input(1));
    await flush();
    h.worker.receive(input(2));
    await flush();
    expect(h.pty.write).toHaveBeenCalledTimes(1);
    expect(h.messages).toContainEqual({
      ...identity,
      type: 'input-ack',
      writerGeneration: 1,
      sequence: 1,
      status: 'unknown',
    });
  });

  it('retains an unknown receipt when its exact input is received again', async () => {
    const h = harness();
    h.worker.receive(init);
    await flush();
    (h.pty.write as jest.Mock).mockImplementation(() => {
      throw new Error('TEST ambiguous write');
    });
    h.worker.receive(input(1));
    await flush();
    h.worker.receive(input(1));
    await flush();
    expect(h.pty.write).toHaveBeenCalledTimes(1);
    expect(h.messages.at(-1)).toMatchObject({
      type: 'input-ack',
      sequence: 1,
      status: 'unknown',
    });
  });

  it('fences an old writer as soon as a newer writer resizes', async () => {
    const h = harness();
    h.worker.receive(init);
    await flush();
    h.worker.receive(input(1));
    await flush();
    h.worker.receive({
      ...identity,
      type: 'resize',
      writerGeneration: 2,
      cols: 100,
      rows: 30,
    });
    h.worker.receive(input(2, 'stale\r', 1));
    h.worker.receive({
      ...identity,
      type: 'resize',
      writerGeneration: 1,
      cols: 60,
      rows: 20,
    });
    await flush();
    expect(h.pty.write).toHaveBeenCalledTimes(1);
    expect(h.pty.resize).toHaveBeenCalledTimes(1);
    h.worker.receive(input(1, 'new\r', 2));
    await flush();
    expect(h.pty.write).toHaveBeenLastCalledWith('new\r');
  });

  it('does not fabricate undelivered receipts after exit or after older receipt eviction', async () => {
    const h = harness();
    h.worker.receive(init);
    await flush();
    h.worker.receive(input(1));
    h.worker.receive(input(2, 'second\r'));
    await flush();
    h.worker.receive(input(1));
    await flush();
    expect(h.messages.at(-1)).toMatchObject({
      type: 'input-ack',
      sequence: 1,
      status: 'unknown',
    });
    h.exit(0);
    await flush();
    h.worker.receive(input(2, 'second\r'));
    await flush();
    expect(h.messages.at(-1)).toMatchObject({
      type: 'input-ack',
      sequence: 2,
      status: 'delivered',
    });
    expect(h.pty.write).toHaveBeenCalledTimes(2);
  });

  it('bounds output frames without cutting Unicode and observes one exit after output', async () => {
    const h = harness();
    h.worker.receive(init);
    await flush();
    const text = '🙂'.repeat(20000);
    h.output(text);
    h.exit(0);
    await flush();
    const output = h.messages.filter((frame) => frame.type === 'output');
    expect(output.map((frame) => frame.text).join('')).toBe(text);
    expect(
      output.every((frame) => Buffer.byteLength(frame.text) <= 65536),
    ).toBe(true);
    expect(h.messages.at(-1)).toEqual({
      ...identity,
      type: 'exit',
      exitCode: 0,
      signal: null,
    });
    h.output('late');
    h.worker.receive(input(1));
    await flush();
    expect(h.pty.write).not.toHaveBeenCalled();
  });

  it('kills on transport loss and never emits fabricated successful exit', async () => {
    const h = harness();
    h.worker.receive(init);
    await flush();
    (h.deps.send as jest.Mock).mockRejectedValueOnce(
      new Error('TEST channel closed'),
    );
    h.output('text');
    await flush();
    expect(h.pty.kill).toHaveBeenCalledTimes(1);
    expect(h.deps.disconnected).toHaveBeenCalled();
    expect(h.messages.filter((frame) => frame.type === 'exit')).toEqual([]);
  });

  it('stops and suppresses input on explicit stop or channel shutdown without treating kill as proof', async () => {
    const h = harness();
    h.worker.receive(init);
    await flush();
    h.worker.receive({ ...identity, type: 'stop' });
    h.worker.receive(input(1));
    await flush();
    expect(h.pty.kill).toHaveBeenCalledTimes(1);
    expect(h.pty.write).not.toHaveBeenCalled();
    expect(h.messages.filter((frame) => frame.type === 'exit')).toEqual([]);
    h.worker.shutdown();
    expect(h.pty.kill).toHaveBeenCalledTimes(1);
  });
});
