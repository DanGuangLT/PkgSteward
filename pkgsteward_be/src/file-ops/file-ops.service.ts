import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AppException,
  NotFoundException,
  ValidationException,
} from '@/common/exceptions/app.exception';
import { toPathPlatform } from '@/common/utils/path.util';
import { MutationGateService } from '@/core/mutation-gate/mutation-gate.service';
import { PathGuardService } from '@/core/path-guard/path-guard.service';
import { DISK_FS } from '@/disk-usage/disk-usage-walker';
import type { IDiskFs } from '@/disk-usage/interfaces/disk-usage.types';
import { discoverCleanupCandidates } from '@/file-ops/cleanup-discovery';
import {
  assessTargets,
  type IAssessDeps,
  type IAssessedTarget,
} from '@/file-ops/file-ops-assessment';
import { measureTarget } from '@/file-ops/file-ops-measure';
import {
  assessSelectionRisk,
  selectionConfirmText,
} from '@/file-ops/file-ops-risk';
import { readTreeLevel } from '@/file-ops/file-tree';
import { GitProbe } from '@/file-ops/git-probe';
import { FILE_OPS_FS } from '@/file-ops/interfaces/file-ops.types';
import type {
  CleanupKind,
  IFileOpsFsBundle,
  IFileOpsPreview,
  IFileOpsTarget,
  IFileTreeLevel,
  IPreviewSummary,
  ITargetSize,
  JobStatus,
} from '@/file-ops/interfaces/file-ops.types';
import { PreviewStore, type IPreviewRecord } from '@/file-ops/preview-store';
import { PROCESS_SNAPSHOT } from '@/platform/interfaces/process-snapshot.interface';
import type { IProcessSnapshot } from '@/platform/interfaces/process-snapshot.interface';
import { ScannerService } from '@/scanner/scanner.service';
import type {
  IScanResult,
  IStoredScanResult,
} from '@/scanner/interfaces/scanner.types';

export const PREVIEW_MEASUREMENT_CONCURRENCY = 4;

interface ICleanupPreviewInput {
  includeKinds?: CleanupKind[];
  olderThanDays?: number;
  minSizeBytes?: number;
  projectPaths?: string[];
}

type PreviewRequest =
  | { source: 'cleanup'; input: ICleanupPreviewInput }
  | { source: 'delete'; input: { paths: string[] } };

@Injectable()
export class FileOpsService {
  private readonly logger = new Logger(FileOpsService.name);
  private readonly platform = toPathPlatform();
  private readonly previews = new PreviewStore();
  private active?: IPreviewRecord;

  constructor(
    private readonly scanner: ScannerService,
    private readonly gate: MutationGateService,
    private readonly pathGuard: PathGuardService,
    @Inject(FILE_OPS_FS) private readonly fs: IFileOpsFsBundle,
    @Inject(DISK_FS) private readonly diskFs: IDiskFs,
    private readonly git: GitProbe,
    @Inject(PROCESS_SNAPSHOT) private readonly processes: IProcessSnapshot,
  ) {}

  startCleanupPreview(input: ICleanupPreviewInput): {
    previewId: string;
    status: JobStatus;
  } {
    return this.start({ source: 'cleanup', input });
  }

  startDeletePreview(input: { paths: string[] }): {
    previewId: string;
    status: JobStatus;
  } {
    return this.start({ source: 'delete', input });
  }

  getPreview(previewId: string): IFileOpsPreview {
    const preview = this.previews.get(previewId);
    if (!preview)
      throw new NotFoundException('File operation preview', previewId);
    return preview;
  }

  cancelPreview(previewId: string): IFileOpsPreview {
    const preview = this.getPreview(previewId);
    if (
      preview.status === 'running' &&
      this.active?.preview.previewId === previewId
    ) {
      this.finish(this.active, 'cancelled');
    }
    return this.getPreview(previewId);
  }

