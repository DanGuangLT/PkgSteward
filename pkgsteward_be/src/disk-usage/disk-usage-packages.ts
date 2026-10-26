import type { Dirent } from 'node:fs';
import {
  isSameOrInside,
  pathApi,
  toComparable,
} from '@/common/utils/path.util';
import type {
  IDiskUsageRow,
  IDiskWalkDeps,
} from '@/disk-usage/interfaces/disk-usage.types';

export const DISK_ROW_LIMIT = 2000;

export const listPackageTargets = async (
  root: string,
  signal: AbortSignal,
  deps: IDiskWalkDeps,
): Promise<IDiskUsageRow[]> => {
  const { fs, platform, isProtected } = deps;
  const api = pathApi(platform);
  const rootKey = toComparable(root, platform);
  const rows: IDiskUsageRow[] = [];
  const targets = new Map<string, IDiskUsageRow>();
  let limited = false;
  const add = (row: IDiskUsageRow) => {
    if (signal.aborted || limited) return;
    if (row.canonicalPath) {
      const key = toComparable(row.canonicalPath, platform);
      const existing = targets.get(key);
      if (existing) {
        existing.aliases.push(...row.aliases);
        return;
      }
    }
    if (rows.length === DISK_ROW_LIMIT) {
      limited = true;
      deps.onRowLimit?.();
      return;
    }
    rows.push(row);
    if (row.canonicalPath) {
      targets.set(toComparable(row.canonicalPath, platform), row);
    }
  };
  const rowFor = (path: string, name: string): IDiskUsageRow => ({
    path,
    name,
    kind: 'package',
    canonicalPath: null,
    aliases: [name],
    state: 'pending',
    sizeBytes: null,
    fileCount: null,
    reason: null,
  });
  const exclude = (row: IDiskUsageRow, reason: IDiskUsageRow['reason']) => {
    row.state = 'excluded';
    row.reason = reason;
    add(row);
  };
  const inspect = async (path: string, name: string, scope = false) => {
    const row = rowFor(path, name);
    if (isProtected(path)) {
      exclude(row, 'protected');
      return null;
    }
    let canonical: string;
    try {
      if (signal.aborted) return null;
      const stats = await fs.lstat(path, signal);
      if (signal.aborted) return null;
      if (scope && stats.isSymbolicLink()) {
        exclude(row, 'link_skipped');
        return null;
      }
      if (!stats.isDirectory() && !stats.isSymbolicLink()) {
        exclude(row, 'unsupported');
        return null;
      }
      canonical = api.resolve(await fs.realpath(path, signal));
      if (signal.aborted) return null;
    } catch {
      if (!signal.aborted) exclude(row, 'unreadable');
      return null;
    }
    const canonicalKey = toComparable(canonical, platform);
    if (!isSameOrInside(canonicalKey, rootKey, platform)) {
      exclude(row, 'outside_root');
      return null;
    }
    if (isProtected(canonical)) {
      exclude(row, 'protected');
      return null;
    }
    if (canonicalKey === rootKey) {
      exclude(row, 'link_skipped');
      return null;
    }
    if (scope) return canonical;
    // Chỉ stat đích sau containment/matcher; không mở cây qua alias.
    try {
      const target = await fs.lstat(canonical, signal);
      if (signal.aborted) return null;
      if (!target.isDirectory() || target.isSymbolicLink()) {
        exclude(row, 'unsupported');
        return null;
      }
    } catch {
      if (!signal.aborted) exclude(row, 'unreadable');
      return null;
    }
    row.canonicalPath = canonical;
    add(row);
    return canonical;
  };

  if (signal.aborted) return rows;
  for await (const entry of fs.entries(root, signal)) {
    if (signal.aborted || limited) break;
    if (entry.name.startsWith('.')) continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const path = api.join(root, entry.name);
    if (!entry.name.startsWith('@')) {
      await inspect(path, entry.name);
      if (signal.aborted) break;
      continue;
    }
    const scope = await inspect(path, entry.name, true);
    if (signal.aborted || limited) break;
    if (!scope) continue;
    // Scope chỉ một cấp; junction scope bị loại trước khi enumerate.
    const iterator = fs.entries(scope, signal)[Symbol.asyncIterator]();
    try {
      while (!signal.aborted && !limited) {
        let result: IteratorResult<Dirent>;
        try {
          result = await iterator.next();
        } catch {
          if (!signal.aborted) exclude(rowFor(path, entry.name), 'unreadable');
          break;
        }
        if (signal.aborted || result.done) break;
        const child = result.value;
        if (child.name.startsWith('.')) continue;
        if (!child.isDirectory() && !child.isSymbolicLink()) continue;
        await inspect(
          api.join(scope, child.name),
          `${entry.name}/${child.name}`,
        );
      }
    } finally {
      await iterator.return?.();
    }
  }
  return rows;
};
