import { lstat, readdir, rm } from 'node:fs/promises';
import { win32 } from 'node:path';
import { GLOBAL_CWD_TEMP_PREFIX } from '@/global-packages/discovery/global-location';

const OWN_NAME = new RegExp(`^${GLOBAL_CWD_TEMP_PREFIX}(\\d+)$`);

export const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
};

export interface IGlobalCwdCleanupDeps {
  readdir(path: string): Promise<string[]>;
  lstat(path: string): Promise<{
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
  }>;
  rm(path: string, options: { recursive: true; force: true }): Promise<void>;
  isProcessAlive(pid: number): boolean;
}

const defaultDeps: IGlobalCwdCleanupDeps = {
  readdir: (path) => readdir(path),
  lstat: (path) => lstat(path),
  rm: (path, options) => rm(path, options),
  isProcessAlive,
};

// Best effort: startup must never fail because of leftover temp folders.
export async function sweepStaleGlobalCwds(
  tempBase: string,
  currentPid: number,
  deps: IGlobalCwdCleanupDeps = defaultDeps,
): Promise<void> {
  let names: string[];
  try {
    const baseStat = await deps.lstat(tempBase);
    if (baseStat.isSymbolicLink() || !baseStat.isDirectory()) return;
    names = await deps.readdir(tempBase);
  } catch {
    return;
  }
  for (const name of names) {
    const match = OWN_NAME.exec(name);
    if (!match) continue;
    const pid = Number(match[1]);
    if (!Number.isSafeInteger(pid) || pid <= 0 || pid === currentPid) continue;
    if (deps.isProcessAlive(pid)) continue;
    const target = win32.join(tempBase, name);
    try {
      const stat = await deps.lstat(target);
      if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
      await deps.rm(target, { recursive: true, force: true });
    } catch {
      // Ignore ENOENT/EBUSY/EPERM: another process may be cleaning too.
    }
  }
}

export async function removeOwnGlobalCwd(
  cwd: string,
  deps: Pick<IGlobalCwdCleanupDeps, 'lstat' | 'rm'> = defaultDeps,
): Promise<void> {
  if (!OWN_NAME.test(win32.basename(cwd))) return;
  try {
    const stat = await deps.lstat(cwd);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return;
    await deps.rm(cwd, { recursive: true, force: true });
  } catch {
    // Best effort.
  }
}
