import {
  ForbiddenException,
  InternalServerException,
  NotFoundException,
  ValidationException,
} from '@/common/exceptions/app.exception';
import { pathApi, type PathPlatform } from '@/common/utils/path.util';
import type { PathCheckResult } from '@/core/path-guard/interfaces/path-guard.types';
import { classifyTargets } from '@/file-ops/file-ops-targets';
import type {
  IFileOpsDirent,
  IFileOpsFs,
  IFileTreeLevel,
  ITreeEntry,
  TargetFailureCode,
} from '@/file-ops/interfaces/file-ops.types';
import type { IStoredScanResult } from '@/scanner/interfaces/scanner.types';

export const TREE_ENTRY_LIMIT = 2_000;

// Message ngắn, không kèm path/lỗi fs thô (đã có trong failureCode).
const failureException = (code: TargetFailureCode): Error => {
  switch (code) {
    case 'NOT_FOUND':
      return new NotFoundException('Path');
    case 'DENYLISTED':
    case 'OUTSIDE_ALLOWLIST':
      return new ForbiddenException('Path is not allowed');
    case 'OUTSIDE_SCANNED_PROJECT':
      return new ForbiddenException('Path is not inside a scanned project');
    case 'STAT_FAILED':
      return new InternalServerException('Cannot read path');
    case 'INVALID_PATH':
      return new ValidationException('Invalid path');
    case 'IS_LINK':
      return new ValidationException('Path is a link');
    case 'UNSUPPORTED_TYPE':
      return new ValidationException('Path is not a directory');
    case 'PROJECT_CHANGED':
      return new ValidationException('Project changed since the last scan');
    case 'NOT_ORPHAN':
      return new ValidationException(
        'node_modules is no longer orphaned since the last scan',
      );
  }
};

const isMissing = (error: unknown): boolean =>
  error !== null &&
  typeof error === 'object' &&
  'code' in error &&
  (error.code === 'ENOENT' || error.code === 'ENOTDIR');

const compareEntries = (a: ITreeEntry, b: ITreeEntry): number => {
  const group = Number(b.type === 'directory') - Number(a.type === 'directory');
  if (group !== 0) return group;
  const byName = a.name.localeCompare(b.name, 'en', {
    numeric: true,
    sensitivity: 'base',
  });
  if (byName !== 0) return byName;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
};

export async function readTreeLevel(
  inputPath: string,
  scan: Pick<IStoredScanResult, 'projects' | 'orphanNodeModules'>,
  deps: {
    platform: PathPlatform;
    checkMany(paths: readonly string[]): Promise<PathCheckResult[]>;
    fs: Pick<IFileOpsFs, 'lstat'> & {
      entries(path: string, signal: AbortSignal): AsyncIterable<IFileOpsDirent>;
    };
    signal: AbortSignal;
  },
): Promise<IFileTreeLevel> {
  const { platform, fs, signal } = deps;
  const api = pathApi(platform);
  signal.throwIfAborted();
  const checks = await deps.checkMany([inputPath]);
  signal.throwIfAborted();
  const [target] = await classifyTargets([inputPath], checks, scan, {
    platform,
    fs,
  });
  signal.throwIfAborted();
  if (!target.valid) throw failureException(target.failureCode!);
  if (target.identity?.type !== 'directory')
    throw new ValidationException('Path is not a directory');
  // Cây chỉ cho bên trong project: orphan không có owner thì không liệt kê.
  if (!target.owner)
    throw new ForbiddenException('Path is not inside a scanned project');

  const entries: ITreeEntry[] = [];
  let truncated = false;
  let readCount = 0;
  try {
    for await (const entry of fs.entries(target.path, signal)) {
      signal.throwIfAborted();
      readCount += 1;
      if (readCount > TREE_ENTRY_LIMIT) {
        truncated = true;
        break;
      }
      const path = api.join(target.path, entry.name);
      if (entry.isSymbolicLink()) {
        entries.push({
          name: entry.name,
          path,
          type: 'link',
          sizeBytes: null,
          selectable: false,
        });
      } else if (entry.isDirectory()) {
        entries.push({
          name: entry.name,
          path,
          type: 'directory',
          sizeBytes: null,
          selectable: true,
        });
      } else {
        let item: ITreeEntry;
        try {
          const stats = await fs.lstat(path);
          signal.throwIfAborted();
          if (stats.isSymbolicLink()) {
            item = {
              name: entry.name,
              path,
              type: 'link',
              sizeBytes: null,
              selectable: false,
            };
          } else if (stats.isFile()) {
            item = {
              name: entry.name,
              path,
              type: 'file',
              sizeBytes:
                stats.size <= BigInt(Number.MAX_SAFE_INTEGER)
                  ? Number(stats.size)
                  : null,
              selectable: true,
            };
          } else {
            item = {
              name: entry.name,
              path,
              type: 'other',
              sizeBytes: null,
              selectable: false,
            };
          }
        } catch (error) {
          signal.throwIfAborted();
          // Entry biến mất giữa lúc liệt kê thì bỏ; lỗi khác vẫn hiện nhưng không chọn được.
          if (isMissing(error)) continue;
          item = {
            name: entry.name,
            path,
            type: 'other',
            sizeBytes: null,
            selectable: false,
          };
        }
        entries.push(item);
      }
    }
  } catch (error) {
    signal.throwIfAborted();
    if (isMissing(error)) throw new NotFoundException('Path');
    const code =
      error !== null && typeof error === 'object' && 'code' in error
        ? error.code
        : undefined;
    if (code === 'EACCES' || code === 'EPERM')
      throw new ForbiddenException('Cannot read path');
    throw new InternalServerException('Cannot read path');
  }
  // DISK_FS entries() dừng im lặng khi abort: không trả danh sách thiếu như thể đủ.
  signal.throwIfAborted();
  return {
    path: target.path,
    owner: target.owner,
    entries: entries.sort(compareEntries),
    truncated,
  };
}
