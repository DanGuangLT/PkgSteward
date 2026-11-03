import type { ConfigService } from '@nestjs/config';
import { AppPathsService } from '@/core/app-paths/app-paths.service';

export const createTestAppPaths = (
  configService: ConfigService,
  appInstallDir: string,
): AppPathsService => {
  const appPaths = new AppPathsService(configService);
  Object.defineProperty(appPaths, 'appInstallDir', { value: appInstallDir });
  return appPaths;
};
