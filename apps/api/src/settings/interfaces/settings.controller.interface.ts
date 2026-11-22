import type { IApiResponse } from '@/common/interceptors/transform.interceptor';
import type {
  ExecuteSettingsDto,
  ImportSettingsPreviewDto,
  PreviewSettingsDto,
  ResetSettingsPreviewDto,
  UpdatePreferencesDto,
} from '@/settings/dto/settings.dto';
import type {
  ISettingsExportResponse,
  ISettingsPreviewResponse,
  ISettingsSnapshot,
} from '@/settings/interfaces/settings.types';
import type { IPluginsCatalog } from '@/settings/plugins/interfaces/plugin.types';

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
}
