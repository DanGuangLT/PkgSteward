import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { plainToInstance } from 'class-transformer';
import {
  ScanJobEntity,
  ScanResultEntity,
  ScanStartEntity,
} from '@/scanner/entities/scan.entity';
import { NotFoundException } from '@/common/exceptions/app.exception';
import { toPathPlatform } from '@/common/utils/path.util';
import { parseScanRootPaths } from '@/config/scan-roots';
import type { ScanRoots } from '@/config/scan-roots';
import { PathGuardService } from '@/core/path-guard/path-guard.service';
import { DRIVE_DETECTOR } from '@/platform/interfaces/drive-detector.interface';
import type { IDriveDetector } from '@/platform/interfaces/drive-detector.interface';
import type { IScannerService } from '@/scanner/interfaces/scanner.service.interface';
import type {
  IScanCacheKey,
  IScanFs,
  IScanJob,
  IScanResult,
  IScanStart,
  IWalkSnapshot,
  ScanStatus,
  ScanWalker,
} from '@/scanner/interfaces/scanner.types';
import { SCAN_WALKER } from '@/scanner/scan-walker';
import { makeScanCacheKey, ScannerCache } from '@/scanner/scanner-cache';

interface IActiveScan {
  job: IScanJob;
  roots: ScanRoots;
  key: IScanCacheKey;
  controller: AbortController;
  timer?: ReturnType<typeof setTimeout>;
}

const scanFs: IScanFs = {
  readdir: (directory) => fs.readdir(directory, { withFileTypes: true }),
  lstat: (file) => fs.lstat(file),
  realpath: (file) => fs.realpath(file),
  readFile: (file, signal) => fs.readFile(file, { encoding: 'utf8', signal }),
};

