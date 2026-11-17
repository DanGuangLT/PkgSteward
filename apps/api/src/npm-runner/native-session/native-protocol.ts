import { AppException } from '@/common/exceptions/app.exception';
import { isFullyQualifiedPath } from '@/common/utils/path.util';
import type { NativeShell } from '@/npm-runner/interfaces/npm-runner.types';
import { types } from 'node:util';

export const NATIVE_LIMITS = Object.freeze({
  // Two Windows env blocks can each approach 128KiB in UTF-8. Reserve room
  // for both, escaping and argv, while bounding every individual allocation.
  maxFrameBytes: 2 * 1024 * 1024,
  maxEnvBytes: 256 * 1024,
  maxEnvEntries: 2048,
  maxArgs: 256,
  maxArgBytes: 64 * 1024,
  maxPathBytes: 32 * 1024,
  maxGeneration: 2 ** 31 - 1,
});

export interface INativeSessionIdentity {
  jobId: string;
  generation: number;
}
interface IFrame<T extends string> extends INativeSessionIdentity {
  type: T;
}
interface IExitResult {
  exitCode: number | null;
  signal: string | null;
}
export interface INativeInitCommand extends IFrame<'init'> {
  initialFile: string;
  initialArgs: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  shell: NativeShell;
  shellFile: string;
  shellArgs: string[];
  shellEnv: NodeJS.ProcessEnv;
}
export type NativeBridgeCommand =
  INativeInitCommand | IFrame<'open-shell-go'> | IFrame<'stop'>;
export type NativeCoordinatorCommand =
  (IFrame<'spawn-bridge'> & { execPath: string }) | NativeBridgeCommand;
export type NativeBridgeErrorCode =
  'CONSOLE_UNAVAILABLE' | 'START_FAILED' | 'PROTOCOL_ERROR' | 'WORKER_FAILED';
export type NativeBridgeFrame =
  | (IFrame<'bridge-ready' | 'initial-spawned' | 'shell-spawned'> & {
      pid: number;
    })
  | (IFrame<'initial-result' | 'session-exit'> & IExitResult)
  | (IFrame<'bridge-error'> & { code: NativeBridgeErrorCode; message: string });
export type NativeSupervisorFrame =
  | IFrame<'supervisor-ready'>
  | (IFrame<'bridge-spawned'> & { pid: number })
  | (IFrame<'bridge-frame'> & { payload: NativeBridgeFrame })
  | (IFrame<'bridge-exit'> & IExitResult)
  | (IFrame<'supervisor-error'> & {
      code: 'START_FAILED' | 'PROTOCOL_ERROR';
      message: string;
    });

export class NativeProtocolError extends AppException {
  constructor(
    reason:
      'INVALID_FRAME' | 'INVALID_IDENTITY' | 'WRONG_JOB' | 'INVALID_SEQUENCE',
  ) {
    super(400, 'Invalid native session protocol', reason);
  }
}
const invalid = (): never => {
  throw new NativeProtocolError('INVALID_FRAME');
};
type PlainRecord = Record<string, unknown>;

