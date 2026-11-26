import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { pathApi, toPathPlatform } from '@/common/utils/path.util';
import type { PathPlatform } from '@/common/utils/path.util';
import {
  SETTINGS_FILE_KEYS,
  validateEnv,
} from '@/config/environment/env.validation';
import {
  findAppRootDir,
  findPackageRoot,
  findSourceCheckoutDir,
  resolveAppDataDir,
  SETTINGS_FILE_NAME,
} from '@/core/app-paths/app-paths.util';
import {
  migrateLegacyFlatSettings,
  parseStructuredSettingsOverrides,
  projectStructuredSettingsToEnvMap,
  validateLegacyFlatRecord,
} from '@/settings/schema/settings.schema';
import type { ISettingsOverrides } from '@/settings/schema/settings.schema';

export type ConfigSource = Record<string, unknown>;
export const STARTUP_ENV_ONLY_KEY = '__PKGSTEWARD_ENV_ONLY__';

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

const parseSettingsJsonObject = (
  filePath: string,
  readFile: (filePath: string) => string,
): Record<string, unknown> | null => {
  let raw: string;
  try {
    raw = readFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
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
  return parsed as Record<string, unknown>;
};

// Đọc cả settings.json phẳng cũ và settings.json schema v1 chuẩn hóa (giữ tương thích D4).
export const readRawSettingsOverrides = (
  filePath: string,
  readFile: (filePath: string) => string = readUtf8,
  platform: PathPlatform = toPathPlatform(),
): ISettingsOverrides | null => {
  const parsed = parseSettingsJsonObject(filePath, readFile);
  if (parsed === null) return null;
  if ('schemaVersion' in parsed) {
    return parseStructuredSettingsOverrides(parsed, { platform, filePath });
  }
  const flat = validateLegacyFlatRecord(parsed, filePath);
  return migrateLegacyFlatSettings(flat, { platform, filePath });
};

// D4: settings.json ưu tiên cao hơn env/default. Hỏng → khởi động FAIL, báo rõ file.
export const readSettingsFile = (
  filePath: string,
  readFile: (filePath: string) => string = readUtf8,
  platform: PathPlatform = toPathPlatform(),
): ConfigSource => {
  const parsed = parseSettingsJsonObject(filePath, readFile);
  if (parsed === null) return {};
  if ('schemaVersion' in parsed) {
    const overrides = parseStructuredSettingsOverrides(parsed, {
      platform,
      filePath,
    });
    return projectStructuredSettingsToEnvMap(overrides);
  }
  return validateLegacyFlatRecord(parsed, filePath);
};

export interface ILoadAppConfigOptions {
  env: ConfigSource;
  cli?: ConfigSource; // D4: {} cho đến khi đóng gói npx (sau v1.0)
  platform?: NodeJS.Platform;
  homeDir?: string;
  readFile?: (filePath: string) => string;
  exists?: (filePath: string) => boolean;
  // Thư mục dự án (repo root) để tính đường dẫn tương đối; null = bản cài đặt (không có).
  projectDir?: string | null;
  appInstallDir?: string;
  appRootDir?: string;
}

const nonBlank = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

export const loadAppConfig = ({
  env,
  cli = {},
  platform = process.platform,
  homeDir = homedir(),
  readFile,
  exists = existsSync,
  projectDir,
  appInstallDir,
  appRootDir,
}: ILoadAppConfigOptions) => {
  const pathPlatform = toPathPlatform(platform);
  const resolvedInstallDir = appInstallDir ?? findPackageRoot(__dirname);
  const sourceCheckoutDir =
    projectDir !== undefined
      ? projectDir
      : findSourceCheckoutDir(resolvedInstallDir, exists);
  const resolvedAppRootDir =
    appRootDir ??
    (projectDir !== undefined
      ? (projectDir ?? resolvedInstallDir)
      : findAppRootDir(
          resolvedInstallDir,
          sourceCheckoutDir,
          exists,
          platform,
        ));
  // dataDir chỉ lấy từ CLI/env: settings.json nằm bên trong nó.
  const { dataDir } = resolveAppDataDir({
    override:
      nonBlank(cli.PKGSTEWARD_DATA_DIR) ?? nonBlank(env.PKGSTEWARD_DATA_DIR),
    appInstallDir: resolvedInstallDir,
    appRootDir: resolvedAppRootDir,
    sourceCheckoutDir,
    env,
    homeDir,
    platform,
    exists,
  });
  const settings = readSettingsFile(
    pathApi(pathPlatform).join(dataDir, SETTINGS_FILE_NAME),
    readFile,
    pathPlatform,
  );
  const merged = mergeConfigSources({ cli, settings, env });
  // ConfigService/AppPathsService phải thấy đúng thư mục tuyệt đối mà loader đã dùng.
  merged.PKGSTEWARD_DATA_DIR = dataDir;
  const envBaseline: Record<string, string> = {};
  for (const key of SETTINGS_FILE_KEYS) {
    const rawVal = env[key];
    if (typeof rawVal === 'string' && rawVal.trim() !== '') {
      envBaseline[key] = rawVal;
    } else if (typeof rawVal === 'number' || typeof rawVal === 'boolean') {
      envBaseline[key] = String(rawVal);
    }
  }
  const validated = validateEnv(merged, pathPlatform) as unknown as Record<
    string,
    unknown
  >;
  validated[STARTUP_ENV_ONLY_KEY] = Object.freeze(envBaseline);
  return validated as unknown as ReturnType<typeof validateEnv>;
};
