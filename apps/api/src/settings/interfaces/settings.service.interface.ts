import type {
  ISettingsExportResponse,
  ISettingsPreviewResponse,
  ISettingsSnapshot,
  SettingsResetScope,
} from '@/settings/interfaces/settings.types';
import type { IPluginsCatalog } from '@/settings/plugins/interfaces/plugin.types';

export interface ISettingsService {
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
}
