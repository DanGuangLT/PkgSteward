import * as fsp from 'node:fs/promises';
import { join, resolve, win32 } from 'node:path';
import type { IRunRecoveryHold } from '@/npm-runner/interfaces/npm-runner.types';
import { pathApi, toComparable } from '@/common/utils/path.util';
import type { PathPlatform } from '@/common/utils/path.util';
import type {
  INativeSessionSnapshot,
  NativeSessionPhase,
  NativeTermination,
} from '@/npm-runner/native-session/native-session';
import type { INativeSessionIdentity } from '@/npm-runner/native-session/native-protocol';
import type {
  INativeProcessIdentity,
  IWindowsNativeConsole,
} from '@/platform/windows/windows-native-console';
import type { INativeExitOutcome } from '@/npm-runner/native-session/native-console-supervisor';

export const NATIVE_RECOVERY_JOURNAL_FILE =
  'native-project-terminal-session.json';
export const NATIVE_RECOVERY_TEMP_FILE =
  'native-project-terminal-session.json.tmp';
const MAX_JOURNAL_BYTES = 256 * 1024;
const VALID_PHASES: ReadonlySet<string> = new Set<NativeSessionPhase>([
  'launching',
  'supervisor_ready',
  'bridge_starting',
  'bridge_ready',
  'initial_running',
  'initial_finished',
  'shell_starting',
  'shell_running',
  'stopping',
  'lost',
  'closed',
]);
const VALID_TERMINATIONS: ReadonlySet<string> = new Set<NativeTermination>([
  'session_exit',
  'user_stop',
  'initial_timeout',
  'handshake_timeout',
  'parent_exit',
  'ipc_lost',
  'window_closed',
  'protocol_error',
  'start_failed',
  'journal_failed',
  'termination_unconfirmed',
]);

export interface IRecoveryFileStat {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  size: number;
}
export interface IRecoveryWriteHandle {
  writeAll(content: string): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}
export interface IRecoveryFs {
  mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
  lstat(path: string): Promise<IRecoveryFileStat>;
  realpath(path: string): Promise<string>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  openExclusiveWrite(path: string): Promise<IRecoveryWriteHandle>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
}
export interface INativeRecoveryStartup {
  active: boolean;
  reason?: string;
  journalPath?: string;
  hold: IRunRecoveryHold | null;
  snapshot: INativeSessionSnapshot | null;
}
export interface INativeRecoveryClearCheck {
  clearable: boolean;
  reason: string | null;
  snapshot: INativeSessionSnapshot | null;
}
export interface INativeRecoveryStore {
  readonly journalPath: string;
  readonly tempPath: string;
  persist(snapshot: INativeSessionSnapshot): Promise<void>;
  evaluateOnStartup(): Promise<INativeRecoveryStartup>;
  verifyClearable(): Promise<INativeRecoveryClearCheck>;
  removeMarkers(identity?: INativeSessionIdentity): Promise<void>;
}

export function createNodeRecoveryFs(): IRecoveryFs {
  return {
    mkdir: (target, options) => fsp.mkdir(target, options),
    lstat: (target) => fsp.lstat(target),
    realpath: (target) => fsp.realpath(target),
    readFile: (target, encoding) => fsp.readFile(target, encoding),
    openExclusiveWrite: async (target) => {
      const handle = await fsp.open(target, 'wx', 0o600);
      return {
        writeAll: (content) => handle.writeFile(content, 'utf8'),
        sync: () => handle.sync(),
        close: () => handle.close(),
      };
    },
    rename: (from, to) => fsp.rename(from, to),
    unlink: (target) => fsp.unlink(target),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}
function isProcessIdentity(value: unknown): value is INativeProcessIdentity {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.pid === 'number' &&
    Number.isSafeInteger(value.pid) &&
    value.pid > 0 &&
    typeof value.creationTime === 'string' &&
    value.creationTime.length > 0 &&
    typeof value.executablePath === 'string' &&
    value.executablePath.length > 0 &&
    typeof value.parentPid === 'number' &&
    Number.isSafeInteger(value.parentPid) &&
    value.parentPid >= 0
  );
}
function isExitOutcome(value: unknown): value is INativeExitOutcome {
  if (!isPlainObject(value)) return false;
  const exitOk =
    value.exitCode === null ||
    (typeof value.exitCode === 'number' &&
      Number.isSafeInteger(value.exitCode));
  const signalOk = value.signal === null || typeof value.signal === 'string';
  return exitOk && signalOk;
}
function parseSnapshot(raw: string): INativeSessionSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  if (
    parsed.schema !== 1 ||
    typeof parsed.jobId !== 'string' ||
    parsed.jobId.length === 0 ||
    typeof parsed.generation !== 'number' ||
    !Number.isSafeInteger(parsed.generation) ||
    parsed.generation < 1 ||
    parsed.generation > 2 ** 31 - 1 ||
    typeof parsed.fingerprint !== 'string' ||
    typeof parsed.phase !== 'string' ||
    !VALID_PHASES.has(parsed.phase) ||
    typeof parsed.initialRetired !== 'boolean'
  ) {
    return null;
  }
  if (!isPlainObject(parsed.entries)) return null;
  const entryFields = ['execPath', 'supervisorFile', 'bridgeFile', 'shellFile'];
  if (Object.keys(parsed.entries).length !== entryFields.length) return null;
  for (const field of entryFields) {
    if (
      typeof parsed.entries[field] !== 'string' ||
      parsed.entries[field].length === 0
    )
      return null;
  }
  if (!isPlainObject(parsed.identities)) return null;
  for (const [role, id] of Object.entries(parsed.identities)) {
    if (!['supervisor', 'bridge', 'initial', 'shell'].includes(role))
      return null;
    if (id !== undefined && !isProcessIdentity(id)) return null;
  }
  if (
    !Array.isArray(parsed.tracked) ||
    !parsed.tracked.every(isProcessIdentity)
  )
    return null;
  if (parsed.initialOutcome !== null && !isExitOutcome(parsed.initialOutcome))
    return null;
  if (parsed.sessionOutcome !== null && !isExitOutcome(parsed.sessionOutcome))
    return null;
  if (
    parsed.termination !== null &&
    (typeof parsed.termination !== 'string' ||
      !VALID_TERMINATIONS.has(parsed.termination))
  ) {
    return null;
  }
  return parsed as unknown as INativeSessionSnapshot;
}

