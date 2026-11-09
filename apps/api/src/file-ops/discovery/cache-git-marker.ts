import { pathApi, type PathPlatform } from '@/common/utils/path.util';
import type { IFileOpsFs } from '@/file-ops/interfaces/file-ops.types';

export async function checkCacheGitMarker(
  cachePath: string,
  deps: {
    platform: PathPlatform;
    fs: Pick<IFileOpsFs, 'lstat'>;
    signal: AbortSignal;
  },
): Promise<'present' | 'absent' | 'unknown'> {
  const { fs, platform, signal } = deps;
  signal.throwIfAborted();
  try {
    // Chỉ kiểm gốc cache; repository lồng sâu hơn là giới hạn đã biết của v1.0.
    await fs.lstat(pathApi(platform).join(cachePath, '.git'));
    signal.throwIfAborted();
    // A file (worktree), directory or link all establish a repository boundary.
    return 'present';
  } catch (error) {
    signal.throwIfAborted();
    const code =
      error !== null && typeof error === 'object' && 'code' in error
        ? error.code
        : undefined;
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'absent' : 'unknown';
  }
}
