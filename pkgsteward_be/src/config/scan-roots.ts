import { isFullyQualifiedPath, pathApi } from '@/common/utils/path.util';
import type { PathPlatform } from '@/common/utils/path.util';

export const SCAN_ALL_FIXED_DRIVES = '*';

export type ScanRoots =
  { kind: 'all-fixed-drives' } | { kind: 'paths'; paths: string[] };

// D5: trống = "*"; "*" phải đứng một mình; path phải tuyệt đối. Dùng chung cho env validation,
// path guard (allowlist) và Scanner.
export const parseScanRootPaths = (
  value: string | undefined,
  platform: PathPlatform,
): ScanRoots => {
  const items = (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (items.length === 0) return { kind: 'all-fixed-drives' };
  if (items.some((item) => item.includes(SCAN_ALL_FIXED_DRIVES))) {
    if (items.length === 1 && items[0] === SCAN_ALL_FIXED_DRIVES) {
      return { kind: 'all-fixed-drives' };
    }
    throw new Error(
      'SCAN_ROOT_PATHS: "*" must be used alone (it already means every fixed drive)',
    );
  }
  const invalid = items.filter((item) => !isFullyQualifiedPath(item, platform));
  if (invalid.length > 0) {
    const hint =
      platform === 'win32' ? ' with a drive letter, e.g. D:\\Projects' : '';
    throw new Error(
      `SCAN_ROOT_PATHS: paths must be absolute${hint}: ${invalid.join(', ')}`,
    );
  }
  const api = pathApi(platform);
  return { kind: 'paths', paths: items.map((item) => api.resolve(item)) };
};
