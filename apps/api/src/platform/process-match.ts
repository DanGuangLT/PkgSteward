import type { IProcessInfo } from '@/platform/interfaces/process-snapshot.interface';

export interface IProcessMatch {
  pid: number;
  name: string;
}

export function matchProcessesToRoots(
  processes: readonly IProcessInfo[],
  roots: readonly string[],
  platform: NodeJS.Platform,
  selfPid: number,
): Map<string, IProcessMatch[]> {
  const windows = platform === 'win32';
  const separator = windows ? '\\' : '/';
  const normalize = (value: string) =>
    windows ? value.replace(/\//g, '\\').toLowerCase() : value;
  const candidates = processes
    .filter(({ pid }) => pid !== selfPid)
    .map((process) => ({
      pid: process.pid,
      name: process.name,
      executablePath: normalize(process.executablePath ?? ''),
      commandLine: normalize(process.commandLine ?? ''),
    }));
  const matchesRoot = (text: string, root: string): boolean => {
    if (root === '') return false;
    let offset = text.indexOf(root);
    while (offset !== -1) {
      const next = text[offset + root.length];
      if (
        next === undefined ||
        next === separator ||
        next === '"' ||
        next === "'" ||
        /\s/.test(next)
      )
        return true;
      offset = text.indexOf(root, offset + 1);
    }
    return false;
  };

  const result = new Map<string, IProcessMatch[]>();
  for (const root of roots) {
    const comparableRoot = normalize(root).replace(
      windows ? /\\+$/ : /\/+$/,
      '',
    );
    const matches: IProcessMatch[] = [];
    const seen = new Set<number>();
    for (const process of candidates) {
      if (
        !seen.has(process.pid) &&
        (matchesRoot(process.executablePath, comparableRoot) ||
          matchesRoot(process.commandLine, comparableRoot))
      ) {
        seen.add(process.pid);
        matches.push({ pid: process.pid, name: process.name });
      }
    }
    result.set(root, matches);
  }
  return result;
}
