import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lstat, realpath } from 'fs/promises';
import { homedir } from 'os';
import { toPathPlatform } from '@/common/utils/path.util';
import { parseScanRootPaths } from '@/config/scan-roots';
import { AppPathsService } from '@/core/app-paths/app-paths.service';
import { buildDenylist } from '@/core/path-guard/denylist';
import type { IPathGuardService } from '@/core/path-guard/interfaces/path-guard.service.interface';
import type {
  IGuardedPath,
  PathCheckResult,
  ProtectedTreeMatcher,
} from '@/core/path-guard/interfaces/path-guard.types';
import { PathGuard } from '@/core/path-guard/path-guard';
import { DRIVE_DETECTOR } from '@/platform/interfaces/drive-detector.interface';
import type { IDriveDetector } from '@/platform/interfaces/drive-detector.interface';

// Helper path guard DÙNG CHUNG cho mọi module nhận path từ client (D10).
@Injectable()
export class PathGuardService implements IPathGuardService {
  private readonly guard: PathGuard;

  constructor(
    configService: ConfigService,
    appPaths: AppPathsService,
    @Inject(DRIVE_DETECTOR) driveDetector: IDriveDetector,
  ) {
    const platform = toPathPlatform();
    this.guard = new PathGuard({
      platform,
      scanRoots: parseScanRootPaths(
        configService.get<string>('SCAN_ROOT_PATHS'),
        platform,
      ),
      driveDetector,
      denylist: buildDenylist({
        platform,
        env: process.env,
        homeDir: homedir(),
        appInstallDir: appPaths.appInstallDir,
        sourceCheckoutDir: appPaths.sourceCheckoutDir,
        dataDir: appPaths.dataDir,
      }),
      fs: { realpath: (p) => realpath(p), lstat: (p) => lstat(p) },
    });
  }

  check(inputPath: string): Promise<PathCheckResult> {
    return this.guard.check(inputPath);
  }

  assertAllowed(inputPath: string): Promise<IGuardedPath> {
    return this.guard.assertAllowed(inputPath);
  }

  isInsideProtectedTree(absolutePath: string): Promise<boolean> {
    return this.guard.isInsideProtectedTree(absolutePath);
  }

  createProtectedTreeMatcher(): Promise<ProtectedTreeMatcher> {
    return this.guard.createProtectedTreeMatcher();
  }
}