const isEnoent = (error: unknown): boolean =>
  error !== null &&
  typeof error === 'object' &&
  'code' in error &&
  error.code === 'ENOENT';

export function createNativeRecoveryStore(deps: {
  dataDir: string;
  platform: PathPlatform;
  fs: IRecoveryFs;
  console: Pick<IWindowsNativeConsole, 'descendants' | 'verifyGone'>;
}): INativeRecoveryStore {
  const pathLib = pathApi(deps.platform);
  const resolvedDir =
    deps.platform === 'win32'
      ? win32.resolve(deps.dataDir)
      : resolve(deps.dataDir);
  const journalPath =
    deps.platform === 'win32'
      ? win32.join(resolvedDir, NATIVE_RECOVERY_JOURNAL_FILE)
      : join(resolvedDir, NATIVE_RECOVERY_JOURNAL_FILE);
  const tempPath =
    deps.platform === 'win32'
      ? win32.join(resolvedDir, NATIVE_RECOVERY_TEMP_FILE)
      : join(resolvedDir, NATIVE_RECOVERY_TEMP_FILE);
  let queue: Promise<void> = Promise.resolve();
  const sealedRuns = new Set<string>();
  const runKey = (identity: INativeSessionIdentity): string =>
    `${identity.jobId}:${identity.generation}`;

  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  const assertSafeDirectory = async (): Promise<void> => {
    await deps.fs.mkdir(resolvedDir, { recursive: true });
    const stat = await deps.fs.lstat(resolvedDir);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error('Unsafe native recovery directory');
    const real = await deps.fs.realpath(resolvedDir);
    if (
      toComparable(real, deps.platform) !==
      toComparable(resolvedDir, deps.platform)
    )
      throw new Error('Native recovery directory symlink mismatch');
  };
  const probeFile = async (
    target: string,
  ): Promise<
    | { status: 'absent' }
    | { status: 'unsafe' }
    | { status: 'oversized' }
    | { status: 'ok'; content: string }
  > => {
    let stat: IRecoveryFileStat;
    try {
      stat = await deps.fs.lstat(target);
    } catch (error) {
      if (isEnoent(error)) return { status: 'absent' };
      return { status: 'unsafe' };
    }
    if (stat.isSymbolicLink() || !stat.isFile()) return { status: 'unsafe' };
    if (stat.size > MAX_JOURNAL_BYTES) return { status: 'oversized' };
    const real = await deps.fs.realpath(target);
    const expected = pathLib.resolve(target);
    if (
      toComparable(real, deps.platform) !==
      toComparable(expected, deps.platform)
    )
      return { status: 'unsafe' };
    const content = await deps.fs.readFile(target, 'utf8');
    if (Buffer.byteLength(content, 'utf8') > MAX_JOURNAL_BYTES)
      return { status: 'oversized' };
    return { status: 'ok', content };
  };
  const inspectMarkers = async (): Promise<INativeRecoveryStartup> => {
    const [tempProbe, mainProbe] = await Promise.all([
      probeFile(tempPath),
      probeFile(journalPath),
    ]);
    if (tempProbe.status === 'unsafe' || mainProbe.status === 'unsafe') {
      const hold: IRunRecoveryHold = {
        active: true,
        reason: 'UNSAFE_JOURNAL',
        journalPath,
      };
      return {
        active: true,
        reason: hold.reason,
        journalPath,
        hold,
        snapshot: null,
      };
    }
    if (tempProbe.status !== 'absent') {
      const snapshot =
        mainProbe.status === 'ok' ? parseSnapshot(mainProbe.content) : null;
      const hold: IRunRecoveryHold = {
        active: true,
        reason: 'CORRUPT_OR_PARTIAL_JOURNAL',
        journalPath,
      };
      return {
        active: true,
        reason: hold.reason,
        journalPath,
        hold,
        snapshot,
      };
    }
    if (mainProbe.status === 'absent') {
      return { active: false, hold: null, snapshot: null };
    }
    if (mainProbe.status === 'oversized') {
      const hold: IRunRecoveryHold = {
        active: true,
        reason: 'CORRUPT_OR_PARTIAL_JOURNAL',
        journalPath,
      };
      return {
        active: true,
        reason: hold.reason,
        journalPath,
        hold,
        snapshot: null,
      };
    }
    const snapshot = parseSnapshot(mainProbe.content);
    if (!snapshot) {
      const hold: IRunRecoveryHold = {
        active: true,
        reason: 'CORRUPT_OR_PARTIAL_JOURNAL',
        journalPath,
      };
      return {
        active: true,
        reason: hold.reason,
        journalPath,
        hold,
        snapshot: null,
      };
    }
    const reason =
      snapshot.phase === 'closed'
        ? 'UNFINALIZED_JOURNAL'
        : 'UNRESOLVED_NATIVE_SESSION';
    const hold: IRunRecoveryHold = { active: true, reason, journalPath };
    return { active: true, reason, journalPath, hold, snapshot };
  };
  const safeUnlink = async (target: string): Promise<void> => {
    let dirStat: IRecoveryFileStat;
    try {
      dirStat = await deps.fs.lstat(resolvedDir);
    } catch (error) {
      if (isEnoent(error)) return;
      throw error;
    }
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink())
      throw new Error('Unsafe native recovery directory');
    const realDir = await deps.fs.realpath(resolvedDir);
    if (
      toComparable(realDir, deps.platform) !==
      toComparable(resolvedDir, deps.platform)
    )
      throw new Error('Native recovery directory symlink mismatch');
    let stat: IRecoveryFileStat;
    try {
      stat = await deps.fs.lstat(target);
    } catch (error) {
      if (isEnoent(error)) return;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new Error('Unsafe native recovery marker');
    await deps.fs.unlink(target);
  };
  return {
    journalPath,
    tempPath,
    persist: (snapshot) =>
      enqueue(async () => {
        if (sealedRuns.has(runKey(snapshot))) return;
        await assertSafeDirectory();
        const existingMain = await probeFile(journalPath);
        if (existingMain.status === 'unsafe')
          throw new Error('Unsafe native recovery journal');
        const existingTemp = await probeFile(tempPath);
        if (existingTemp.status !== 'absent')
          throw new Error('Exclusive temp journal already exists');
        const payload = JSON.stringify(snapshot);
        if (Buffer.byteLength(payload, 'utf8') > MAX_JOURNAL_BYTES)
          throw new Error('Native recovery snapshot exceeds size limit');
        const handle = await deps.fs.openExclusiveWrite(tempPath);
        let closed = false;
        try {
          await handle.writeAll(payload);
          await handle.sync();
          await handle.close();
          closed = true;
          await deps.fs.rename(tempPath, journalPath);
        } finally {
          if (!closed) {
            try {
              await handle.close();
            } catch {
              /* ignore secondary close failure */
            }
          }
        }
      }),
    evaluateOnStartup: () => enqueue(() => inspectMarkers()),
    verifyClearable: () =>
      enqueue(async () => {
        const state = await inspectMarkers();
        if (!state.active) {
          return { clearable: true, reason: null, snapshot: null };
        }
        const snap = state.snapshot;
        if (!snap) {
          return { clearable: true, reason: null, snapshot: null };
        }
        const liveSeeds = [
          snap.identities.bridge,
          ...(snap.initialRetired ? [] : [snap.identities.initial]),
          snap.identities.shell,
        ].filter((id): id is INativeProcessIdentity => Boolean(id));
        const seeds = [
          ...(snap.identities.supervisor ? [snap.identities.supervisor] : []),
          ...liveSeeds,
        ];
        const allOwned = [
          ...new Map(
            [...seeds, ...snap.tracked].map((id) => [
              `${id.pid}:${id.creationTime}`,
              id,
            ]),
          ).values(),
        ];
        if (allOwned.length === 0) {
          return { clearable: true, reason: null, snapshot: snap };
        }
        const tree = await deps.console.descendants(seeds, snap.tracked);
        if (tree.status !== 'ok' || tree.identities.length > 0) {
          return {
            clearable: false,
            reason: 'PROCESSES_STILL_ACTIVE',
            snapshot: snap,
          };
        }
        const gone = await deps.console.verifyGone(allOwned);
        if (gone !== 'verified') {
          return {
            clearable: false,
            reason: 'PROCESSES_STILL_ACTIVE',
            snapshot: snap,
          };
        }
        return { clearable: true, reason: null, snapshot: snap };
      }),
    removeMarkers: (identity) =>
      enqueue(async () => {
        if (identity) {
          if (sealedRuns.size >= 100) sealedRuns.clear();
          sealedRuns.add(runKey(identity));
        }
        await safeUnlink(tempPath);
        await safeUnlink(journalPath);
      }),
  };
}
