import type { RiskLevel } from '@/core/risk/interfaces/risk.types';
import type { IPluginsCatalog } from '@/settings/plugins/interfaces/plugin.types';
import type {
  ISettingsDocument,
  ISettingsOverrides,
} from '@/settings/schema/settings.schema';

export type SettingsRiskCode =
  | 'BROAD_SCAN_ROOTS'
  | 'SCAN_SCOPE_CHANGED'
  | 'SERVER_RESTART_REQUIRED'
  | 'PLUGINS_LOCAL_ENABLED'
  | 'SETTINGS_RESET';

export interface ISettingsRiskReason {
  code: SettingsRiskCode;
  level: RiskLevel;
  message: string;
}

export interface ISettingsRisk {
  level: RiskLevel;
  reasons: ISettingsRiskReason[];
}

export type SettingValueSource = 'default' | 'env' | 'settings';

export type SettingsResetScope =
  'appearance' | 'behavior' | 'runtime' | 'server' | 'plugins' | 'all';

export interface ISettingDiffItem {
  path: string;
  before: unknown;
  after: unknown;
  effect: 'instant' | 'hot-reload' | 'restart-required';
}

export interface ISystemPathsSummary {
  settingsFilePath: string;
  dataDir: string;
  logsDir: string;
  cacheDir: string;
  pluginsDir: string;
  auditLogFilePath: string;
  appInstallDir: string;
  sourceCheckoutDir: string | null;
  platform: NodeJS.Platform;
  nodeVersion: string;
}

export interface ISettingsSnapshot {
  document: ISettingsDocument;
  sources: {
    runtime: Record<keyof ISettingsDocument['runtime'], SettingValueSource>;
    server: Record<keyof ISettingsDocument['server'], SettingValueSource>;
  };
  restartRequiredFields: (keyof ISettingsDocument['server'])[];
  systemPaths: ISystemPathsSummary;
  plugins: IPluginsCatalog;
}

export interface ISettingsPreviewResponse {
  previewId: string;
  action: 'update' | 'import' | 'reset';
  expiresAt: string;
  changes: ISettingDiffItem[];
  hotReloadFields: string[];
  restartRequiredFields: string[];
  clearsScanCache: boolean;
  risk: ISettingsRisk;
  targetDocument: ISettingsDocument;
  targetOverrides: ISettingsOverrides;
}

export interface ISettingsExportResponse {
  exportedAt: string;
  document: ISettingsDocument;
}
