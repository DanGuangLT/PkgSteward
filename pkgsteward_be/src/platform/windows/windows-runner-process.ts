import type {
  IProcessInfo,
  IProcessSnapshot,
} from '@/platform/interfaces/process-snapshot.interface';
import { win32 } from 'node:path';
import { execa } from 'execa';
import { windowsSystemRoot } from '@/platform/windows/windows-process-snapshot';

export interface IRunnerProcessIdentity {
  pid: number;
  creationTime: string;
}

export type RunnerIdentityResult =
  { status: 'ok'; identity: IRunnerProcessIdentity } | { status: 'unknown' };

export type RunnerTreeResult =
  | { status: 'ok'; identities: IRunnerProcessIdentity[] }
  | { status: 'unknown' };

export type RunnerStopOutcome = 'verified' | 'unconfirmed';
export type RunnerStopAttempt = 'attempted' | 'unconfirmed';

export interface IWindowsRunnerProcess {
  capture(rootPid: number): Promise<RunnerIdentityResult>;
  descendants(
    root: IRunnerProcessIdentity,
    tracked?: readonly IRunnerProcessIdentity[],
  ): Promise<RunnerTreeResult>;
  /** A helper exit is not verification; caller must still call verifyGone. */
  stopTree(
    root: IRunnerProcessIdentity,
    tracked: readonly IRunnerProcessIdentity[],
  ): Promise<RunnerStopAttempt>;
  verifyGone(
    tracked: readonly IRunnerProcessIdentity[],
  ): Promise<RunnerStopOutcome>;
}

export interface IWindowsRunnerProcessDeps {
  snapshot: IProcessSnapshot;
  /** Already validated environment value; adapter still refuses non-local paths. */
  systemRoot: string | undefined;
  now(): number;
  sleep(delayMs: number): Promise<void>;
}

