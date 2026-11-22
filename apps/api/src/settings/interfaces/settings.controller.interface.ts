import type { StreamableFile } from '@nestjs/common';
import type { IApiResponse } from '@/common/interceptors/transform.interceptor';
import type {
  ExecuteSettingsDto,
  ImportSettingsPreviewDto,
  PreviewPluginFileInstallDto,
  PreviewPluginUninstallDto,
  PreviewPluginUrlInstallDto,
  PreviewSettingsDto,
  ResetSettingsPreviewDto,
  UpdatePreferencesDto,
  UploadWallpaperMediaDto,
} from '@/settings/dto/settings.dto';
import type {
  IPluginInstallPreviewResponse,
  IPluginSandboxDocumentResponse,
  IPluginUninstallPreviewResponse,
  ISettingsExportResponse,
  ISettingsPreviewResponse,
  ISettingsSnapshot,
} from '@/settings/interfaces/settings.types';
import type { IPluginsCatalog } from '@/settings/plugins/interfaces/plugin.types';
import type { Request, Response } from 'express';

export interface ISettingsController {
  getSettings(): Promise<IApiResponse<ISettingsSnapshot>>;
  updatePreferences(
    dto: UpdatePreferencesDto,
  ): Promise<IApiResponse<ISettingsSnapshot>>;
  previewUpdate(
    dto: PreviewSettingsDto,
  ): Promise<IApiResponse<ISettingsPreviewResponse>>;
  executeUpdate(
    dto: ExecuteSettingsDto,
  ): Promise<IApiResponse<ISettingsSnapshot>>;
  exportSettings(): Promise<IApiResponse<ISettingsExportResponse>>;
  previewImport(
    dto: ImportSettingsPreviewDto,
  ): Promise<IApiResponse<ISettingsPreviewResponse>>;
  executeImport(
    dto: ExecuteSettingsDto,
  ): Promise<IApiResponse<ISettingsSnapshot>>;
  previewReset(
    dto: ResetSettingsPreviewDto,
  ): Promise<IApiResponse<ISettingsPreviewResponse>>;
  executeReset(
    dto: ExecuteSettingsDto,
  ): Promise<IApiResponse<ISettingsSnapshot>>;
  getPlugins(): Promise<IApiResponse<IPluginsCatalog>>;
  previewPluginInstall(
    req: Request,
    urlInput?: PreviewPluginUrlInstallDto,
    fileInput?: PreviewPluginFileInstallDto,
  ): Promise<IApiResponse<IPluginInstallPreviewResponse>>;
  executePluginInstall(
    dto: ExecuteSettingsDto,
  ): Promise<IApiResponse<ISettingsSnapshot>>;
  previewPluginUninstall(
    dto: PreviewPluginUninstallDto,
  ): Promise<IApiResponse<IPluginUninstallPreviewResponse>>;
  executePluginUninstall(
    dto: ExecuteSettingsDto,
  ): Promise<IApiResponse<ISettingsSnapshot>>;
  restoreDefaultPlugins(): Promise<IApiResponse<ISettingsSnapshot>>;
  uploadWallpaperMedia(
    req: Request,
    body?: UploadWallpaperMediaDto,
  ): Promise<IApiResponse<ISettingsSnapshot>>;
  getPluginAsset(
    pluginId: string,
    assetPathParam: string | string[],
    response: Response,
  ): Promise<StreamableFile>;
  getPluginSandboxDocument(
    pluginId: string,
  ): Promise<IApiResponse<IPluginSandboxDocumentResponse>>;
}
