import { assertTerminalIdentity } from '@/npm-runner/terminal/terminal-protocol';
import type {
  ITerminalIdentity,
  WorkerTerminalFrame,
} from '@/npm-runner/terminal/terminal-protocol';
import { createTerminalWorker } from '@/npm-runner/terminal/terminal-worker';
import type { ITerminalWorkerPty } from '@/npm-runner/terminal/terminal-worker';

export interface ITerminalWorkerChannel {
  onMessage(callback: (frame: unknown) => void): void;
  onDisconnect(callback: () => void): void;
  send(
    frame: WorkerTerminalFrame,
    callback: (error: Error | null) => void,
  ): void;
  close(): void;
}
export interface IPtyModule {
  spawn(
    file: string,
    args: string[] | string,
    options: Parameters<typeof import('node-pty').spawn>[2],
  ): ITerminalWorkerPty;
}

/** Importing this module in the API never imports or initializes native PTY code. */
export function attachTerminalWorker(
  identity: ITerminalIdentity,
  channel: ITerminalWorkerChannel,
  load: () => Promise<IPtyModule> = () => import('node-pty'),
) {
  assertTerminalIdentity(identity);
  const worker = createTerminalWorker(identity, {
    async spawn(frame) {
      const native = await load();
      // Worker-only native-spawn exception: parent already resolved and validated this command.
      return native.spawn(frame.file, frame.args, {
        cwd: frame.cwd,
        env: frame.env,
        cols: frame.cols,
        rows: frame.rows,
        name: 'xterm-256color',
        useConpty: true,
        encoding: 'utf8',
      });
    },
    send: (frame) =>
      new Promise<void>((resolve, reject) => {
        try {
          channel.send(frame, (error) => (error ? reject(error) : resolve()));
        } catch (error) {
          reject(
            error instanceof Error ? error : new Error('Worker send failed'),
          );
        }
      }),
    disconnected: () => channel.close(),
  });
  channel.onMessage(worker.receive);
  channel.onDisconnect(() => worker.shutdown());
  return worker;
}

if (require.main === module) {
  try {
    const identity = {
      jobId: process.argv[2],
      generation: Number(process.argv[3]),
    };
    if (!process.send) throw new Error('Missing worker IPC channel');
    attachTerminalWorker(identity, {
      onMessage: (callback) => process.on('message', callback),
      onDisconnect: (callback) => process.on('disconnect', callback),
      send: (frame, callback) => {
        if (!process.connected || !process.send) {
          callback(new Error('Worker IPC disconnected'));
          return;
        }
        process.send(frame, callback);
      },
      close: () => {
        process.exitCode = 1;
        try {
          if (process.connected) process.disconnect();
        } catch {
          /* Parent observes the closed worker. */
        }
      },
    });
  } catch {
    process.exitCode = 1;
    try {
      if (process.connected) process.disconnect();
    } catch {
      /* No process was admitted. */
    }
  }
}
