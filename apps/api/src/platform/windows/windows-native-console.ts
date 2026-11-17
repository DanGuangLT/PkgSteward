import { win32 } from 'node:path';
import type {
  IRunnerFs,
  IRunnerFileIdentity,
  NativeShell,
} from '@/npm-runner/interfaces/npm-runner.types';
import type {
  IProcessInfo,
  IProcessSnapshot,
} from '@/platform/interfaces/process-snapshot.interface';
import type {
  IWindowsRunnerProcess,
  RunnerStopAttempt,
  RunnerStopOutcome,
} from '@/platform/windows/windows-runner-process';
import {
  runnerIdentity,
  sameRunnerIdentity,
} from '@/npm-runner/toolchain/runner-tool';
import { windowsSystemRoot } from '@/platform/windows/windows-process-snapshot';
import { isFullyQualifiedPath, toComparable } from '@/common/utils/path.util';

export interface INativeProcessIdentity {
  pid: number;
  creationTime: string;
  executablePath: string;
  parentPid: number;
}
export interface INativeConsolePreflight {
  execPath: string;
  supervisorFile: string;
  bridgeFile: string;
  shell: NativeShell;
  shellFile: string;
  shellArgs: string[];
  systemRoot: string;
  files: IRunnerFileIdentity[];
}
export type NativePreflightResult =
  { status: 'ok'; value: INativeConsolePreflight } | { status: 'unavailable' };
export type NativeIdentityResult =
  { status: 'ok'; identity: INativeProcessIdentity } | { status: 'unknown' };
export type NativeTreeResult =
  | { status: 'ok'; identities: INativeProcessIdentity[] }
  | { status: 'unknown' };
export interface IWindowsNativeConsole {
  /** Base runtime capability; selected shell availability is checked at start. */
  capability(): Promise<boolean>;
  preflight(shell: NativeShell): Promise<NativePreflightResult>;
  revalidate(value: INativeConsolePreflight): Promise<boolean>;
  capture(
    pid: number,
    expectedFile: string,
    parentPid: number,
  ): Promise<NativeIdentityResult>;
  descendants(
    liveSeeds: readonly INativeProcessIdentity[],
    tracked: readonly INativeProcessIdentity[],
  ): Promise<NativeTreeResult>;
  stopTree(
    liveSeeds: readonly INativeProcessIdentity[],
    tracked: readonly INativeProcessIdentity[],
  ): Promise<RunnerStopAttempt>;
  verifyGone(
    identities: readonly INativeProcessIdentity[],
  ): Promise<RunnerStopOutcome>;
}
export interface IWindowsNativeConsoleDeps {
  fs: IRunnerFs;
  snapshot: IProcessSnapshot;
  processes: IWindowsRunnerProcess;
  platform: string;
  execPath: string;
  systemRoot: string | undefined;
  /** Canonical installed API package root, containing dist/. */
  appInstallDir: string;
}
const samePath = (a: string, b: string): boolean =>
  toComparable(a, 'win32') === toComparable(b, 'win32');
const positivePid = (pid: number): boolean =>
  Number.isSafeInteger(pid) && pid > 0;
function processIdentity(value: IProcessInfo): INativeProcessIdentity | null {
  if (
    !positivePid(value.pid) ||
    !Number.isSafeInteger(value.parentPid) ||
    (value.parentPid ?? -1) < 0 ||
    typeof value.creationTime !== 'string' ||
    !Number.isFinite(Date.parse(value.creationTime)) ||
    typeof value.executablePath !== 'string' ||
    !isFullyQualifiedPath(value.executablePath, 'win32')
  )
    return null;
  return {
    pid: value.pid,
    creationTime: value.creationTime,
    executablePath: value.executablePath,
    parentPid: value.parentPid!,
  };
}
const matches = (
  a: INativeProcessIdentity,
  b: INativeProcessIdentity,
): boolean =>
  a.pid === b.pid &&
  a.creationTime === b.creationTime &&
  a.parentPid === b.parentPid &&
  samePath(a.executablePath, b.executablePath);

