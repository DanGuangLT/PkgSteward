import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir } from 'fs/promises';
import { homedir } from 'os';
import * as path from 'path';
import {
  AUDIT_LOG_FILE_NAME,
  findAppRootDir,
  findPackageRoot,
  findSourceCheckoutDir,
  PLUGINS_DIR_NAME,
  resolveAppDataDir,
  SETTINGS_FILE_NAME,
  wrapDataDirWriteError,
} from '@/core/app-paths/app-paths.util';
import type {
  AppDataSubdir,
  IAppPathsService,
} from '@/core/app-paths/interfaces/app-paths.service.interface';

// Runtime files stay in dataDir; directories are created only when requested.
@Injectable()
export class AppPathsService implements IAppPathsService {
  readonly appInstallDir: string;
  readonly appRootDir: string;
  readonly sourceCheckoutDir: string | null;
  readonly portableBaseDir: string | null;
  readonly dataDir: string;
  readonly logsDir: string;
  readonly cacheDir: string;
  readonly pluginsDir: string;
  readonly settingsFilePath: string;
  readonly auditLogFilePath: string;

  constructor(configService: ConfigService) {
    this.appInstallDir = findPackageRoot(__dirname);
    this.sourceCheckoutDir = findSourceCheckoutDir(this.appInstallDir);
    this.appRootDir = findAppRootDir(
      this.appInstallDir,
      this.sourceCheckoutDir,
    );
    const resolved = resolveAppDataDir({
      override: configService.get<string>('PKGSTEWARD_DATA_DIR'),
      appInstallDir: this.appInstallDir,
      appRootDir: this.appRootDir,
      sourceCheckoutDir: this.sourceCheckoutDir,
      env: process.env,
      homeDir: homedir(),
      platform: process.platform,
    });
    this.portableBaseDir = resolved.portableBaseDir;
    this.dataDir = resolved.dataDir;
    this.logsDir = path.join(this.dataDir, 'logs');
    this.cacheDir = path.join(this.dataDir, 'cache');
    this.pluginsDir = path.join(this.dataDir, PLUGINS_DIR_NAME);
    this.settingsFilePath = path.join(this.dataDir, SETTINGS_FILE_NAME);
    this.auditLogFilePath = path.join(this.logsDir, AUDIT_LOG_FILE_NAME);
  }

  async ensureDir(subdir: AppDataSubdir): Promise<string> {
    const dir =
      subdir === 'logs'
        ? this.logsDir
        : subdir === 'cache'
          ? this.cacheDir
          : this.pluginsDir;
    try {
      await mkdir(dir, { recursive: true });
    } catch (error) {
      throw wrapDataDirWriteError(this.dataDir, dir, error);
    }
    return dir;
  }
}
