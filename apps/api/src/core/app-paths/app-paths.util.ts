import { existsSync } from 'fs';
import * as path from 'path';
import {
  isFullyQualifiedPath,
  pathApi,
  toPathPlatform,
} from '@/common/utils/path.util';
import type { PathPlatform } from '@/common/utils/path.util';

export const CO_LOCATED_DATA_DIR_NAME = 'PkgStewardLog';
export const APP_DATA_DIR_NAME = 'PkgSteward';
export const PORTABLE_FLAG_FILE_NAME = 'portable.flag';
export const SETTINGS_FILE_NAME = 'settings.json';
export const AUDIT_LOG_FILE_NAME = 'dangerous-operations.jsonl';
export const PLUGINS_DIR_NAME = 'plugins';

export type DataDirTier = 'explicit' | 'co-located' | 'os-user';

export interface IDataDirSources {
  override?: string; // A validated absolute PKGSTEWARD_DATA_DIR, or undefined.
  localAppData?: string; // %LOCALAPPDATA%
  appData?: string; // %APPDATA%
  xdgDataHome?: string; // $XDG_DATA_HOME
  homeDir: string;
  platform: NodeJS.Platform;
}

export interface IPortableDetection {
  portable: boolean;
  baseDir: string | null;
}

export interface IResolveAppDataDirInput {
  override?: unknown;
  appInstallDir: string;
  appRootDir: string;
  sourceCheckoutDir: string | null;
  env: Record<string, unknown>;
  homeDir: string;
  platform: NodeJS.Platform;
  exists?: (filePath: string) => boolean;
}

export interface IResolvedAppDataDir {
  dataDir: string;
  tier: DataDirTier;
  portableBaseDir: string | null;
}

const nonBlank = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

const readEnvString = (
  env: Record<string, unknown>,
  key: string,
  pathPlatform: PathPlatform,
): string | undefined => {
  const direct = nonBlank(env[key]);
  if (direct !== undefined) return direct;
  if (pathPlatform !== 'win32') return undefined;
  const upper = key.toUpperCase();
  const match = Object.entries(env).find(
    ([entryKey]) => entryKey.toUpperCase() === upper,
  );
  return match ? nonBlank(match[1]) : undefined;
};

// Pure relative path: Windows forbids drive prefix or leading slash; POSIX forbids leading "/".
const isPlainRelativePath = (value: string, platform: PathPlatform): boolean =>
  platform === 'win32'
    ? !/^([A-Za-z]:|[\\/])/.test(value)
    : !value.startsWith('/');

// Runtime data uses an override for test/dev, or the user's OS data folder.
export const resolveDataDir = ({
  override,
  localAppData,
  appData,
  xdgDataHome,
  homeDir,
  platform,
}: IDataDirSources): string => {
  const pathPlatform = toPathPlatform(platform);
  const api = pathApi(pathPlatform);
  const trimmedOverride = nonBlank(override);
  if (trimmedOverride !== undefined) return api.resolve(trimmedOverride);
  if (platform === 'win32') {
    const base =
      nonBlank(localAppData) ??
      nonBlank(appData) ??
      api.join(homeDir, 'AppData', 'Local');
    return api.join(base, APP_DATA_DIR_NAME);
  }
  if (platform === 'darwin') {
    return api.join(
      homeDir,
      'Library',
      'Application Support',
      APP_DATA_DIR_NAME,
    );
  }
  const trimmedXdg = nonBlank(xdgDataHome);
  const linuxBase =
    trimmedXdg !== undefined && isFullyQualifiedPath(trimmedXdg, 'posix')
      ? trimmedXdg
      : api.join(homeDir, '.local', 'share');
  return api.join(linuxBase, APP_DATA_DIR_NAME);
};

