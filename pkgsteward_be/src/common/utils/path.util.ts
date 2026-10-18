import * as path from 'path';

export type PathPlatform = 'win32' | 'posix';

export const toPathPlatform = (
  platform: NodeJS.Platform = process.platform,
): PathPlatform => (platform === 'win32' ? 'win32' : 'posix');

export const pathApi = (platform: PathPlatform): path.PlatformPath =>
  platform === 'win32' ? path.win32 : path.posix;

// Windows: chỉ nhận "X:\..." — từ chối "C:foo" (theo cwd của ổ), "\foo" (theo ổ hiện tại),
// UNC "\\server\share" và device path "\\?\" (ngoài phạm vi ổ cố định).
const WIN32_DRIVE_ABSOLUTE = /^[A-Za-z]:[\\/]/;

export const isFullyQualifiedPath = (
  value: string,
  platform: PathPlatform,
): boolean =>
  platform === 'win32'
    ? WIN32_DRIVE_ABSOLUTE.test(value)
    : value.startsWith('/');
