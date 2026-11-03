export type AppDataSubdir = 'logs' | 'cache';

export interface IAppPathsService {
  readonly appInstallDir: string;
  readonly sourceCheckoutDir: string | null;
  readonly dataDir: string;
  readonly logsDir: string;
  readonly cacheDir: string;
  readonly settingsFilePath: string;
  readonly auditLogFilePath: string;
  ensureDir(subdir: AppDataSubdir): Promise<string>;
}