@Injectable()
export class ScannerService
  implements IScannerService, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ScannerService.name);
  private readonly platform = toPathPlatform();
  private current?: IActiveScan;
  private latest?: IScanResult;

  constructor(
    private readonly config: ConfigService,
    private readonly pathGuard: PathGuardService,
    @Inject(DRIVE_DETECTOR) private readonly detector: IDriveDetector,
    @Inject(SCAN_WALKER) private readonly walker: ScanWalker,
    private readonly cache: ScannerCache,
  ) {}

  private configuration() {
    const roots = parseScanRootPaths(
      this.config.get<string>('SCAN_ROOT_PATHS'),
      this.platform,
    );
    const maxDepth = Number(this.config.get<number>('MAX_SCAN_DEPTH') ?? 0);
    return { roots, key: makeScanCacheKey(roots, maxDepth, this.platform) };
  }

  async onModuleInit(): Promise<void> {
    const cached = await this.cache.load(this.configuration().key);
    if (cached) this.latest = structuredClone(cached.result);
  }

  startScan(): IScanStart {
    if (this.current?.job.status === 'running') {
      return plainToInstance(ScanStartEntity, {
        scanId: this.current.job.scanId,
        status: 'running',
      });
    }
    const active: IActiveScan = {
      ...this.configuration(),
      job: {
        scanId: randomUUID(),
        status: 'running',
        partial: false,
        progress: { visitedDirs: 0, foundProjects: 0, skippedCount: 0 },
        startedAt: new Date().toISOString(),
      },
      controller: new AbortController(),
    };
    // Giữ slot và đặt timeout (nếu có) trước cả bước phát hiện ổ đĩa.
    this.current = active;
    const timeout = this.config.get<number>('SCAN_TIMEOUT_MS');
    // Khi giá trị đã validate là undefined, ConfigService có thể trả lại chuỗi process.env.
    if (typeof timeout === 'number') {
      active.timer = setTimeout(
        () => this.finish(active, 'timed_out'),
        timeout,
      );
    }
    void this.run(active).catch((error: unknown) => {
      if (this.isRunning(active)) {
        this.logger.error(
          'Scan failed',
          error instanceof Error ? error.stack : error,
        );
        this.finish(active, 'failed');
      }
    });
    return plainToInstance(ScanStartEntity, {
      scanId: active.job.scanId,
      status: active.job.status,
    });
  }

  getScan(scanId: string): IScanJob {
    return plainToInstance(
      ScanJobEntity,
      structuredClone(this.requireScan(scanId).job),
    );
  }

  cancelScan(scanId: string): IScanJob {
    const active = this.requireScan(scanId);
    this.finish(active, 'cancelled');
    return plainToInstance(ScanJobEntity, structuredClone(active.job));
  }

  getLatest(): IScanResult {
    if (!this.latest) throw new NotFoundException('Latest scan');
    return plainToInstance(ScanResultEntity, structuredClone(this.latest));
  }

  private requireScan(scanId: string): IActiveScan {
    if (!this.current || this.current.job.scanId !== scanId) {
      throw new NotFoundException('Scan', scanId);
    }
    return this.current;
  }

  private isRunning(active: IActiveScan): boolean {
    return this.current === active && active.job.status === 'running';
  }

  private async run(active: IActiveScan): Promise<void> {
    const roots =
      active.roots.kind === 'paths'
        ? active.roots.paths
        : await this.detector.listFixedDrives();
    if (!this.isRunning(active)) return;
    // Chụp denylist một lần cho cả lần quét; lỗi → failed (fail closed).
    const isProtected = await this.pathGuard.createProtectedTreeMatcher();
    if (!this.isRunning(active)) return;
    const snapshot = await this.walker(
      roots,
      active.key.maxDepth,
      active.controller.signal,
      {
        platform: this.platform,
        fs: scanFs,
        isInsideProtectedTree: (directory) =>
          Promise.resolve(isProtected(directory)),
        onProgress: (progress) => {
          if (this.isRunning(active)) active.job.progress = { ...progress };
        },
        onSkipped: (directory, error) => {
          if (this.isRunning(active))
            this.logger.debug({
              message: 'Skipped scan directory',
              directory,
              error,
            });
        },
      },
    );
    if (this.isRunning(active)) this.finish(active, 'completed', snapshot);
    else if (this.current === active && active.job.status === 'timed_out') {
      // Chỉ publish snapshot thực sự do walker trả về sau abort.
      this.publish(active, 'timed_out', snapshot);
    }
  }

  private finish(
    active: IActiveScan,
    status: Exclude<ScanStatus, 'running'>,
    snapshot?: IWalkSnapshot,
  ): void {
    if (!this.isRunning(active)) return;
    active.job.status = status;
    active.job.partial = status !== 'completed';
    active.job.finishedAt = new Date().toISOString();
    clearTimeout(active.timer);
    active.timer = undefined;
    if (status === 'completed' && snapshot) {
      active.job.progress = { ...snapshot.progress };
      this.publish(active, status, snapshot);
    }
    active.controller.abort();
  }

  private publish(
    active: IActiveScan,
    status: 'completed' | 'timed_out',
    snapshot: IWalkSnapshot,
  ): void {
    const result: IScanResult = {
      scanId: active.job.scanId,
      status,
      partial: status === 'timed_out',
      roots: snapshot.roots,
      maxDepth: active.key.maxDepth,
      startedAt: active.job.startedAt,
      finishedAt: active.job.finishedAt!,
      skippedCount: snapshot.progress.skippedCount,
      projects: snapshot.projects,
      orphanNodeModules: snapshot.orphanNodeModules,
    };
    this.latest = structuredClone(result);
    void this.cache
      .save({
        schemaVersion: 1,
        key: structuredClone(active.key),
        result: structuredClone(result),
      })
      .catch((error: unknown) =>
        this.logger.warn('Could not save scan cache', error),
      );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.current) this.finish(this.current, 'cancelled');
    await Promise.resolve();
    await this.cache.flush();
  }
}
