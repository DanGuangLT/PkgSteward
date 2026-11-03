import type { Dirent } from 'node:fs';
import { InternalServerException } from '@/common/exceptions/app.exception';
import { pathApi } from '@/common/utils/path.util';
import type {
  IDirectoryMetadata,
  IMetadataDeps,
  PackageManager,
} from '@/scanner/interfaces/scanner.types';

const LOCKFILES: readonly [string, PackageManager][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
];

export async function inspectScanDirectory(
  directory: string,
  entries: readonly Dirent[],
  { platform, fs, signal }: IMetadataDeps,
): Promise<IDirectoryMetadata> {
  const api = pathApi(platform);
  const findEntry = (name: string) =>
    entries.find((entry) =>
      platform === 'win32'
        ? entry.name.toLowerCase() === name.toLowerCase()
        : entry.name === name,
    );
  const lstat = async (file: string, optional: boolean) => {
    signal.throwIfAborted();
    try {
      const stats = await fs.lstat(file);
      signal.throwIfAborted();
      return stats;
    } catch (error) {
      signal.throwIfAborted();
      const code = (error as NodeJS.ErrnoException).code;
      if (optional && (code === 'ENOENT' || code === 'ENOTDIR')) return null;
      throw error;
    }
  };
  const regularStat = async (file: string, optional: boolean) => {
    const stats = await lstat(file, optional);
    return stats?.isFile() && !stats.isSymbolicLink() ? stats : null;
  };

  signal.throwIfAborted();
  const packageEntry = findEntry('package.json');
  let packageStats: Awaited<ReturnType<typeof regularStat>> = null;
  let name: string | null = null;
  if (packageEntry?.isFile() && !packageEntry.isSymbolicLink()) {
    const packagePath = api.join(directory, packageEntry.name);
    packageStats = await regularStat(packagePath, false);
    if (!packageStats) {
      throw new InternalServerException('Package is no longer a regular file');
    }
    signal.throwIfAborted();
    const content = await fs.readFile(packagePath, signal);
    signal.throwIfAborted();
    try {
      // Trình soạn thảo trên Windows có thể lưu kèm BOM; npm cũng bỏ qua BOM.
      const value: unknown = JSON.parse(content.replace(/^\uFEFF/, ''));
      if (value !== null && typeof value === 'object' && 'name' in value) {
        if (typeof value.name === 'string' && value.name.trim() !== '') {
          name = value.name;
        }
      }
    } catch {
      // JSON hỏng vẫn là project; không biến node_modules thành orphan.
    }
  }

  const modulesEntry = findEntry('node_modules');
  const modulesPath = api.join(directory, modulesEntry?.name ?? 'node_modules');
  const modulesStats =
    modulesEntry?.isDirectory() && !modulesEntry.isSymbolicLink()
      ? await lstat(modulesPath, true)
      : null;
  const modulesExist =
    !!modulesStats?.isDirectory() && !modulesStats.isSymbolicLink();

  if (!packageStats) {
    return {
      project: null,
      orphan:
        !packageEntry && modulesExist
          ? {
              path: modulesPath,
              sizeBytes: null,
              mtime: new Date(modulesStats!.mtimeMs).toISOString(),
            }
          : null,
    };
  }

  let activity = packageStats.mtimeMs;
  let packageManager: PackageManager | null = null;
  for (const [filename, manager] of LOCKFILES) {
    const lockEntry = findEntry(filename);
    if (!lockEntry?.isFile() || lockEntry.isSymbolicLink()) continue;
    const stats = await regularStat(api.join(directory, lockEntry.name), true);
    if (!stats) continue;
    packageManager ??= manager;
    activity = Math.max(activity, stats.mtimeMs);
  }

  const gitEntry = findEntry('.git');
  if (gitEntry?.isDirectory() && !gitEntry.isSymbolicLink()) {
    const gitPath = api.join(directory, gitEntry.name);
    const gitStats = await lstat(gitPath, true);
    if (gitStats?.isDirectory() && !gitStats.isSymbolicLink()) {
      for (const filename of ['HEAD', 'index']) {
        const stats = await regularStat(api.join(gitPath, filename), true);
        if (stats) activity = Math.max(activity, stats.mtimeMs);
      }
    }
  }

  return {
    project: {
      path: directory,
      name,
      packageManager,
      hasLockfile: packageManager !== null,
      lastActivityAt: new Date(activity).toISOString(),
      nodeModules: { exists: modulesExist, path: modulesPath, sizeBytes: null },
    },
    orphan: null,
  };
}
