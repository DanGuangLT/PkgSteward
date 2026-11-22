import {
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import type { SettingsResetScope } from '@/settings/interfaces/settings.types';

export const RESET_SCOPES: readonly SettingsResetScope[] = [
  'appearance',
  'behavior',
  'runtime',
  'server',
  'plugins',
  'all',
];

export class UpdatePreferencesDto {
  @IsObject()
  @IsOptional()
  appearance?: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  behavior?: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  plugins?: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  desktop?: Record<string, unknown>;
}

export class PreviewSettingsDto {
  @IsObject()
  @IsOptional()
  runtime?: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  server?: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  appearance?: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  behavior?: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  plugins?: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  desktop?: Record<string, unknown>;
}

export class ExecuteSettingsDto {
  @IsUUID()
  previewId!: string;

  @IsBoolean()
  confirm!: boolean;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  acknowledgedRisks?: string[];
}

export class ImportSettingsPreviewDto {
  @IsObject()
  document!: Record<string, unknown>;
}

export class ResetSettingsPreviewDto {
  @IsIn(RESET_SCOPES)
  scope!: SettingsResetScope;
}
