import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import {
  AppException,
  ForbiddenException,
  InternalServerException,
  NotFoundException,
  ValidationException,
} from '@/common/exceptions/app.exception';
import {
  pathApi,
  toComparable,
  toPathPlatform,
} from '@/common/utils/path.util';
import { PathGuardService } from '@/core/path-guard/path-guard.service';
import { MutationGateService } from '@/core/mutation-gate/mutation-gate.service';
import { DiskUsageCache } from '@/disk-usage/disk-usage-cache';
import { DISK_FS, DISK_WALKER } from '@/disk-usage/disk-usage-walker';
import type { IDiskUsageService } from '@/disk-usage/interfaces/disk-usage.service.interface';
import type {
  DiskWalker,
  DiskStatus,
  ICompletedDiskSize,
  IDiskFs,
  IDiskUsageJob,
  IDiskUsageStart,
  IStartDiskUsage,
} from '@/disk-usage/interfaces/disk-usage.types';

interface IActiveMeasurement {
  job: IDiskUsageJob;
  rootMtimeNs: bigint;
  controller: AbortController;
}

@Injectable()
export class DiskUsageService implements IDiskUsageService, OnModuleDestroy {
  private readonly logger = new Logger(DiskUsageService.name);
  private readonly platform = toPathPlatform();
  private current?: IActiveMeasurement;
  private closed = false;

  constructor(
    private readonly pathGuard: PathGuardService,
    @Inject(DISK_WALKER) private readonly walker: DiskWalker,
    @Inject(DISK_FS) private readonly fs: IDiskFs,
    private readonly cache: DiskUsageCache,
    private readonly gate: MutationGateService,
  ) {}

  async start({
    path,
    view = 'directory',
    force = false,
  }: IStartDiskUsage): Promise<IDiskUsageStart> {
    this.assertOpen();
    const { realPath } = await this.pathGuard.assertAllowed(path);
    this.assertOpen();
    const basename = pathApi(this.platform).basename(path);
    if (
      view === 'packages' &&
      (this.platform === 'win32' ? basename.toLowerCase() : basename) !==
        'node_modules'
    ) {
      throw new ValidationException(
        'Package view requires a node_modules directory',
      );
    }
    const root = await this.statRoot(realPath);
    this.assertOpen();
    if (!root.isDirectory()) {
      throw new ValidationException('Disk usage path must be a directory');
    }
    // Check after authorization/stat awaits; keep cache lookup and slot reservation synchronous.
    this.gate.assertIdle();
    if (this.current?.job.status === 'running') {
      const running = this.current.job;
      if (
        toComparable(running.path, this.platform) ===
          toComparable(realPath, this.platform) &&
        running.view === view
      ) {
        return { jobId: running.jobId, status: 'running' };
      }
      throw new AppException(
        409,
        'A disk usage measurement is already running',
        'CONFLICT',
        { jobId: running.jobId, path: running.path },
      );
    }
    if (force) this.cache.clear();
    const cached = force ? null : this.cache.get(realPath, view, root.mtimeNs);
    const startedAt = new Date().toISOString();
    const jobId = randomUUID();
    const job: IDiskUsageJob = cached
      ? {
          ...cached,
          jobId,
          path: realPath,
          view,
          startedAt,
          finishedAt: startedAt,
          cacheHit: true,
        }
      : {
          jobId,
          status: 'running',
          path: realPath,
          view,
          metric: 'unique-apparent',
          phase: 'listing',
          partial: true,
          stopReason: null,
          sizeBytes: null,
          fileCount: null,
          children: [],
          progress: {
            visitedDirs: 0,
            visitedEntries: 0,
            skippedCount: 0,
            skippedLinks: 0,
          },
          startedAt,
          measuredAt: null,
          cacheHit: false,
          failureCode: null,
        };
    const active: IActiveMeasurement = {
      job,
      rootMtimeNs: root.mtimeNs,
      controller: new AbortController(),
    };
    // Giữ slot trước await tiếp theo để hai start không cùng chạy walker.
    this.current = active;
    if (!cached) {
      void this.run(active).catch((error: unknown) => {
        // Promise của job đã huỷ/bị thay settle muộn là bình thường, không log lỗi.
        if (!this.isRunning(active)) return;
        this.logger.error(
          'Disk usage measurement failed',
          error instanceof Error ? error.stack : error,
        );
        this.finish(active, 'failed');
      });
    }
    return { jobId, status: job.status };
  }

  hasRunningMeasurement(): boolean {
    return this.current?.job.status === 'running';
  }

  get(jobId: string): IDiskUsageJob {
    return structuredClone(this.requireJob(jobId).job);
  }

  cancel(jobId: string): IDiskUsageJob {
    const active = this.requireJob(jobId);
    this.finish(active, 'cancelled');
    return structuredClone(active.job);
  }

  peekCompletedSize(canonicalPath: string): ICompletedDiskSize | null {
    return this.cache.peekCompletedSize(canonicalPath);
  }