// Resolve the package from __dirname in source or build output, independent of cwd.
export const findPackageRoot = (
  startDir: string,
  exists: (filePath: string) => boolean = existsSync,
): string => {
  let dir = path.resolve(startDir);
  for (;;) {
    if (exists(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Cannot find package.json above ${startDir}`);
    }
    dir = parent;
  }
};

// A source checkout is laid out as <repo>/apps/<app> with .git in <repo>.
// Only that exact shape counts: walking further up could treat a user's own
// repository (PkgSteward installed inside it) as the source checkout.
// The name check ignores case: on Windows __dirname keeps the case typed in the shell.
export const findSourceCheckoutDir = (
  appInstallDir: string,
  exists: (filePath: string) => boolean = existsSync,
): string | null => {
  const apps = path.dirname(appInstallDir);
  if (path.basename(apps).toLowerCase() !== 'apps') return null;
  const repo = path.dirname(apps);
  return exists(path.join(repo, '.git')) ? repo : null;
};

export const findAppRootDir = (
  appInstallDir: string,
  sourceCheckoutDir: string | null,
  exists: (filePath: string) => boolean = existsSync,
  platform: NodeJS.Platform = process.platform,
): string => {
  if (sourceCheckoutDir !== null) return sourceCheckoutDir;
  const api = pathApi(toPathPlatform(platform));
  const apps = api.dirname(appInstallDir);
  if (api.basename(apps).toLowerCase() === 'apps') {
    const monorepoRoot = api.dirname(apps);
    if (exists(api.join(monorepoRoot, 'package.json'))) return monorepoRoot;
  }
  return appInstallDir;
};

export const detectPortableMode = ({
  appRootDir,
  appInstallDir,
  env,
  platform = process.platform,
  exists = existsSync,
}: {
  appRootDir: string;
  appInstallDir: string;
  env: Record<string, unknown>;
  platform?: NodeJS.Platform;
  exists?: (filePath: string) => boolean;
}): IPortableDetection => {
  const pathPlatform = toPathPlatform(platform);
  const api = pathApi(pathPlatform);
  const rawPortableDir = readEnvString(
    env,
    'PORTABLE_EXECUTABLE_DIR',
    pathPlatform,
  );
  if (rawPortableDir !== undefined) {
    if (!isFullyQualifiedPath(rawPortableDir, pathPlatform)) {
      throw new Error(
        `Environment validation failed: PORTABLE_EXECUTABLE_DIR must be a valid absolute path (got "${rawPortableDir}")`,
      );
    }
    return { portable: true, baseDir: api.resolve(rawPortableDir) };
  }
  const hasFlag =
    exists(api.join(appRootDir, PORTABLE_FLAG_FILE_NAME)) ||
    exists(api.join(appInstallDir, PORTABLE_FLAG_FILE_NAME));
  if (hasFlag) {
    return { portable: true, baseDir: api.resolve(appRootDir) };
  }
  return { portable: false, baseDir: null };
};

export const resolveAppDataDir = ({
  override,
  appInstallDir,
  appRootDir,
  sourceCheckoutDir,
  env,
  homeDir,
  platform,
  exists = existsSync,
}: IResolveAppDataDirInput): IResolvedAppDataDir => {
  const pathPlatform = toPathPlatform(platform);
  const api = pathApi(pathPlatform);
  const portable = detectPortableMode({
    appRootDir,
    appInstallDir,
    env,
    platform,
    exists,
  });
  const coLocatedBaseDir =
    portable.baseDir ??
    (sourceCheckoutDir !== null ? api.resolve(sourceCheckoutDir) : null);

  const rawOverride = nonBlank(override);
  if (rawOverride !== undefined) {
    if (isFullyQualifiedPath(rawOverride, pathPlatform)) {
      return {
        dataDir: api.resolve(rawOverride),
        tier: 'explicit',
        portableBaseDir: portable.baseDir,
      };
    }
    if (!isPlainRelativePath(rawOverride, pathPlatform)) {
      throw new Error(
        `Environment validation failed: PKGSTEWARD_DATA_DIR must be an absolute path (e.g. D:\\PkgStewardData) or a path relative to the project folder (e.g. ../PkgStewardLog) (got "${rawOverride}")`,
      );
    }
    if (coLocatedBaseDir === null) {
      throw new Error(
        `Environment validation failed: PKGSTEWARD_DATA_DIR "${rawOverride}" is relative, but there is no project folder to resolve it against; use an absolute path`,
      );
    }
    return {
      dataDir: api.resolve(coLocatedBaseDir, rawOverride),
      tier: 'explicit',
      portableBaseDir: portable.baseDir,
    };
  }

  if (coLocatedBaseDir !== null) {
    return {
      dataDir: api.join(coLocatedBaseDir, CO_LOCATED_DATA_DIR_NAME),
      tier: 'co-located',
      portableBaseDir: portable.baseDir,
    };
  }

  return {
    dataDir: resolveDataDir({
      localAppData: readEnvString(env, 'LOCALAPPDATA', pathPlatform),
      appData: readEnvString(env, 'APPDATA', pathPlatform),
      xdgDataHome: readEnvString(env, 'XDG_DATA_HOME', pathPlatform),
      homeDir,
      platform,
    }),
    tier: 'os-user',
    portableBaseDir: null,
  };
};

const DATA_DIR_WRITE_ERROR_CODES = new Set([
  'EACCES',
  'EPERM',
  'EROFS',
  'ENOTDIR',
]);

export const isDataDirWriteError = (error: unknown): boolean => {
  const code =
    error !== null && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  return typeof code === 'string' && DATA_DIR_WRITE_ERROR_CODES.has(code);
};

export const wrapDataDirWriteError = (
  dataDir: string,
  targetPath: string,
  error: unknown,
): Error => {
  const rawCode =
    error !== null && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  const code = typeof rawCode === 'string' ? rawCode : '';
  const detail = error instanceof Error ? error.message : String(error);
  const codePrefix = code && !detail.includes(code) ? `${code}: ` : '';
  return new Error(
    `Cannot write runtime data under "${dataDir}" (failed at "${targetPath}": ${codePrefix}${detail}). Check directory permissions or set PKGSTEWARD_DATA_DIR to a writable directory.`,
    { cause: error },
  );
};