// Check descriptors before reading values. In particular never call raw
// JSON.stringify/toJSON, accessors, or iterators supplied over the boundary.
function record(raw: unknown, maxKeys: number): PlainRecord {
  if (
    !raw ||
    typeof raw !== 'object' ||
    types.isProxy(raw) ||
    Array.isArray(raw)
  )
    return invalid();
  const prototype: unknown = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  const keys = Reflect.ownKeys(raw);
  if (keys.length > maxKeys) return invalid();
  const result: PlainRecord = Object.create(null) as PlainRecord;
  for (const key of keys) {
    if (typeof key !== 'string') return invalid();
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
      return invalid();
    result[key] = descriptor.value as unknown;
  }
  return result;
}
function exact(raw: PlainRecord, fields: readonly string[]): void {
  const keys = Object.keys(raw);
  if (
    keys.length !== fields.length ||
    keys.some((key) => !fields.includes(key))
  )
    invalid();
}
class FrameBudget {
  private bytes = 0;
  add(bytes: number): void {
    this.bytes += bytes;
    if (this.bytes > NATIVE_LIMITS.maxFrameBytes) invalid();
  }
  string(value: string): void {
    this.add(Buffer.byteLength(value, 'utf8') + 2);
    // Extra bytes introduced by JSON escaping, calculated over bounded strings.
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code < 32) this.add([8, 9, 10, 12, 13].includes(code) ? 1 : 5);
      else if (code === 34 || code === 92) this.add(1);
    }
  }
  object(raw: PlainRecord): void {
    this.add(2);
    for (const key of Object.keys(raw)) {
      string(key, NATIVE_LIMITS.maxEnvBytes, this);
      this.add(2); // colon and a conservative comma allowance
    }
  }
}
function string(
  raw: unknown,
  maxBytes: number,
  budget: FrameBudget,
  empty = false,
): string {
  // UTF-16 length is a cheap lower bound on UTF-8 bytes; reject huge inputs
  // before scanning/encoding. Lone surrogates cannot round-trip through IPC.
  if (
    typeof raw !== 'string' ||
    raw.length > maxBytes ||
    (!empty && raw.length === 0) ||
    raw.includes('\0') ||
    /[\uD800-\uDFFF]/u.test(raw) ||
    Buffer.byteLength(raw, 'utf8') > maxBytes
  )
    return invalid();
  budget.string(raw);
  return raw;
}
function path(raw: unknown, budget: FrameBudget): string {
  const value = string(raw, NATIVE_LIMITS.maxPathBytes, budget);
  if (!isFullyQualifiedPath(value, 'win32') || /[\r\n]/.test(value))
    return invalid();
  return value;
}
function integer(raw: unknown, budget: FrameBudget, positive = false): number {
  if (
    typeof raw !== 'number' ||
    !Number.isSafeInteger(raw) ||
    (positive && raw <= 0)
  )
    return invalid();
  budget.add(String(raw).length);
  return raw;
}
function args(raw: unknown, budget: FrameBudget): string[] {
  if (
    !Array.isArray(raw) ||
    types.isProxy(raw) ||
    Object.getPrototypeOf(raw) !== Array.prototype ||
    raw.length > NATIVE_LIMITS.maxArgs ||
    Reflect.ownKeys(raw).length !== raw.length + 1
  )
    return invalid();
  const result: string[] = [];
  let bytes = 0;
  budget.add(2);
  for (let index = 0; index < raw.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, String(index));
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
      return invalid();
    const value = string(
      descriptor.value,
      NATIVE_LIMITS.maxArgBytes,
      budget,
      true,
    );
    bytes += Buffer.byteLength(value, 'utf8');
    if (bytes > NATIVE_LIMITS.maxArgBytes) return invalid();
    budget.add(1);
    result.push(value);
  }
  return result;
}
function env(
  raw: unknown,
  shell: boolean,
  budget: FrameBudget,
): NodeJS.ProcessEnv {
  const values = record(raw, NATIVE_LIMITS.maxEnvEntries);
  budget.object(values);
  const result: NodeJS.ProcessEnv = Object.create(null) as NodeJS.ProcessEnv;
  const seen = new Set<string>();
  let bytes = 0;
  for (const [key, value] of Object.entries(values)) {
    const upper = key.toUpperCase();
    if (
      key.includes('=') ||
      ['__PROTO__', 'CONSTRUCTOR', 'PROTOTYPE'].includes(upper) ||
      seen.has(upper)
    )
      return invalid();
    seen.add(upper);
    // The key has already been bounded/charged by object().
    const text = string(value, NATIVE_LIMITS.maxEnvBytes, budget, true);
    bytes += Buffer.byteLength(key, 'utf8') + Buffer.byteLength(text, 'utf8');
    if (bytes > NATIVE_LIMITS.maxEnvBytes) return invalid();
    if (
      upper === 'NODE_OPTIONS' ||
      upper.startsWith('NODE_CHANNEL_') ||
      upper === 'PKGSTEWARD_DATA_DIR'
    )
      continue;
    if (
      shell &&
      (upper.startsWith('PKGSTEWARD_') ||
        upper.startsWith('NPM_') ||
        upper === 'CI' ||
        upper === 'NO_COLOR' ||
        upper === 'FORCE_COLOR')
    )
      continue;
    result[key] = text;
  }
  return result;
}
export const sanitizeInitialEnv = (raw: unknown): NodeJS.ProcessEnv =>
  env(raw, false, new FrameBudget());
