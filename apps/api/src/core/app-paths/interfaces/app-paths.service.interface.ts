export type AppDataSubdir = 'logs' | 'cache' | 'plugins';

export interface IAppPathsService {
  readonly appInstallDir: string;
  readonly sourceCheckoutDir: string | null;
  readonly dataDir: string;
  readonly logsDir: string;
  readonly cacheDir: string;
  readonly pluginsDir: string;
  readonly settingsFilePath: string;
  readonly auditLogFilePath: string;
  ensureDir(subdir: AppDataSubdir): Promise<string>;
}
