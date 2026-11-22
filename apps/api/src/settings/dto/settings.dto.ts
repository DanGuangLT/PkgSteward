import {
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import type { SettingsResetScope } from '@/settings/interfaces/settings.types';
import { PLUGIN_ID_REGEX } from '@/settings/plugins/interfaces/plugin.types';

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

export class PreviewPluginUrlInstallDto {
  @IsString()
  @IsOptional()
  @MaxLength(2048)
  url?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  fileName?: string;

  @IsString()
  @IsOptional()
  contentBase64?: string;
}

export class PreviewPluginFileInstallDto {
  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsString()
  contentBase64!: string;
}

export class PreviewPluginUninstallDto {
  @IsString()
  @Matches(PLUGIN_ID_REGEX)
  pluginId!: string;
}

export class UploadWallpaperMediaDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  fileName?: string;

  @IsString()
  @IsOptional()
  contentBase64?: string;
}
