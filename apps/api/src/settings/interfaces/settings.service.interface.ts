import type {
  IPluginInstallPreviewResponse,
  IPluginSandboxDocumentResponse,
  IPluginUninstallPreviewResponse,
  ISettingsExportResponse,
  ISettingsPreviewResponse,
  ISettingsSnapshot,
  SettingsResetScope,
} from '@/settings/interfaces/settings.types';
import type { IPluginsCatalog } from '@/settings/plugins/interfaces/plugin.types';

export interface ISettingsService {
  initializePreinstalledPlugins(): Promise<void>;
  getSnapshot(): Promise<ISettingsSnapshot>;
  getPluginsCatalog(): Promise<IPluginsCatalog>;
  exportSettings(): Promise<ISettingsExportResponse>;
  updatePreferences(patch: Record<string, unknown>): Promise<ISettingsSnapshot>;
  previewUpdate(
    patch: Record<string, unknown>,
  ): Promise<ISettingsPreviewResponse>;
  previewImport(rawImport: unknown): Promise<ISettingsPreviewResponse>;
  previewReset(scope: SettingsResetScope): Promise<ISettingsPreviewResponse>;
  executePreviewedAction(
    expectedAction: 'update' | 'import' | 'reset',
    input: {
      previewId: string;
      confirm: boolean;
      acknowledgedRisks?: string[];
    },
  ): Promise<ISettingsSnapshot>;
  previewPluginInstallFromUrl(
    url: string,
  ): Promise<IPluginInstallPreviewResponse>;
  previewPluginInstallFromFile(
    fileName: string,
    buffer: Buffer,
  ): Promise<IPluginInstallPreviewResponse>;
  executePluginInstall(input: {
    previewId: string;
    confirm: boolean;
    acknowledgedRisks?: string[];
  }): Promise<ISettingsSnapshot>;
  previewPluginUninstall(
    pluginId: string,
  ): Promise<IPluginUninstallPreviewResponse>;
  executePluginUninstall(input: {
    previewId: string;
    confirm: boolean;
  }): Promise<ISettingsSnapshot>;
  restoreDefaultPlugins(): Promise<ISettingsSnapshot>;
  uploadWallpaperMedia(
    fileName: string,
    buffer: Buffer,
  ): Promise<ISettingsSnapshot>;
  getPluginAsset(
    pluginId: string,
    relativePath: string,
  ): Promise<{ absolutePath: string; contentType: string }>;
  getPluginSandboxDocument(
    pluginId: string,
  ): Promise<IPluginSandboxDocumentResponse>;
}
