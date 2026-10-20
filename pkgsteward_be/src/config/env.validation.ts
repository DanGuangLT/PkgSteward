import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  validateSync,
} from 'class-validator';
import { isFullyQualifiedPath, toPathPlatform } from '@/common/utils/path.util';
import type { PathPlatform } from '@/common/utils/path.util';
import { parseScanRootPaths, SCAN_ALL_FIXED_DRIVES } from '@/config/scan-roots';

// D6: API không có auth → chỉ lắng nghe trên loopback.
export const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1'];

// D4: khoá được phép trong settings.json = tên biến env, trừ PKGSTEWARD_DATA_DIR
// (settings.json nằm ngay trong thư mục đó).
export const SETTINGS_FILE_KEYS: readonly string[] = [
  'MODE',
  'HOST',
  'PORT',
  'GLOBAL_PREFIX',
  'VERSION',
  'LIST_ORIGIN_CORS',
  'EXPORT_SWAGGER_API_JSON',
  'SCAN_ROOT_PATHS',
  'MAX_SCAN_DEPTH',
  'SCAN_TIMEOUT_MS',
  'NPM_COMMAND_TIMEOUT_MS',
];

const blankToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

// Đọc giá trị gốc: implicit conversion biến "false" thành true trước khi @Transform chạy.
const toBooleanFlag = ({
  obj,
  key,
}: {
  obj: Record<string, unknown>;
  key: string;
}) => {
  const raw = obj[key];
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    const value = raw.trim().toLowerCase();
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return raw; // để @IsBoolean báo lỗi
};

export enum AppMode {
  Development = 'development',
  Production = 'production',
}

export class EnvironmentVariables {
  @IsEnum(AppMode, {
    message: 'MODE must be either "development" or "production"',
  })
  @IsOptional()
  MODE?: AppMode = AppMode.Development;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsIn(LOOPBACK_HOSTS, {
    message: 'HOST must be one of: localhost, 127.0.0.1, ::1 (loopback only)',
  })
  @IsOptional()
  HOST?: string = '127.0.0.1'; // C5: mặc định IPv4 loopback (vẫn nhận localhost / ::1)

  @Type(() => Number)
  @IsInt({ message: 'PORT must be an integer' })
  @IsOptional()
  PORT?: number = 24681;

  @IsString()
  @IsOptional()
  GLOBAL_PREFIX?: string = 'api';

  @IsString()
  @IsOptional()
  VERSION?: string = '1';

  @IsString()
  @IsOptional()
  LIST_ORIGIN_CORS?: string = 'http://localhost:24680';

  @Transform(toBooleanFlag)
  @IsBoolean({ message: 'EXPORT_SWAGGER_API_JSON must be true or false' })
  @IsOptional()
  EXPORT_SWAGGER_API_JSON?: boolean = true;

  // D5: trống hoặc không đặt = "*" (mọi ổ cố định); "*" đứng một mình và path tuyệt đối kiểm ở validatePathSettings.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() === ''
      ? SCAN_ALL_FIXED_DRIVES
      : value,
  )
  @IsString()
  @IsOptional()
  SCAN_ROOT_PATHS?: string = SCAN_ALL_FIXED_DRIVES;

  @Type(() => Number)
  @IsInt({ message: 'SCAN_TIMEOUT_MS must be an integer' })
  @Min(1000, { message: 'SCAN_TIMEOUT_MS must be at least 1000 (1 second)' })
  @IsOptional()
  SCAN_TIMEOUT_MS?: number = 900000;

  // D3: thư mục dữ liệu runtime; không đặt = %LOCALAPPDATA%\PkgSteward.
  @Transform(blankToUndefined)
  @IsString()
  @IsOptional()
  PKGSTEWARD_DATA_DIR?: string;

  // 0 = no depth limit
  @Type(() => Number)
  @IsInt({ message: 'MAX_SCAN_DEPTH must be an integer' })
  @Min(0, {
    message: 'MAX_SCAN_DEPTH must be 0 (no limit) or a positive integer',
  })
  @IsOptional()
  MAX_SCAN_DEPTH?: number = 0;

  @Type(() => Number)
  @IsInt({ message: 'NPM_COMMAND_TIMEOUT_MS must be an integer' })
  @IsOptional()
  NPM_COMMAND_TIMEOUT_MS?: number = 360000;
}

type FieldErrors = { field: string; messages: string[] }[];

// Kiểm path phụ thuộc nền tảng (Windows cần "X:\"), nên không viết bằng decorator.
const validatePathSettings = (
  config: EnvironmentVariables,
  platform: PathPlatform,
): FieldErrors => {
  const errors: FieldErrors = [];
  if (typeof config.SCAN_ROOT_PATHS === 'string') {
    try {
      parseScanRootPaths(config.SCAN_ROOT_PATHS, platform);
    } catch (error) {
      errors.push({
        field: 'SCAN_ROOT_PATHS',
        messages: [(error as Error).message],
      });
    }
  }
  if (
    typeof config.PKGSTEWARD_DATA_DIR === 'string' &&
    !isFullyQualifiedPath(config.PKGSTEWARD_DATA_DIR, platform)
  ) {
    errors.push({
      field: 'PKGSTEWARD_DATA_DIR',
      messages: ['PKGSTEWARD_DATA_DIR must be an absolute path'],
    });
  }
  return errors;
};

export const validateEnv = (
  config: Record<string, unknown>,
  platform: PathPlatform = toPathPlatform(),
) => {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  const errorMessages: FieldErrors = errors.map((error) => ({
    field: error.property,
    messages: Object.values(error.constraints || {}),
  }));
  errorMessages.push(...validatePathSettings(validatedConfig, platform));

  if (errorMessages.length > 0) {
    throw new Error(
      `Environment validation failed: ${JSON.stringify(errorMessages)}`,
    );
  }

  return validatedConfig;
};