  summarizePreview(previewId: string, paths: string[]): IPreviewSummary {
    const preview = this.getPreview(previewId);
    if (preview.status !== 'completed' && preview.status !== 'cancelled') {
      throw new AppException(
        409,
        'Preview is not ready for selection',
        'CONFLICT',
      );
    }
    const eligible = new Map(
      preview.targets
        .filter((target) => target.valid && target.size.status === 'done')
        .map((target) => [target.path, target]),
    );
    const seen = new Set<string>();
    const invalidPaths = new Set<string>();
    for (const path of paths) {
      if (seen.has(path) || !eligible.has(path)) invalidPaths.add(path);
      seen.add(path);
    }
    if (paths.length === 0 || invalidPaths.size > 0) {
      throw new ValidationException(
        'Select distinct measured paths from the preview',
        { paths: [...invalidPaths] },
      );
    }
    const selected = paths.map((path) => eligible.get(path)!);
    const risk = assessSelectionRisk(
      selected.map((target) => ({
        risk: target.risk,
        sizeBytes: target.size.sizeBytes ?? 0,
      })),
    );
    return {
      paths: [...paths],
      risk,
      confirmText: selectionConfirmText(selected, risk, this.platform),
      totals: {
        targetCount: selected.length,
        reclaimableBytes: selected.reduce(
          (total, target) =>
            total +
            (target.method === 'permanent'
              ? (target.size.reclaimableBytes ?? 0)
              : 0),
          0,
        ),
        recycleBytes: selected.reduce(
          (total, target) =>
            total +
            (target.method === 'recycle' ? (target.size.sizeBytes ?? 0) : 0),
          0,
        ),
      },
    };
  }

  async getTree(path: string): Promise<IFileTreeLevel> {
    return readTreeLevel(path, toScanMetadata(this.scanner.getLatest()), {
      platform: this.platform,
      checkMany: (paths) => this.pathGuard.checkMany(paths),
      fs: {
        lstat: (targetPath) => this.fs.files.lstat(targetPath),
        entries: (directoryPath, signal) =>
          this.diskFs.entries(directoryPath, signal),
      },
      signal: new AbortController().signal,
    });
  }

  private start(request: PreviewRequest): {
    previewId: string;
    status: JobStatus;
  } {
    this.gate.assertIdle();
    if (this.previews.hasRunningPreview()) {
      throw new AppException(
        409,
        'A file operation preview is already running',
        'CONFLICT',
      );
    }
    const scan = toScanMetadata(this.scanner.getLatest());
    const now = new Date();
    const previewId = randomUUID();
    const record: IPreviewRecord = {
      preview: {
        previewId,
        source: request.source,
        status: 'running',
        scanId: scan.scanId,
        progress: { totalTargets: 0, measuredTargets: 0 },
        targets: [],
        risk: { level: 'low', reasons: [] },
        confirmText: null,
        operationId: null,
        startedAt: now.toISOString(),
        failureCode: null,
      },
      identities: new Map(),
      measurements: new Map(),
      controller: new AbortController(),
    };
    // Capture the request and reserve the slot before starting asynchronous work.
    const capturedRequest = structuredClone(request);
    this.previews.create(record);
    this.active = record;
    void this.run(record, scan, capturedRequest, now).catch(() => {
      if (!this.isRunning(record)) return;
      // Neither filesystem errors nor process command lines belong in the API/log message.
      this.logger.error('File operation preview failed');
      this.finish(record, 'failed');
    });
    return { previewId, status: 'running' };
  }

