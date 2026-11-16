import { createHash } from 'node:crypto';
import {
  parseTerminalFrame,
  TERMINAL_LIMITS,
} from '@/npm-runner/terminal/terminal-protocol';
import type {
  ITerminalIdentity,
  ITerminalInitFrame,
  ParentTerminalFrame,
  WorkerTerminalFrame,
} from '@/npm-runner/terminal/terminal-protocol';

interface IDisposable {
  dispose: () => void;
}
export interface ITerminalWorkerPty {
  readonly pid: number;
  write: (text: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
  pause: () => void;
  resume: () => void;
  onData: (callback: (text: string) => void) => IDisposable;
  onExit: (
    callback: (value: { exitCode: number; signal?: number }) => void,
  ) => IDisposable;
}
export interface ITerminalWorkerDeps {
  spawn: (frame: ITerminalInitFrame) => Promise<ITerminalWorkerPty>;
  send: (frame: WorkerTerminalFrame) => Promise<void>;
  disconnected: () => void;
}

/** The parent owns admission and OS termination proof; this worker never unlocks a job. */
export function createTerminalWorker(
  identity: ITerminalIdentity,
  deps: ITerminalWorkerDeps,
) {
  let pty: ITerminalWorkerPty | null = null;
  let initialized = false;
  let closing = false;
  let killed = false;
  let failed = false;
  let paused = false;
  let draining = false;
  let queuedBytes = 0;
  let inputBlocked = false;
  let writerGeneration = 0;
  let sequence = 0;
  let lastHash = '';
  let lastDelivery: 'delivered' | 'unknown' = 'unknown';
  const queue: { frame: WorkerTerminalFrame; bytes: number }[] = [];
  const disposables: IDisposable[] = [];

  function kill() {
    if (!pty || killed) return;
    killed = true;
    try {
      pty.kill();
    } catch {
      /* Parent independently verifies the complete tree. */
    }
  }
  function disconnect() {
    if (failed) return;
    failed = true;
    closing = true;
    queue.length = 0;
    queuedBytes = 0;
    kill();
    for (const disposable of disposables) disposable.dispose();
    deps.disconnected();
  }
  async function drain() {
    if (draining || failed) return;
    draining = true;
    try {
      while (queue.length && !failed) {
        const next = queue.shift()!;
        await deps.send(next.frame);
        queuedBytes -= next.bytes;
        if (paused && queuedBytes < 128 * 1024 && !closing) {
          paused = false;
          pty?.resume();
        }
      }
    } catch {
      disconnect();
    } finally {
      draining = false;
    }
  }
  function enqueue(frame: WorkerTerminalFrame) {
    if (failed) return;
    const bytes = frame.type === 'output' ? Buffer.byteLength(frame.text) : 256;
    if (
      queuedBytes + bytes > TERMINAL_LIMITS.outputBytes ||
      queue.length >= TERMINAL_LIMITS.outputChunks
    ) {
      // A blocked channel cannot accumulate an unbounded second output buffer.
      disconnect();
      return;
    }
    queue.push({ frame, bytes });
    queuedBytes += bytes;
    if (!paused && queuedBytes >= 256 * 1024 && pty && !closing) {
      paused = true;
      try {
        pty.pause();
      } catch {
        disconnect();
        return;
      }
    }
    void drain();
  }
  function fail(code: 'START_FAILED' | 'WORKER_FAILED') {
    closing = true;
    inputBlocked = true;
    kill();
    enqueue({ ...identity, type: 'error', code });
  }
  function output(text: string) {
    if (closing || failed || text.length === 0) return;
    let fragment = '';
    let bytes = 0;
    for (const character of text) {
      const width = Buffer.byteLength(character);
      if (bytes + width > TERMINAL_LIMITS.pageBytes) {
        enqueue({ ...identity, type: 'output', text: fragment });
        fragment = '';
        bytes = 0;
        if (failed) return;
      }
      fragment += character;
      bytes += width;
    }
    if (fragment) enqueue({ ...identity, type: 'output', text: fragment });
  }
  async function initialize(frame: ITerminalInitFrame) {
    try {
      const spawned = await deps.spawn(frame);
      pty = spawned;
      if (closing || failed) {
        kill();
        return;
      }
      if (!Number.isSafeInteger(spawned.pid) || spawned.pid <= 0) {
        fail('START_FAILED');
        return;
      }
      disposables.push(spawned.onData(output));
      disposables.push(
        spawned.onExit((value) => {
          if (closing || failed) return;
          closing = true;
          inputBlocked = true;
          enqueue({
            ...identity,
            type: 'exit',
            exitCode: Number.isInteger(value.exitCode) ? value.exitCode : null,
            signal:
              value.signal === undefined || value.signal === 0
                ? null
                : String(value.signal),
          });
        }),
      );
      // Only PID is reported. Parent captures authoritative OS creation identity.
      enqueue({ ...identity, type: 'ready', pid: spawned.pid });
    } catch {
      fail('START_FAILED');
    }
  }
  function receive(value: unknown) {
    let frame: ParentTerminalFrame;
    try {
      frame = parseTerminalFrame(value, identity, 'parent');
    } catch {
      fail('WORKER_FAILED');
      return;
    }
    if (frame.type === 'input') {
      const ack = (status: 'delivered' | 'not_delivered' | 'unknown') =>
        enqueue({
          ...identity,
          type: 'input-ack',
          writerGeneration: frame.writerGeneration,
          sequence: frame.sequence,
          status,
        });
      const hash = createHash('sha256').update(frame.text).digest('hex');
      if (
        frame.writerGeneration === writerGeneration &&
        frame.sequence === sequence
      ) {
        if (hash !== lastHash) {
          ack('unknown');
          fail('WORKER_FAILED');
        } else ack(lastDelivery);
        return;
      }
      if (
        frame.writerGeneration < writerGeneration ||
        (frame.writerGeneration === writerGeneration &&
          frame.sequence < sequence)
      ) {
        // Historical receipt metadata is bounded; lack of it cannot prove non-delivery.
        ack('unknown');
        return;
      }
      if (!pty || closing || failed || inputBlocked) {
        ack('not_delivered');
        return;
      }
      const expectedSequence =
        frame.writerGeneration > writerGeneration ? 1 : sequence + 1;
      if (frame.sequence !== expectedSequence) {
        ack('not_delivered');
        return;
      }
      writerGeneration = frame.writerGeneration;
      sequence = frame.sequence;
      lastHash = hash;
      lastDelivery = 'unknown';
      try {
        pty.write(frame.text);
        lastDelivery = 'delivered';
      } catch {
        inputBlocked = true;
      }
      ack(lastDelivery);
      return;
    }
    if (closing || failed) return;
    switch (frame.type) {
      case 'init':
        if (initialized) {
          fail('WORKER_FAILED');
          return;
        }
        initialized = true;
        void initialize(frame);
        break;
      case 'resize':
        if (!pty || inputBlocked || frame.writerGeneration < writerGeneration)
          return;
        if (frame.writerGeneration > writerGeneration) {
          writerGeneration = frame.writerGeneration;
          sequence = 0;
          lastHash = '';
          lastDelivery = 'unknown';
        }
        try {
          pty.resize(frame.cols, frame.rows);
        } catch {
          fail('WORKER_FAILED');
        }
        break;
      case 'stop':
        closing = true;
        inputBlocked = true;
        kill();
        break;
    }
  }
  return {
    receive,
    shutdown() {
      closing = true;
      inputBlocked = true;
      kill();
    },
  };
}
