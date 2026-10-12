import { plainToInstance, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  validateSync,
} from 'class-validator';

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

  @IsString()
  @IsOptional()
  HOST?: string = 'localhost';

  @Type(() => Number)
  @IsInt({ message: 'PORT must be an integer' })
  @IsOptional()
  PORT?: number = 8080;

  @IsString()
  @IsOptional()
  GLOBAL_PREFIX?: string = 'api';

  @IsString()
  @IsOptional()
  VERSION?: string = '1';

  @IsString()
  @IsOptional()
  LIST_ORIGIN_CORS?: string = 'http://localhost:3000';

  @IsOptional()
  EXPORT_SWAGGER_API_JSON?: boolean | string = true;

  @IsString()
  @IsOptional()
  SCAN_ROOT_PATHS?: string;

  @Type(() => Number)
  @IsInt({ message: 'MAX_SCAN_DEPTH must be an integer' })
  @IsOptional()
  MAX_SCAN_DEPTH?: number = 4;

  @Type(() => Number)
  @IsInt({ message: 'NPM_COMMAND_TIMEOUT_MS must be an integer' })
  @IsOptional()
  NPM_COMMAND_TIMEOUT_MS?: number = 120000;
}

export const validateEnv = (config: Record<string, unknown>) => {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const errorMessages = errors.map((error) => ({
      field: error.property,
      messages: Object.values(error.constraints || {}),
    }));
    throw new Error(
      `Environment validation failed: ${JSON.stringify(errorMessages)}`,
    );
  }

  return validatedConfig;
};