/** Seeds remain authorized until independently verified gone and retired. */
export function createWindowsNativeConsole(
  deps: IWindowsNativeConsoleDeps,
): IWindowsNativeConsole {
  const systemRoot = windowsSystemRoot(deps.systemRoot);
  const read = async (): Promise<Map<number, IProcessInfo> | null> => {
    try {
      const result = await deps.snapshot.capture();
      if (result.status !== 'ok' || result.processes.length > 100_000)
        return null;
      const byPid = new Map<number, IProcessInfo>();
      for (const process of result.processes) {
        if (
          !Number.isSafeInteger(process.pid) ||
          process.pid < 0 ||
          byPid.has(process.pid)
        )
          return null;
        byPid.set(process.pid, process);
      }
      return byPid;
    } catch {
      return null;
    }
  };
  const checkFile = async (
    file: string,
  ): Promise<IRunnerFileIdentity | null> => {
    if (!isFullyQualifiedPath(file, 'win32')) return null;
    const before = runnerIdentity(file, await deps.fs.lstat(file));
    if (
      !before.stat.isFile() ||
      before.stat.isSymbolicLink() ||
      !samePath(await deps.fs.realpath(file), file)
    )
      return null;
    const after = await deps.fs.lstat(file);
    return sameRunnerIdentity(before.stat, after) ? before : null;
  };
  const capability = async (): Promise<boolean> => {
    if (
      deps.platform !== 'win32' ||
      !systemRoot ||
      win32.basename(deps.execPath).toLowerCase() !== 'node.exe' ||
      !isFullyQualifiedPath(deps.appInstallDir, 'win32')
    )
      return false;
    try {
      const dir = win32.join(
        deps.appInstallDir,
        'dist',
        'npm-runner',
        'native-session',
      );
      for (const file of [
        deps.execPath,
        win32.join(dir, 'native-console-supervisor.js'),
        win32.join(dir, 'native-console-entry.js'),
      ]) {
        if (!(await checkFile(file))) return false;
      }
      return true;
    } catch {
      return false;
    }
  };
  const preflight = async (
    shell: NativeShell,
  ): Promise<NativePreflightResult> => {
    if (
      deps.platform !== 'win32' ||
      !systemRoot ||
      !['cmd', 'powershell'].includes(shell) ||
      win32.basename(deps.execPath).toLowerCase() !== 'node.exe' ||
      !isFullyQualifiedPath(deps.appInstallDir, 'win32')
    )
      return { status: 'unavailable' };
    try {
      const dir = win32.join(
        deps.appInstallDir,
        'dist',
        'npm-runner',
        'native-session',
      );
      const value: INativeConsolePreflight = {
        execPath: deps.execPath,
        supervisorFile: win32.join(dir, 'native-console-supervisor.js'),
        bridgeFile: win32.join(dir, 'native-console-entry.js'),
        shell,
        systemRoot,
        shellFile:
          shell === 'cmd'
            ? win32.join(systemRoot, 'System32', 'cmd.exe')
            : win32.join(
                systemRoot,
                'System32',
                'WindowsPowerShell',
                'v1.0',
                'powershell.exe',
              ),
        shellArgs: shell === 'cmd' ? ['/d'] : ['-NoLogo', '-NoProfile'],
        files: [],
      };
      for (const file of [
        value.execPath,
        value.supervisorFile,
        value.bridgeFile,
        value.shellFile,
      ]) {
        const identity = await checkFile(file);
        if (!identity) return { status: 'unavailable' };
        value.files.push(identity);
      }
      return { status: 'ok', value };
    } catch {
      return { status: 'unavailable' };
    }
  };
  const revalidate = async (
    value: INativeConsolePreflight,
  ): Promise<boolean> => {
    try {
      if (value.files.length !== 4) return false;
      for (const file of value.files) {
        const current = await checkFile(file.path);
        if (!current || !sameRunnerIdentity(file.stat, current.stat))
          return false;
      }
      return true;
    } catch {
      return false;
    }
  };
  const capture = async (
    pid: number,
    expectedFile: string,
    parentPid: number,
  ): Promise<NativeIdentityResult> => {
    if (!positivePid(pid) || !positivePid(parentPid))
      return { status: 'unknown' };
    const process = (await read())?.get(pid);
    const identity = process ? processIdentity(process) : null;
    return identity &&
      identity.parentPid === parentPid &&
      samePath(identity.executablePath, expectedFile)
      ? { status: 'ok', identity }
      : { status: 'unknown' };
  };
  const discover = async (
    seeds: readonly INativeProcessIdentity[],
    tracked: readonly INativeProcessIdentity[],
  ): Promise<NativeTreeResult> => {
    const snapshot = await read();
    if (!snapshot) return { status: 'unknown' };
    const found = new Map<number, INativeProcessIdentity>();
    const live = new Map<number, INativeProcessIdentity>();
    for (const identity of [...seeds, ...tracked]) {
      const present = snapshot.get(identity.pid);
      if (!present) {
        live.set(identity.pid, identity);
        continue;
      }
      const current = processIdentity(present);
      if (!current) return { status: 'unknown' };
      if (matches(identity, current)) live.set(identity.pid, identity);
      // An unretired PID reused by another process makes old orphan cleanup unknown.
      else return { status: 'unknown' };
    }
    const queue = [...live.values()];
    const visited = new Set(live.keys());
    for (const id of tracked) if (live.has(id.pid)) found.set(id.pid, id);
    for (let index = 0; index < queue.length; index++) {
      const parent = queue[index];
      for (const process of snapshot.values()) {
        if (process.parentPid !== parent.pid || visited.has(process.pid))
          continue;
        const identity = processIdentity(process);
        if (!identity) return { status: 'unknown' };
        if (Date.parse(identity.creationTime) < Date.parse(parent.creationTime))
          continue;
        visited.add(identity.pid);
        found.set(identity.pid, identity);
        queue.push(identity);
      }
    }
    return { status: 'ok', identities: [...found.values()] };
  };
  const stopTree = async (
    seeds: readonly INativeProcessIdentity[],
    tracked: readonly INativeProcessIdentity[],
  ): Promise<RunnerStopAttempt> => {
    const snapshot = await read();
    if (!snapshot) return 'unconfirmed';
    const candidates = new Map<number, INativeProcessIdentity>();
    for (const identity of [...seeds, ...tracked]) {
      const present = snapshot.get(identity.pid);
      if (!present) continue;
      const current = processIdentity(present);
      if (!current) return 'unconfirmed';
      if (matches(identity, current)) candidates.set(identity.pid, identity);
      else return 'unconfirmed';
    }
    // Existing primitive re-snapshots immediately before each taskkill.
    let outcome: RunnerStopAttempt = 'attempted';
    for (const identity of candidates.values()) {
      if ((await deps.processes.stopTree(identity, [])) !== 'attempted')
        outcome = 'unconfirmed';
    }
    return outcome;
  };
  return {
    capability,
    preflight,
    revalidate,
    capture,
    descendants: discover,
    stopTree,
    verifyGone: (ids) =>
      ids.length ? deps.processes.verifyGone(ids) : Promise.resolve('verified'),
  };
}