export const sanitizeShellEnv = (raw: unknown): NodeJS.ProcessEnv =>
  env(raw, true, new FrameBudget());

function identity(raw: PlainRecord): INativeSessionIdentity {
  if (
    typeof raw.jobId !== 'string' ||
    !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(
      raw.jobId,
    ) ||
    typeof raw.generation !== 'number' ||
    !Number.isSafeInteger(raw.generation) ||
    raw.generation <= 0 ||
    raw.generation > NATIVE_LIMITS.maxGeneration
  )
    throw new NativeProtocolError('INVALID_IDENTITY');
  return { jobId: raw.jobId, generation: raw.generation };
}
function header(
  raw: unknown,
  expected: INativeSessionIdentity,
  budget: FrameBudget,
): PlainRecord {
  const expectedRecord = record(expected, 2);
  exact(expectedRecord, ['jobId', 'generation']);
  identity(expectedRecord);
  const value = record(raw, 11);
  const actual = identity(value);
  if (
    actual.jobId !== expected.jobId ||
    actual.generation !== expected.generation
  )
    throw new NativeProtocolError('WRONG_JOB');
  budget.object(value);
  string(value.jobId, 36, budget);
  integer(value.generation, budget, true);
  string(value.type, 32, budget);
  return value;
}
const fields = (value: PlainRecord, extra: readonly string[]): void =>
  exact(value, ['jobId', 'generation', 'type', ...extra]);