export function createWindowsRunnerProcess(
  deps: IWindowsRunnerProcessDeps,
): IWindowsRunnerProcess {
  const rootDir = windowsSystemRoot(deps.systemRoot);
  const valid = (identity: IRunnerProcessIdentity): boolean =>
    Number.isSafeInteger(identity.pid) &&
    identity.pid > 0 &&
    typeof identity.creationTime === 'string' &&
    Number.isFinite(Date.parse(identity.creationTime));
  const coherent = (identities: readonly IRunnerProcessIdentity[]): boolean => {
    const seen = new Map<number, string>();
    for (const identity of identities) {
      if (
        !valid(identity) ||
        (seen.has(identity.pid) &&
          seen.get(identity.pid) !== identity.creationTime)
      )
        return false;
      seen.set(identity.pid, identity.creationTime);
    }
    return true;
  };
  const read = async (
    timeoutMs?: number,
  ): Promise<Map<number, IProcessInfo> | null> => {
    try {
      const result = await deps.snapshot.capture(timeoutMs);
      if (result.status !== 'ok' || result.processes.length > 100_000)
        return null;
      const byPid = new Map<number, IProcessInfo>();
      for (const process of result.processes) {
        if (byPid.has(process.pid)) return null;
        byPid.set(process.pid, process);
      }
      return byPid;
    } catch {
      return null;
    }
  };
  const identityOf = (process: IProcessInfo): IRunnerProcessIdentity | null => {
    if (typeof process.creationTime !== 'string') return null;
    const identity = { pid: process.pid, creationTime: process.creationTime };
    return valid(identity) ? identity : null;
  };
  const capture = async (rootPid: number): Promise<RunnerIdentityResult> => {
    if (!rootDir || !Number.isSafeInteger(rootPid) || rootPid <= 0)
      return { status: 'unknown' };
    const snapshot = await read();
    const process = snapshot?.get(rootPid);
    const identity = process ? identityOf(process) : null;
    return identity ? { status: 'ok', identity } : { status: 'unknown' };
  };
  const descendants = async (
    root: IRunnerProcessIdentity,
    tracked: readonly IRunnerProcessIdentity[] = [],
  ): Promise<RunnerTreeResult> => {
    if (!rootDir || !coherent([root, ...tracked])) return { status: 'unknown' };
    const snapshot = await read();
    if (!snapshot) return { status: 'unknown' };
    const seeds = [root, ...tracked];
    const found = new Map<number, IRunnerProcessIdentity>();
    for (const identity of seeds) {
      const present = snapshot.get(identity.pid);
      if (present && present.creationTime !== identity.creationTime)
        return { status: 'unknown' };
      if (present && identity.pid !== root.pid)
        found.set(identity.pid, identity);
    }
    const children = new Map<number, IProcessInfo[]>();
    for (const process of snapshot.values()) {
      if (typeof process.parentPid !== 'number') continue;
      const group = children.get(process.parentPid) ?? [];
      group.push(process);
      children.set(process.parentPid, group);
    }
    const visited = new Set(seeds.map(({ pid }) => pid));
    const queue = [...visited];
    for (let index = 0; index < queue.length; index++) {
      for (const process of children.get(queue[index]) ?? []) {
        if (visited.has(process.pid)) continue;
        const identity = identityOf(process);
        if (!identity) return { status: 'unknown' };
        if (Date.parse(identity.creationTime) < Date.parse(root.creationTime))
          continue;
        visited.add(identity.pid);
        found.set(identity.pid, identity);
        queue.push(identity.pid);
      }
    }
    return { status: 'ok', identities: [...found.values()] };
  };
  const stopTree = async (
    root: IRunnerProcessIdentity,
    tracked: readonly IRunnerProcessIdentity[],
  ): Promise<RunnerStopAttempt> => {
    if (!rootDir || !coherent([root, ...tracked])) return 'unconfirmed';
    let snapshot = await read();
    if (!snapshot) return 'unconfirmed';
    const original = snapshot.get(root.pid);
    if (original && !identityOf(original)) return 'unconfirmed';
    const candidates = [
      ...new Map(
        [
          ...(original?.creationTime === root.creationTime ? [root] : []),
          ...tracked,
        ].map((identity) => [identity.pid, identity]),
      ).values(),
    ];
    let outcome: RunnerStopAttempt = 'attempted';
    let refresh = false;
    for (let index = 0; index < candidates.length; index++) {
      if (refresh) {
        snapshot = await read();
        refresh = false;
      }
      if (!snapshot) return 'unconfirmed';
      const identity = candidates[index];
      const present = snapshot.get(identity.pid);
      if (!present) continue;
      if (!identityOf(present)) {
        outcome = 'unconfirmed';
        continue;
      }
      if (present.creationTime !== identity.creationTime) continue;
      refresh = true;
      try {
        const result = await execa(
          win32.join(rootDir, 'System32', 'taskkill.exe'),
          ['/PID', String(identity.pid), '/T', '/F'],
          {
            timeout: 10_000,
            windowsHide: true,
            shell: false,
            preferLocal: false,
            stdin: 'ignore',
            stdout: 'ignore',
            stderr: 'ignore',
            buffer: false,
            all: false,
            verbose: 'none',
            reject: false,
          },
        );
        if (result.exitCode !== 0) outcome = 'unconfirmed';
      } catch {
        outcome = 'unconfirmed';
      }
    }
    return outcome;
  };
  const verifyGone = async (
    tracked: readonly IRunnerProcessIdentity[],
  ): Promise<RunnerStopOutcome> => {
    if (!rootDir || !tracked.length || !coherent(tracked)) return 'unconfirmed';
    const start = deps.now();
    let emptyAt: number | null = null;
    while (deps.now() - start < 10_000) {
      const snapshot = await read(10_000 - (deps.now() - start));
      if (!snapshot || deps.now() - start >= 10_000) return 'unconfirmed';
      let empty = true;
      for (const identity of tracked) {
        const present = snapshot.get(identity.pid);
        if (present && !identityOf(present)) return 'unconfirmed';
        if (present?.creationTime === identity.creationTime) empty = false;
      }
      const now = deps.now();
      if (empty && emptyAt !== null && now - emptyAt >= 250) return 'verified';
      emptyAt = empty ? now : null;
      try {
        await deps.sleep(Math.min(250, 10_000 - (now - start)));
      } catch {
        return 'unconfirmed';
      }
    }
    return 'unconfirmed';
  };
  return { capture, descendants, stopTree, verifyGone };
}
