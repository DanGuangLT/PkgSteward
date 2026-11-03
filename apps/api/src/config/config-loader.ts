import { readFileSync } from 'fs';
import { homedir } from 'os';
import {
  isFullyQualifiedPath,
  pathApi,
  toPathPlatform,
} from '@/common/utils/path.util';
import { SETTINGS_FILE_KEYS, validateEnv } from '@/config/env.validation';
import {
  findPackageRoot,
  findSourceCheckoutDir,
  resolveDataDir,
  SETTINGS_FILE_NAME,
} from '@/core/app-paths/app-paths.util';

export type ConfigSource = Record<string, unknown>;

// D4: CLI → settings.json → env (mặc định do validateEnv điền). Hàm thuần.
export const mergeConfigSources = ({
  cli,
  settings,
  env,
}: {
  cli: ConfigSource;
  settings: ConfigSource;
  env: ConfigSource;
}): ConfigSource => {
  const merged: ConfigSource = { ...env };
  for (const source of [settings, cli]) {
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined) merged[key] = value;
    }
  }
  return merged;
};

const readUtf8 = (filePath: string) => readFileSync(filePath, 'utf8');

// D4: settings.json chỉ đọc, JSON phẳng, khoá trùng tên biến env. Hỏng → khởi động FAIL, báo rõ file.
export const readSettingsFile = (
  filePath: string,
  readFile: (filePath: string) => string = readUtf8,
): ConfigSource => {
  let raw: string;
  try {
    raw = readFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(
      `Cannot read settings file ${filePath}: ${(error as Error).message}`,
      { cause: error },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(
      `Invalid JSON in settings file ${filePath}: ${(error as Error).message}`,
      { cause: error },
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `Settings file ${filePath} must contain a flat JSON object`,
    );
  }

  for (const [key, value] of Object.entries(parsed)) {
    if (key === 'PKGSTEWARD_DATA_DIR') {
      throw new Error(
        `Settings file ${filePath}: PKGSTEWARD_DATA_DIR cannot be set in settings.json (use the environment variable)`,
      );
    }
    if (!SETTINGS_FILE_KEYS.includes(key)) {
      throw new Error(
        `Settings file ${filePath}: unknown key "${key}" (allowed: ${SETTINGS_FILE_KEYS.join(', ')})`,
      );
    }
    if (!['string', 'number', 'boolean'].includes(typeof value)) {
      throw new Error(
        `Settings file ${filePath}: "${key}" must be a string, number or boolean`,
      );
    }
  }
  return parsed as ConfigSource;
};

// Dữ liệu runtime khi chạy từ mã nguồn nằm trong thư mục dự án (đã git-ignore).
export const DEFAULT_DATA_DIR = 'PkgStewardLog';

export interface ILoadAppConfigOptions {
  env: ConfigSource;
  cli?: ConfigSource; // D4: {} cho đến khi đóng gói npx (sau v1.0)
  platform?: NodeJS.Platform;
  homeDir?: string;
  readFile?: (filePath: string) => string;
  // Thư mục dự án (repo root) để tính đường dẫn tương đối; null = bản cài đặt (không có).
  projectDir?: string | null;
}

const nonBlank = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

// Tương đối thuần: win32 không bắt đầu bằng ổ đĩa hay dấu gạch chéo; posix không bắt đầu bằng /. Cho phép "..".
const isPlainRelativePath = (value: string, platform: 'win32' | 'posix') =>
  platform === 'win32'
    ? !/^([A-Za-z]:|[\\/])/.test(value)
    : !value.startsWith('/');

const resolveDataDirOverride = (
  raw: string | undefined,
  projectDir: string | null,
  pathPlatform: 'win32' | 'posix',
): string | undefined => {
  if (raw === undefined) return undefined;
  if (isFullyQualifiedPath(raw, pathPlatform)) return raw;
  if (!isPlainRelativePath(raw, pathPlatform)) {
    throw new Error(
      `Environment validation failed: PKGSTEWARD_DATA_DIR must be an absolute path (e.g. D:\\PkgStewardData) or a path relative to the project folder (e.g. ../PkgStewardLog) (got "${raw}")`,
    );
  }
  if (projectDir === null) {
    throw new Error(
      `Environment validation failed: PKGSTEWARD_DATA_DIR "${raw}" is relative, but there is no project folder to resolve it against; use an absolute path`,
    );
  }
  return pathApi(pathPlatform).resolve(projectDir, raw);
};

export const loadAppConfig = ({
  env,
  cli = {},
  platform = process.platform,
  homeDir = homedir(),
  readFile,
  projectDir = findSourceCheckoutDir(findPackageRoot(__dirname)),
}: ILoadAppConfigOptions) => {
  const pathPlatform = toPathPlatform(platform);
  // dataDir chỉ lấy từ CLI/env: settings.json nằm bên trong nó.
  const raw =
    nonBlank(cli.PKGSTEWARD_DATA_DIR) ??
    nonBlank(env.PKGSTEWARD_DATA_DIR) ??
    (projectDir !== null ? DEFAULT_DATA_DIR : undefined);
  const dataDir = resolveDataDir({
    override: resolveDataDirOverride(raw, projectDir, pathPlatform),
    localAppData: nonBlank(env.LOCALAPPDATA),
    homeDir,
    platform,
  });
  const settings = readSettingsFile(
    pathApi(pathPlatform).join(dataDir, SETTINGS_FILE_NAME),
    readFile,
  );
  const merged = mergeConfigSources({ cli, settings, env });
  // ConfigService/AppPathsService phải thấy đúng thư mục tuyệt đối mà loader đã dùng.
  merged.PKGSTEWARD_DATA_DIR = dataDir;
  return validateEnv(merged, pathPlatform);
};
