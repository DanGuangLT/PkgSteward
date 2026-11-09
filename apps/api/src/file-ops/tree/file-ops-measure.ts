import type { BigIntStats } from 'node:fs';
import { pathApi, type PathPlatform } from '@/common/utils/path.util';
import {
  DISK_IDENTITY_LIMIT,
  fileIdentity,
} from '@/disk-usage/traversal/disk-usage-identity';
import type { IDiskFs } from '@/disk-usage/interfaces/disk-usage.types';

export interface ITargetMeasurement {
  /** Every regular-file entry, including repeated hardlinks. */
  apparentBytes: number;
  /** Each hardlinked inode counted once within this target. */
  sizeBytes: number;
  /** Inodes whose observed link count covers nlink. */
  reclaimableBytes: number;
  sharedBytes: number;
  fileCount: number;
}

export type MeasureResult =
  | { status: 'done'; size: ITargetMeasurement }
  | {
      status: 'failed';
      reason:
        | 'not_found'
        | 'changed'
        | 'read_error'
        | 'numeric_limit'
        | 'identity_limit';
    }
  | { status: 'cancelled' };

export async function measureTarget(
  targetPath: string,
  deps: { fs: IDiskFs; platform: PathPlatform; signal: AbortSignal },
): Promise<MeasureResult> {
  const { fs, platform, signal } = deps;
  if (signal.aborted) return { status: 'cancelled' };
  const api = pathApi(platform);
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  let apparentBytes = 0n;
  let sizeBytes = 0n;
  let reclaimableBytes = 0n;
  let fileCount = 0n;
  const identities = new Map<
    string,
    { hits: bigint; nlink: bigint; size: bigint }
  >();
  type FailureReason = Extract<MeasureResult, { status: 'failed' }>['reason'];
  const addFile = (stats: BigIntStats): FailureReason | null => {
    apparentBytes += stats.size;
    fileCount++;
    if (stats.nlink <= 1n) {
      sizeBytes += stats.size;
      reclaimableBytes += stats.size;
    } else {
      const key = fileIdentity(stats);
      if (key === null) return 'read_error';
      const previous = identities.get(key);
      if (previous) {
        const wasShared = previous.hits < previous.nlink;
        previous.hits++;
        if (wasShared && previous.hits >= previous.nlink)
          reclaimableBytes += previous.size;
      } else {
        if (identities.size >= DISK_IDENTITY_LIMIT) return 'identity_limit';
        identities.set(key, { hits: 1n, nlink: stats.nlink, size: stats.size });
        sizeBytes += stats.size;
      }
    }
    return apparentBytes > maxSafe ||
      sizeBytes > maxSafe ||
      reclaimableBytes > maxSafe ||
      fileCount >= maxSafe
      ? 'numeric_limit'
      : null;
  };
  const measure = async (): Promise<MeasureResult> => {
    let root: BigIntStats;
    try {
      root = await fs.lstat(targetPath, signal);
      signal.throwIfAborted();
    } catch (error) {
      signal.throwIfAborted();
      if (isMissing(error)) return { status: 'failed', reason: 'not_found' };
      throw error;
    }
    if (root.isSymbolicLink()) return { status: 'failed', reason: 'changed' };
    if (root.isFile()) {
      const reason = addFile(root);
      if (reason) return { status: 'failed', reason };
    } else if (root.isDirectory()) {
      const directories = [targetPath];
      while (directories.length > 0) {
        signal.throwIfAborted();
        const directory = directories.pop()!;
        try {
          for await (const entry of fs.entries(directory, signal)) {
            signal.throwIfAborted();
            if (entry.isSymbolicLink()) continue;
            const child = api.join(directory, entry.name);
            if (entry.isDirectory()) {
              directories.push(child);
              continue;
            }
            let stats: BigIntStats;
            try {
              stats = await fs.lstat(child, signal);
              signal.throwIfAborted();
            } catch (error) {
              signal.throwIfAborted();
              if (isMissing(error)) continue;
              throw error;
            }
            if (stats.isSymbolicLink() || !stats.isFile()) continue;
            const reason = addFile(stats);
            if (reason) return { status: 'failed', reason };
          }
          // DISK_FS may stop its iterator silently on abort.
          signal.throwIfAborted();
        } catch (error) {
          signal.throwIfAborted();
          if (isMissing(error)) {
            if (directory !== targetPath) continue;
            return { status: 'failed', reason: 'not_found' };
          }
          throw error;
        }
      }
    } else {
      return { status: 'failed', reason: 'changed' };
    }
    return {
      status: 'done',
      size: {
        apparentBytes: Number(apparentBytes),
        sizeBytes: Number(sizeBytes),
        reclaimableBytes: Number(reclaimableBytes),
        sharedBytes: Number(sizeBytes - reclaimableBytes),
        fileCount: Number(fileCount),
      },
    };
  };
  try {
    const result = await measure();
    // Also check after asynchronous iterator cleanup on an early failure return.
    return signal.aborted ? { status: 'cancelled' } : result;
  } catch {
    return signal.aborted
      ? { status: 'cancelled' }
      : { status: 'failed', reason: 'read_error' };
  }
}

const isMissing = (error: unknown): boolean =>
  error !== null &&
  typeof error === 'object' &&
  'code' in error &&
  (error.code === 'ENOENT' || error.code === 'ENOTDIR');