  private async run(
    record: IPreviewRecord,
    scan: IStoredScanResult,
    request: PreviewRequest,
    now: Date,
  ): Promise<void> {
    const deps: IAssessDeps = {
      platform: this.platform,
      fs: this.fs,
      checkMany: (paths) => this.pathGuard.checkMany(paths),
      git: this.git,
      processes: this.processes,
      selfPid: process.pid,
      now,
      signal: record.controller.signal,
    };
    let assessed: IAssessedTarget[];
    if (request.source === 'cleanup') {
      const candidates = await discoverCleanupCandidates(
        scan,
        {
          includeKinds: request.input.includeKinds ?? [
            'node_modules',
            'orphan_node_modules',
            'build_cache',
          ],
          projectPaths: request.input.projectPaths,
        },
        {
          platform: this.platform,
          fs: this.fs.files,
          git: this.git,
          signal: deps.signal,
        },
      );
      if (!this.isRunning(record)) return;
      assessed = await assessTargets(
        candidates.map(({ path }) => path),
        scan,
        deps,
        new Map(
          candidates.map((candidate) => [
            candidate.path,
            {
              trackedCheck: candidate.trackedCheck,
              frameworkVerified: candidate.frameworkVerified,
            },
          ]),
        ),
      );
      if (!this.isRunning(record)) return;
      const olderThanDays = request.input.olderThanDays;
      assessed = assessed.filter(
        (target) =>
          target.valid &&
          isCleanupKind(target.kind) &&
          (olderThanDays === undefined ||
            (target.lastActivityAt !== null &&
              Date.parse(target.lastActivityAt) <
                now.getTime() - olderThanDays * 86_400_000)),
      );
    } else {
      assessed = await assessTargets(request.input.paths, scan, deps);
      if (!this.isRunning(record)) return;
    }
    record.preview.targets = assessed.map((target): IFileOpsTarget => {
      if (target.valid && target.identity) {
        record.identities.set(target.path, structuredClone(target.identity));
      }
      // Deliberate public projection: inputPath/identity stay server-side.
      return {
        path: target.path,
        kind: target.kind,
        method: target.method,
        valid: target.valid,
        failureCode: target.failureCode,
        owner: target.owner,
        nestedProjects: target.nestedProjects,
        hasLockfile: target.hasLockfile,
        lastActivityAt: target.lastActivityAt,
        risk: target.risk,
        defaultSelected: target.defaultSelected,
        size: emptySize(target.valid ? 'pending' : 'failed'),
      };
    });
    this.publish(record);

    const queue = record.preview.targets
      .filter((target) => target.valid)
      .sort((a, b) => {
        if (a.lastActivityAt === b.lastActivityAt) return 0;
        if (a.lastActivityAt === null) return 1;
        if (b.lastActivityAt === null) return -1;
        return Date.parse(a.lastActivityAt) - Date.parse(b.lastActivityAt);
      });
    const minSizeBytes =
      request.source === 'cleanup' ? request.input.minSizeBytes : undefined;
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      while (this.isRunning(record)) {
        const target = queue[nextIndex++];
        if (!target) return;
        target.size = emptySize('measuring');
        this.publish(record);
        const result = await measureTarget(target.path, {
          fs: this.diskFs,
          platform: this.platform,
          signal: deps.signal,
        });
        // Cancellation/failure may have returned a terminal response during this await.
        if (!this.isRunning(record)) return;
        if (result.status === 'cancelled') {
          this.finish(record, 'cancelled');
          return;
        }
        if (result.status === 'done') {
          target.size = { status: 'done', ...result.size };
          record.measurements.set(target.path, structuredClone(result.size));
          if (
            minSizeBytes !== undefined &&
            result.size.sizeBytes < minSizeBytes
          ) {
            record.preview.targets = record.preview.targets.filter(
              (row) => row !== target,
            );
            record.identities.delete(target.path);
            record.measurements.delete(target.path);
          }
        } else {
          target.size = emptySize('failed');
        }
        this.publish(record);
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(PREVIEW_MEASUREMENT_CONCURRENCY, queue.length) },
        () => worker(),
      ),
    );
    if (this.isRunning(record)) this.finish(record, 'completed');
  }

  private isRunning(record: IPreviewRecord): boolean {
    return this.active === record && record.preview.status === 'running';
  }

  private publish(record: IPreviewRecord): void {
    const { preview } = record;
    const valid = preview.targets.filter((target) => target.valid);
    preview.progress = {
      totalTargets: preview.targets.length,
      measuredTargets: preview.targets.filter(
        ({ size }) => size.status === 'done' || size.status === 'failed',
      ).length,
    };
    preview.risk = assessSelectionRisk(
      valid.map((target) => ({
        risk: target.risk,
        sizeBytes: target.size.sizeBytes ?? 0,
      })),
    );
    preview.confirmText = selectionConfirmText(
      valid,
      preview.risk,
      this.platform,
    );
    this.previews.update(preview.previewId, preview, record);
  }

  private finish(
    record: IPreviewRecord,
    status: Exclude<JobStatus, 'running'>,
  ): void {
    if (!this.isRunning(record)) return;
    record.preview.status = status;
    record.preview.finishedAt = new Date().toISOString();
    record.preview.failureCode = status === 'failed' ? 'INTERNAL_ERROR' : null;
    if (status !== 'completed') {
      for (const target of record.preview.targets) {
        if (
          target.size.status === 'pending' ||
          target.size.status === 'measuring'
        ) {
          target.size = emptySize('cancelled');
        }
      }
    }
    this.publish(record);
    record.controller.abort();
  }
}

const emptySize = (status: ITargetSize['status']): ITargetSize => ({
  status,
  apparentBytes: null,
  sizeBytes: null,
  reclaimableBytes: null,
  sharedBytes: null,
  fileCount: null,
});

const isCleanupKind = (kind: IFileOpsTarget['kind']): kind is CleanupKind =>
  kind === 'node_modules' ||
  kind === 'orphan_node_modules' ||
  kind === 'build_cache';

// Scanner API copies may include cached disk sizes. Classification uses only scan metadata.
function toScanMetadata(scan: IScanResult): IStoredScanResult {
  return {
    ...scan,
    projects: scan.projects.map((project) => ({
      ...project,
      nodeModules: {
        ...project.nodeModules,
        sizeBytes: null,
        sizeMeasuredAt: null,
      },
    })),
    orphanNodeModules: scan.orphanNodeModules.map((orphan) => ({
      ...orphan,
      sizeBytes: null,
      sizeMeasuredAt: null,
    })),
  };
}