function outcome(value: PlainRecord, budget: FrameBudget): IExitResult {
  fields(value, ['exitCode', 'signal']);
  return {
    exitCode:
      value.exitCode === null
        ? (budget.add(4), null)
        : integer(value.exitCode, budget),
    signal:
      value.signal === null
        ? (budget.add(4), null)
        : string(value.signal, 64, budget),
  };
}
export function parseCoordinatorToSupervisorFrame(
  raw: unknown,
  expected: INativeSessionIdentity,
): NativeCoordinatorCommand {
  const budget = new FrameBudget();
  const value = header(raw, expected, budget);
  const base = identity(value);
  switch (value.type) {
    case 'spawn-bridge':
      fields(value, ['execPath']);
      return {
        ...base,
        type: 'spawn-bridge',
        execPath: path(value.execPath, budget),
      };
    case 'init': {
      fields(value, [
        'initialFile',
        'initialArgs',
        'cwd',
        'env',
        'shell',
        'shellFile',
        'shellArgs',
        'shellEnv',
      ]);
      if (value.shell !== 'cmd' && value.shell !== 'powershell')
        return invalid();
      string(value.shell, 10, budget);
      return {
        ...base,
        type: 'init',
        initialFile: path(value.initialFile, budget),
        initialArgs: args(value.initialArgs, budget),
        cwd: path(value.cwd, budget),
        env: env(value.env, false, budget),
        shell: value.shell,
        shellFile: path(value.shellFile, budget),
        shellArgs: args(value.shellArgs, budget),
        shellEnv: env(value.shellEnv, true, budget),
      };
    }
    case 'open-shell-go':
    case 'stop':
      fields(value, []);
      return { ...base, type: value.type };
    default:
      return invalid();
  }
}
export function parseSupervisorToBridgeFrame(
  raw: unknown,
  expected: INativeSessionIdentity,
): NativeBridgeCommand {
  const frame = parseCoordinatorToSupervisorFrame(raw, expected);
  if (frame.type === 'spawn-bridge') return invalid();
  return frame;
}
function bridge(
  raw: unknown,
  expected: INativeSessionIdentity,
  budget: FrameBudget,
): NativeBridgeFrame {
  const value = header(raw, expected, budget);
  const base = identity(value);
  switch (value.type) {
    case 'bridge-ready':
    case 'initial-spawned':
    case 'shell-spawned':
      fields(value, ['pid']);
      return {
        ...base,
        type: value.type,
        pid: integer(value.pid, budget, true),
      };
    case 'initial-result':
    case 'session-exit':
      return { ...base, type: value.type, ...outcome(value, budget) };
    case 'bridge-error': {
      fields(value, ['code', 'message']);
      if (
        value.code !== 'CONSOLE_UNAVAILABLE' &&
        value.code !== 'START_FAILED' &&
        value.code !== 'PROTOCOL_ERROR' &&
        value.code !== 'WORKER_FAILED'
      )
        return invalid();
      string(value.code, 32, budget);
      return {
        ...base,
        type: 'bridge-error',
        code: value.code,
        message: string(value.message, 4096, budget),
      };
    }
    default:
      return invalid();
  }
}
export const parseBridgeToSupervisorFrame = (
  raw: unknown,
  expected: INativeSessionIdentity,
): NativeBridgeFrame => bridge(raw, expected, new FrameBudget());
export function parseSupervisorToCoordinatorFrame(
  raw: unknown,
  expected: INativeSessionIdentity,
): NativeSupervisorFrame {
  const budget = new FrameBudget();
  const value = header(raw, expected, budget);
  const base = identity(value);
  switch (value.type) {
    case 'supervisor-ready':
      fields(value, []);
      return { ...base, type: 'supervisor-ready' };
    case 'bridge-spawned':
      fields(value, ['pid']);
      return {
        ...base,
        type: 'bridge-spawned',
        pid: integer(value.pid, budget, true),
      };
    case 'bridge-frame':
      fields(value, ['payload']);
      return {
        ...base,
        type: 'bridge-frame',
        payload: bridge(value.payload, expected, budget),
      };
    case 'bridge-exit':
      return { ...base, type: 'bridge-exit', ...outcome(value, budget) };
    case 'supervisor-error':
      fields(value, ['code', 'message']);
      if (value.code !== 'START_FAILED' && value.code !== 'PROTOCOL_ERROR')
        return invalid();
      string(value.code, 32, budget);
      return {
        ...base,
        type: 'supervisor-error',
        code: value.code,
        message: string(value.message, 4096, budget),
      };
    default:
      return invalid();
  }
}

// Transport-local one-shot ordering. The coordinator separately verifies the
// process identities and initial subtree before permitting each next command.
export class NativeCommandSequence {
  private phase: 'starting' | 'bridge' | 'initial' | 'shell' | 'stopped' =
    'starting';
  private readonly identity: INativeSessionIdentity;
  constructor(expected: INativeSessionIdentity) {
    const value = record(expected, 2);
    exact(value, ['jobId', 'generation']);
    this.identity = identity(value);
  }
  accept(raw: unknown): NativeCoordinatorCommand {
    const frame = parseCoordinatorToSupervisorFrame(raw, this.identity);
    const next =
      frame.type === 'stop' && this.phase !== 'stopped'
        ? 'stopped'
        : frame.type === 'spawn-bridge' && this.phase === 'starting'
          ? 'bridge'
          : frame.type === 'init' && this.phase === 'bridge'
            ? 'initial'
            : frame.type === 'open-shell-go' && this.phase === 'initial'
              ? 'shell'
              : null;
    if (!next) throw new NativeProtocolError('INVALID_SEQUENCE');
    this.phase = next;
    return frame;
  }
}
