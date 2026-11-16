import { AppException } from '@/common/exceptions/app.exception';

export const TERMINAL_LIMITS = Object.freeze({
  outputBytes: 1024 * 1024,
  outputChunks: 4096,
  pageBytes: 64 * 1024,
  inputBytes: 4096,
  receipts: 4096,
  colsMin: 2,
  colsMax: 500,
  rowsMin: 1,
  rowsMax: 300,
  arguments: 256,
  environmentEntries: 256,
  initializationBytes: 64 * 1024,
  pathBytes: 32768,
});

export interface ITerminalIdentity {
  jobId: string;
  generation: number;
}
export interface ITerminalSize {
  cols: number;
  rows: number;
}
export interface ITerminalInitFrame extends ITerminalIdentity, ITerminalSize {
  type: 'init';
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}
export interface ITerminalInputFrame extends ITerminalIdentity {
  type: 'input';
  writerGeneration: number;
  sequence: number;
  text: string;
}
export interface ITerminalResizeFrame extends ITerminalIdentity, ITerminalSize {
  type: 'resize';
  writerGeneration: number;
}
export type TerminalDeliveryStatus = 'delivered' | 'not_delivered' | 'unknown';
export type ParentTerminalFrame =
  | ITerminalInitFrame
  | ITerminalInputFrame
  | ITerminalResizeFrame
  | (ITerminalIdentity & { type: 'stop' });
export type WorkerTerminalFrame =
  | (ITerminalIdentity & { type: 'ready'; pid: number })
  | (ITerminalIdentity & { type: 'output'; text: string })
  | (ITerminalIdentity & {
      type: 'input-ack';
      writerGeneration: number;
      sequence: number;
      status: TerminalDeliveryStatus;
    })
  | (ITerminalIdentity & {
      type: 'exit';
      exitCode: number | null;
      signal: string | null;
    })
  | (ITerminalIdentity & {
      type: 'error';
      code: 'START_FAILED' | 'WORKER_FAILED';
    });

export function terminalFailure(status: 400 | 404 | 409, code: string): never {
  throw new AppException(
    status,
    'Terminal request rejected',
    status === 400
      ? 'VALIDATION_ERROR'
      : status === 404
        ? 'NOT_FOUND'
        : 'CONFLICT',
    { terminalCode: code },
  );
}

export function terminalInteger(
  value: unknown,
  min = 1,
  max = Number.MAX_SAFE_INTEGER,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
  );
}

export function assertTerminalUuid(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(
      value,
    )
  ) {
    terminalFailure(400, 'INVALID_IDENTITY');
  }
}

export function assertTerminalIdentity(
  value: ITerminalIdentity,
  expected?: ITerminalIdentity,
): void {
  if (!value || typeof value !== 'object')
    terminalFailure(400, 'INVALID_IDENTITY');
  assertTerminalUuid(value.jobId);
  if (!terminalInteger(value.generation))
    terminalFailure(400, 'INVALID_IDENTITY');
  if (
    expected &&
    (value.jobId !== expected.jobId || value.generation !== expected.generation)
  ) {
    terminalFailure(409, 'WRONG_JOB');
  }
}

export function assertTerminalSize(value: ITerminalSize): void {
  if (
    !terminalInteger(
      value.cols,
      TERMINAL_LIMITS.colsMin,
      TERMINAL_LIMITS.colsMax,
    ) ||
    !terminalInteger(
      value.rows,
      TERMINAL_LIMITS.rowsMin,
      TERMINAL_LIMITS.rowsMax,
    )
  ) {
    terminalFailure(400, 'INVALID_SIZE');
  }
}

export function assertTerminalInput(text: unknown): asserts text is string {
  if (
    typeof text !== 'string' ||
    text.length === 0 ||
    text.length > TERMINAL_LIMITS.inputBytes ||
    Buffer.byteLength(text, 'utf8') > TERMINAL_LIMITS.inputBytes ||
    Buffer.from(text, 'utf8').toString('utf8') !== text
  ) {
    terminalFailure(400, 'INVALID_INPUT');
  }
}

function record(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    terminalFailure(400, 'INVALID_FRAME');
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null)
    terminalFailure(400, 'INVALID_FRAME');
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== 'string' ||
      !descriptor ||
      !('value' in descriptor) ||
      !descriptor.enumerable
    )
      terminalFailure(400, 'INVALID_FRAME');
  }
}

function exact(value: Record<string, unknown>, fields: string[]): void {
  const keys = Object.keys(value);
  const allowed = ['jobId', 'generation', 'type', ...fields];
  if (
    keys.length !== allowed.length ||
    keys.some((key) => !allowed.includes(key))
  )
    terminalFailure(400, 'INVALID_FRAME');
}

function boundedText(
  value: unknown,
  max: number,
  nonempty = false,
): value is string {
  return (
    typeof value === 'string' &&
    (!nonempty || value.length > 0) &&
    value.length <= max &&
    Buffer.byteLength(value) <= max
  );
}

function commandText(value: unknown, max: number): value is string {
  return boundedText(value, max) && !value.includes('\0');
}

function absoluteCommandPath(value: unknown): value is string {
  return (
    commandText(value, TERMINAL_LIMITS.pathBytes) &&
    (/^[a-z]:[\\/]/i.test(value) || /^[\\/]{2}[^\\/]+[\\/][^\\/]+/.test(value))
  );
}

