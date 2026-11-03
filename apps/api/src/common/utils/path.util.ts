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

// D10: chặn traversal — có đoạn ".." là từ chối luôn (không client hợp lệ nào gửi).
export const hasTraversalSegment = (value: string): boolean =>
  value.split(/[\\/]+/).some((segment) => segment === '..');

/** Dạng để so sánh: resolve (bỏ "." và dấu "\" cuối), Windows thì chữ thường. Input phải tuyệt đối. */
export const toComparable = (
  absolutePath: string,
  platform: PathPlatform,
): string => {
  const resolved = pathApi(platform).resolve(absolutePath);
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
};

/** true nếu `child` trùng hoặc nằm trong `parent` (cả hai đã qua toComparable). */
export const isSameOrInside = (
  child: string,
  parent: string,
  platform: PathPlatform,
): boolean => {
  if (child === parent) return true;
  const sep = pathApi(platform).sep;
  const prefix = parent.endsWith(sep) ? parent : parent + sep;
  return child.startsWith(prefix);
};
