import { stat } from 'node:fs/promises';
import {
  isFullyQualifiedPath,
  pathApi,
  type PathPlatform,
} from '@/common/utils/path.util';

const isRegularFile = (path: string): Promise<boolean> =>
  stat(path).then(
    (stats) => stats.isFile(),
    () => false,
  );

// Git chạy với cwd là project không tin cậy: trên Windows, tên lệnh trần được tìm trong cwd trước PATH,
// và mục PATH tương đối cũng tính theo cwd. Vì vậy chỉ nhận git.exe trong mục PATH tuyệt đối.
export async function resolveGitExecutable(
  pathValue: string | undefined,
  platform: PathPlatform,
  isFile: (path: string) => Promise<boolean> = isRegularFile,
): Promise<string | null> {
  const api = pathApi(platform);
  const name = platform === 'win32' ? 'git.exe' : 'git';
  for (const entry of (pathValue ?? '').split(api.delimiter)) {
    const directory =
      entry.length > 1 && entry.startsWith('"') && entry.endsWith('"')
        ? entry.slice(1, -1)
        : entry;
    if (!isFullyQualifiedPath(directory, platform)) continue;
    const candidate = api.join(directory, name);
    if (await isFile(candidate)) return candidate;
  }
  return null;
}