function argumentsArray(value: unknown): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > TERMINAL_LIMITS.arguments ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    terminalFailure(400, 'INVALID_FRAME');
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      !descriptor ||
      !('value' in descriptor) ||
      !descriptor.enumerable ||
      !commandText(descriptor.value, TERMINAL_LIMITS.initializationBytes)
    )
      terminalFailure(400, 'INVALID_FRAME');
  }
}

export function parseTerminalFrame(
  value: unknown,
  expected: ITerminalIdentity,
  direction: 'parent',
): ParentTerminalFrame;
export function parseTerminalFrame(
  value: unknown,
  expected: ITerminalIdentity,
  direction: 'worker',
): WorkerTerminalFrame;
export function parseTerminalFrame(
  value: unknown,
  expected: ITerminalIdentity,
  direction: 'parent' | 'worker',
): ParentTerminalFrame | WorkerTerminalFrame {
  record(value);
  assertTerminalIdentity(expected);
  assertTerminalIdentity(value as unknown as ITerminalIdentity, expected);
  if (direction === 'parent') {
    switch (value.type) {
      case 'init': {
        exact(value, ['file', 'args', 'cwd', 'env', 'cols', 'rows']);
        assertTerminalSize(value as unknown as ITerminalSize);
        for (const path of [value.file, value.cwd]) {
          if (!absoluteCommandPath(path)) terminalFailure(400, 'INVALID_FRAME');
        }
        argumentsArray(value.args);
        const args = value.args;
        if (
          args.reduce((bytes, arg) => bytes + Buffer.byteLength(arg), 0) >
          TERMINAL_LIMITS.initializationBytes
        )
          terminalFailure(400, 'INVALID_FRAME');
        record(value.env);
        const entries = Object.entries(value.env);
        if (
          entries.length > TERMINAL_LIMITS.environmentEntries ||
          entries.some(
            ([key, entry]) =>
              !key ||
              key.includes('=') ||
              !commandText(key, TERMINAL_LIMITS.initializationBytes) ||
              !commandText(entry, TERMINAL_LIMITS.initializationBytes),
          )
        )
          terminalFailure(400, 'INVALID_FRAME');
        if (
          entries.reduce(
            (bytes, [key, entry]) =>
              bytes +
              Buffer.byteLength(key) +
              Buffer.byteLength(entry as string),
            0,
          ) > TERMINAL_LIMITS.initializationBytes
        )
          terminalFailure(400, 'INVALID_FRAME');
        return {
          ...value,
          args: [...args],
          env: Object.fromEntries(entries),
        } as unknown as ITerminalInitFrame;
      }
      case 'input':
        exact(value, ['writerGeneration', 'sequence', 'text']);
        if (
          !terminalInteger(value.writerGeneration) ||
          !terminalInteger(value.sequence)
        )
          terminalFailure(400, 'INVALID_SEQUENCE');
        assertTerminalInput(value.text);
        break;
      case 'resize':
        exact(value, ['writerGeneration', 'cols', 'rows']);
        if (!terminalInteger(value.writerGeneration))
          terminalFailure(400, 'INVALID_SEQUENCE');
        assertTerminalSize(value as unknown as ITerminalSize);
        break;
      case 'stop':
        exact(value, []);
        break;
      default:
        terminalFailure(400, 'INVALID_FRAME');
    }
  } else if (direction === 'worker') {
    switch (value.type) {
      case 'ready':
        exact(value, ['pid']);
        if (!terminalInteger(value.pid)) terminalFailure(400, 'INVALID_FRAME');
        break;
      case 'output':
        exact(value, ['text']);
        if (!boundedText(value.text, TERMINAL_LIMITS.pageBytes, true))
          terminalFailure(400, 'INVALID_FRAME');
        break;
      case 'input-ack':
        exact(value, ['writerGeneration', 'sequence', 'status']);
        if (
          !terminalInteger(value.writerGeneration) ||
          !terminalInteger(value.sequence) ||
          !['delivered', 'not_delivered', 'unknown'].includes(
            value.status as string,
          )
        )
          terminalFailure(400, 'INVALID_FRAME');
        break;
      case 'exit':
        exact(value, ['exitCode', 'signal']);
        if (
          value.exitCode !== null &&
          (typeof value.exitCode !== 'number' ||
            !Number.isSafeInteger(value.exitCode))
        )
          terminalFailure(400, 'INVALID_FRAME');
        if (
          value.signal !== null &&
          (!boundedText(value.signal, 64, true) || value.signal.includes('\0'))
        )
          terminalFailure(400, 'INVALID_FRAME');
        break;
      case 'error':
        exact(value, ['code']);
        if (!['START_FAILED', 'WORKER_FAILED'].includes(value.code as string))
          terminalFailure(400, 'INVALID_FRAME');
        break;
      default:
        terminalFailure(400, 'INVALID_FRAME');
    }
  } else {
    terminalFailure(400, 'INVALID_FRAME');
  }
  return { ...value } as unknown as ParentTerminalFrame | WorkerTerminalFrame;
}

export class TerminalWorkerInbox {
  private readonly identity: ITerminalIdentity;
  private initialized = false;

  constructor(identity: ITerminalIdentity) {
    assertTerminalIdentity(identity);
    this.identity = { ...identity };
  }

  accept(value: unknown): ParentTerminalFrame {
    const frame = parseTerminalFrame(value, this.identity, 'parent');
    if (frame.type === 'init') {
      if (this.initialized) terminalFailure(409, 'ALREADY_INITIALIZED');
      this.initialized = true;
    } else if (!this.initialized) {
      terminalFailure(409, 'NOT_INITIALIZED');
    }
    return frame;
  }
}