  private requireJob(jobId: string): IActiveMeasurement {
    if (!this.current || this.current.job.jobId !== jobId) {
      throw new NotFoundException('Disk usage job', jobId);
    }
    return this.current;
  }

  private isRunning(active: IActiveMeasurement): boolean {
    return this.current === active && active.job.status === 'running';
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new AppException(
        503,
        'Disk usage service is shutting down',
        'SERVICE_UNAVAILABLE',
      );
    }
  }

  private fsFailureCode(
    error: unknown,
  ): NonNullable<IDiskUsageJob['failureCode']> {
    const code =
      error !== null && typeof error === 'object' && 'code' in error
        ? error.code
        : null;
    if (code === 'ENOENT' || code === 'ENOTDIR') return 'NOT_FOUND';
    if (code === 'EACCES' || code === 'EPERM') return 'FORBIDDEN';
    return 'INTERNAL_SERVER_ERROR';
  }

  private async statRoot(path: string): Promise<BigIntStats> {
    try {
      return await this.fs.lstat(path);
    } catch (error) {
      if (error instanceof AppException) throw error;
      const failureCode = this.fsFailureCode(error);
      if (failureCode === 'NOT_FOUND') {
        throw new NotFoundException('Disk usage path', path);
      }
      if (failureCode === 'FORBIDDEN') {
        throw new ForbiddenException('Disk usage path is not readable');
      }
      this.logger.error(
        'Could not inspect disk usage path',
        error instanceof Error ? error.stack : error,
      );
      throw new InternalServerException('Could not inspect disk usage path');
    }
  }

  private async run(active: IActiveMeasurement): Promise<void> {
    const isProtected = await this.pathGuard.createProtectedTreeMatcher();
    if (!this.isRunning(active)) return;
    const snapshot = await this.walker(
      structuredClone(active.job),
      active.controller.signal,
      {
        fs: this.fs,
        platform: this.platform,
        isProtected,
        onError: (error) => {
          if (!this.isRunning(active)) return;
          this.logger.error(
            'Disk usage measurement failed',
            error instanceof Error ? error.stack : error,
          );
        },
        onSnapshot: (update) => {
          if (!this.isRunning(active) || update.jobId !== active.job.jobId) {
            return;
          }
          // Walker phát terminal trước resolve; chỉ run/finish được đóng job.
          active.job = {
            ...structuredClone(update),
            status: 'running',
            partial: true,
            measuredAt: null,
          };
          delete active.job.finishedAt;
        },
      },
    );
    if (!this.isRunning(active)) return;
    const result = structuredClone(snapshot);
    if (result.status === 'running') {
      throw new InternalServerException('Disk usage walker did not finish');
    }
    if (result.status === 'completed' && !result.partial) {
      let root: BigIntStats;
      try {
        root = await this.fs.lstat(active.job.path, active.controller.signal);
      } catch (error) {
        if (!this.isRunning(active)) return;
        const failureCode = this.fsFailureCode(error);
        if (failureCode === 'INTERNAL_SERVER_ERROR') {
          this.logger.error(
            'Disk usage measurement failed',
            error instanceof Error ? error.stack : error,
          );
        }
        this.finish(active, 'failed', {
          ...result,
          failureCode,
          finishedAt: new Date().toISOString(),
        });
        return;
      }
      // Huỷ hoặc thay job trong lúc stat phải chặn cả publish lẫn cache.
      if (!this.isRunning(active)) return;
      if (!root.isDirectory() || root.mtimeNs !== active.rootMtimeNs) {
        result.partial = true;
      } else if (result.stopReason === null) {
        this.cache.put(result, active.rootMtimeNs);
      }
    }
    this.finish(active, result.status, result);
  }

  private finish(
    active: IActiveMeasurement,
    status: Exclude<DiskStatus, 'running'>,
    snapshot?: IDiskUsageJob,
  ): void {
    if (!this.isRunning(active)) return;
    active.job = structuredClone(snapshot ?? active.job);
    active.job.status = status;
    active.job.partial = status !== 'completed' || active.job.partial;
    active.job.finishedAt = snapshot?.finishedAt ?? new Date().toISOString();
    if (status === 'cancelled') active.job.stopReason = 'cancelled';
    if (status !== 'completed') {
      for (const row of active.job.children) {
        if (row.state === 'pending' || row.state === 'measuring') {
          row.state = 'partial';
        }
      }
    }
    active.job.measuredAt =
      status === 'completed'
        ? (snapshot?.measuredAt ?? active.job.finishedAt)
        : null;
    active.job.failureCode =
      status === 'failed'
        ? (snapshot?.failureCode ?? 'INTERNAL_SERVER_ERROR')
        : null;
    active.controller.abort();
  }

  onModuleDestroy(): void {
    this.closed = true;
    if (this.current) this.finish(this.current, 'cancelled');
  }
}
