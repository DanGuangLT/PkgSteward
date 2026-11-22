import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lstat, realpath } from 'fs/promises';
import { homedir } from 'os';
import { toPathPlatform } from '@/common/utils/path.util';
import type { PathPlatform } from '@/common/utils/path.util';
import { parseScanRootPaths } from '@/config/environment/scan-roots';
import { AppPathsService } from '@/core/app-paths/app-paths.service';
import { buildDenylist } from '@/core/path-guard/denylist';
import type { IPathGuardService } from '@/core/path-guard/interfaces/path-guard.service.interface';
import type {
  IDenyEntry,
  IGuardedPath,
  PathChecker,
  PathCheckResult,
  ProtectedTreeMatcher,
} from '@/core/path-guard/interfaces/path-guard.types';
import { PathGuard } from '@/core/path-guard/path-guard';
import { RuntimeConfigService } from '@/core/runtime-config/runtime-config.service';
import { DRIVE_DETECTOR } from '@/platform/interfaces/drive-detector.interface';
import type { IDriveDetector } from '@/platform/interfaces/drive-detector.interface';

// Helper path guard DÙNG CHUNG cho mọi module nhận path từ client (D10).
@Injectable()
export class PathGuardService implements IPathGuardService {
  private readonly platform: PathPlatform;
  private readonly denylist: IDenyEntry[];
  private readonly driveDetector: IDriveDetector;
  private readonly fsAdapter = {
    realpath: (p: string) => realpath(p),
    lstat: (p: string) => lstat(p),
  };
  private guard: PathGuard;

  constructor(
    configService: ConfigService,
    appPaths: AppPathsService,
    @Inject(DRIVE_DETECTOR) driveDetector: IDriveDetector,
    @Optional() runtimeConfig?: RuntimeConfigService,
  ) {
    this.platform = toPathPlatform();
    this.driveDetector = driveDetector;
    this.denylist = buildDenylist({
      platform: this.platform,
      env: process.env,
      homeDir: homedir(),
      appInstallDir: appPaths.appInstallDir,
      sourceCheckoutDir: appPaths.sourceCheckoutDir,
      dataDir: appPaths.dataDir,
    });
    const rawScanRoots =
      runtimeConfig?.getScanRootPathsRaw() ??
      configService.get<string>('SCAN_ROOT_PATHS');
    this.guard = this.buildGuard(rawScanRoots);
  }

  private buildGuard(rawScanRootPaths: string | undefined): PathGuard {
    return new PathGuard({
      platform: this.platform,
      scanRoots: parseScanRootPaths(rawScanRootPaths, this.platform),
      driveDetector: this.driveDetector,
      denylist: this.denylist,
      fs: this.fsAdapter,
    });
  }

  reloadScanRoots(rawScanRootPaths: string | undefined): void {
    this.guard = this.buildGuard(rawScanRootPaths);
  }

  check(inputPath: string): Promise<PathCheckResult> {
    return this.guard.check(inputPath);
  }

  checkMany(inputPaths: readonly string[]): Promise<PathCheckResult[]> {
    return this.guard.checkMany(inputPaths);
  }

  createOperationChecker(): PathChecker {
    return this.guard.createOperationChecker();
  }

  assertAllowed(inputPath: string): Promise<IGuardedPath> {
    return this.guard.assertAllowed(inputPath);
  }

  isInsideProtectedTree(absolutePath: string): Promise<boolean> {
    return this.guard.isInsideProtectedTree(absolutePath);
  }

  findDenyReason(absolutePath: string): Promise<string | null> {
    return this.guard.findDenyReason(absolutePath);
  }

  createProtectedTreeMatcher(): Promise<ProtectedTreeMatcher> {
    return this.guard.createProtectedTreeMatcher();
  }
}
