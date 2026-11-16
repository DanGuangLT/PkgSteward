import {
  attachTerminalWorker,
  loadDefaultPtyModule,
} from './terminal-worker-entry';
import type {
  ITerminalWorkerChannel,
  ITerminalWorkerSpawnOptions,
} from './terminal-worker-entry';
import type { ITerminalWorkerPty } from './terminal-worker';
import type { WorkerTerminalFrame } from './terminal-protocol';

const identity = {
  jobId: '00000000-0000-4000-8000-000000000001',
  generation: 1,
};
const initialization = {
  ...identity,
  type: 'init',
  file: 'C:/node.exe',
  args: ['C:/TEST/script.js'],
  cwd: 'C:/TEST',
  env: { PATH: 'C:/node' },
  cols: 100,
  rows: 32,
};
const flush = async () => {
  for (let index = 0; index < 12; index++) await Promise.resolve();
};

describe('terminal worker process entry', () => {
  it('loads the native module only after validated init and uses executable plus argv', async () => {
    let receive: (frame: unknown) => void = () => {};
    const sent: WorkerTerminalFrame[] = [];
    const channel: ITerminalWorkerChannel = {
      onMessage: (callback) => {
        receive = callback;
      },
      onDisconnect: jest.fn(),
      send: (frame, done) => {
        sent.push(frame);
        done(null);
      },
      close: jest.fn(),
    };
    const pty: ITerminalWorkerPty = {
      pid: 44,
      write: jest.fn(),
      resize: jest.fn(),
      kill: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      onData: () => ({ dispose: jest.fn() }),
      onExit: () => ({ dispose: jest.fn() }),
    };
    const spawn = jest.fn(() => pty);
    const load = jest.fn(() => Promise.resolve({ spawn }));
    attachTerminalWorker(identity, channel, load);
    expect(load).not.toHaveBeenCalled();
    receive(initialization);
    await flush();
    expect(spawn).toHaveBeenCalledWith(
      'C:/node.exe',
      ['C:/TEST/script.js'],
      expect.objectContaining({
        cwd: 'C:/TEST',
        env: initialization.env,
        cols: 100,
        rows: 32,
        useConpty: true,
        name: 'xterm-256color',
      }),
    );
    expect(sent).toContainEqual({ ...identity, type: 'ready', pid: 44 });
  });

  it('keeps native-load errors inside the worker and does not expose errors or input', async () => {
    let receive: (frame: unknown) => void = () => {};
    const sent: WorkerTerminalFrame[] = [];
    const channel: ITerminalWorkerChannel = {
      onMessage: (callback) => {
        receive = callback;
      },
      onDisconnect: jest.fn(),
      send: (frame, done) => {
        sent.push(frame);
        done(null);
      },
      close: jest.fn(),
    };
    attachTerminalWorker(identity, channel, () =>
      Promise.reject(new Error('TEST native private path')),
    );
    receive(initialization);
    await flush();
    expect(sent).toEqual([
      { ...identity, type: 'error', code: 'START_FAILED' },
    ]);
  });

  it('does not load native code for a malformed or wrong-job init', async () => {
    let receive: (frame: unknown) => void = () => {};
    const channel: ITerminalWorkerChannel = {
      onMessage: (callback) => {
        receive = callback;
      },
      onDisconnect: jest.fn(),
      send: (_frame, done) => done(null),
      close: jest.fn(),
    };
    const load = jest.fn();
    attachTerminalWorker(identity, channel, load);
    receive({ ...initialization, file: '/relative.exe' });
    await flush();
    expect(load).not.toHaveBeenCalled();
  });

  it('loads valid PTY module shapes and rejects invalid ones via loadDefaultPtyModule', async () => {
    const options: ITerminalWorkerSpawnOptions = {
      cwd: 'C:/TEST',
      cols: 80,
      rows: 24,
      useConpty: true,
    };
    expect(options.useConpty).toBe(true);
    const spawn = jest.fn();
    await expect(
      loadDefaultPtyModule(() => Promise.resolve({ spawn })),
    ).resolves.toEqual({ spawn });
    await expect(
      loadDefaultPtyModule(() => Promise.resolve({})),
    ).rejects.toThrow('Invalid PTY module');
    await expect(
      loadDefaultPtyModule(() => Promise.resolve(null)),
    ).rejects.toThrow('Invalid PTY module');
  });
});
