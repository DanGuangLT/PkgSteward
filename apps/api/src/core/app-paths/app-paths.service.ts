import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir } from 'fs/promises';
import { homedir } from 'os';
import * as path from 'path';
import {
  AUDIT_LOG_FILE_NAME,
  findPackageRoot,
  findSourceCheckoutDir,
  resolveDataDir,
  SETTINGS_FILE_NAME,
} from '@/core/app-paths/app-paths.util';
import type {
  AppDataSubdir,
  IAppPathsService,
} from '@/core/app-paths/interfaces/app-paths.service.interface';

// Runtime files stay in dataDir; directories are created only when requested.
@Injectable()
export class AppPathsService implements IAppPathsService {
  readonly appInstallDir: string;
  readonly sourceCheckoutDir: string | null;
  readonly dataDir: string;
  readonly logsDir: string;
  readonly cacheDir: string;
  readonly settingsFilePath: string;
  readonly auditLogFilePath: string;

  constructor(configService: ConfigService) {
    this.dataDir = resolveDataDir({
      override: configService.get<string>('PKGSTEWARD_DATA_DIR'),
      localAppData: process.env.LOCALAPPDATA,
      homeDir: homedir(),
      platform: process.platform,
    });
    this.appInstallDir = findPackageRoot(__dirname);
    this.sourceCheckoutDir = findSourceCheckoutDir(this.appInstallDir);
    this.logsDir = path.join(this.dataDir, 'logs');
    this.cacheDir = path.join(this.dataDir, 'cache');
    this.settingsFilePath = path.join(this.dataDir, SETTINGS_FILE_NAME);
    this.auditLogFilePath = path.join(this.logsDir, AUDIT_LOG_FILE_NAME);
  }

  async ensureDir(subdir: AppDataSubdir): Promise<string> {
    const dir = subdir === 'logs' ? this.logsDir : this.cacheDir;
    await mkdir(dir, { recursive: true });
    return dir;
  }
}
