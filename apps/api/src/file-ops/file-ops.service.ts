import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AppException,
  InternalServerException,
  NotFoundException,
  ValidationException,
} from '@/common/exceptions/app.exception';
import {
  pathApi,
  toComparable,
  toPathPlatform,
} from '@/common/utils/path.util';
import { AuditLogService } from '@/core/audit-log/audit-log.service';
import type { IAuditRecord } from '@/core/audit-log/interfaces/audit-log.types';
import { MutationGateService } from '@/core/mutation-gate/mutation-gate.service';
import { PathGuardService } from '@/core/path-guard/path-guard.service';
import type { PathChecker } from '@/core/path-guard/interfaces/path-guard.types';
import { validateConfirmation } from '@/core/risk/confirmation';
import type { IRisk } from '@/core/risk/interfaces/risk.types';
import { DISK_FS } from '@/disk-usage/disk-usage-walker';
import { DiskUsageService } from '@/disk-usage/disk-usage.service';
import type { IDiskFs } from '@/disk-usage/interfaces/disk-usage.types';
import { discoverCleanupCandidates } from '@/file-ops/cleanup-discovery';
import { deleteTarget } from '@/file-ops/file-deleter';
import {
  assessTargets,
  type IAssessDeps,
  type IAssessedTarget,
} from '@/file-ops/file-ops-assessment';
import {
  measureTarget,
  type ITargetMeasurement,
} from '@/file-ops/file-ops-measure';
import {
  assessSelectionRisk,
  changedRiskPaths,
  selectionConfirmText,
} from '@/file-ops/file-ops-risk';
import { errorCode } from '@/file-ops/file-ops-targets';
import { readTreeLevel } from '@/file-ops/file-tree';
import { GitProbe } from '@/file-ops/git-probe';
import type { IFileOpsService } from '@/file-ops/interfaces/file-ops.service.interface';
import { FILE_OPS_FS } from '@/file-ops/interfaces/file-ops.types';
import type {
  CleanupKind,
  FileOpsKind,
  FileOpsMethod,
  ICleanupPreviewInput,
  IExecuteInput,
  IFileOpsFsBundle,
  IFileOpsOperation,
  IFileOpsPreview,
  IFileOpsStat,
  IFileOpsTarget,
  IFileOpsTargetResult,
  IFileTreeLevel,
  IOperationStart,
  IPreviewSummary,
  ITargetIdentity,
  ITargetSize,
  JobStatus,
} from '@/file-ops/interfaces/file-ops.types';
import { OperationStore } from '@/file-ops/operation-store';
import {
  PreviewStore,
  type IPreviewFacts,
  type IPreviewRecord,
} from '@/file-ops/preview-store';
import { PROCESS_SNAPSHOT } from '@/platform/interfaces/process-snapshot.interface';
import type { IProcessSnapshot } from '@/platform/interfaces/process-snapshot.interface';
import { RECYCLE_BIN } from '@/platform/interfaces/recycle-bin.interface';
import type { IRecycleBin } from '@/platform/interfaces/recycle-bin.interface';
import { ScannerService } from '@/scanner/scanner.service';
import type {
  IScanResult,
  IStoredScanResult,
} from '@/scanner/interfaces/scanner.types';

export const PREVIEW_MEASUREMENT_CONCURRENCY = 4;

type PreviewRequest =
  | { source: 'cleanup'; input: ICleanupPreviewInput }
  | { source: 'delete'; input: { paths: string[] } };

/** A selected target after preflight: preview path and identity, execute-time risk and owner. */
interface IExecuteTarget {
  path: string;
  kind: FileOpsKind;
  method: FileOpsMethod;
  owner: IFileOpsTarget['owner'];
  identity: ITargetIdentity;
  measurement: ITargetMeasurement;
  risk: IRisk;
}

@Injectable()
export class FileOpsService implements IFileOpsService {
  private readonly logger = new Logger(FileOpsService.name);
  private readonly platform = toPathPlatform();
  private readonly previews = new PreviewStore();
  private readonly operations = new OperationStore();
  private active?: IPreviewRecord;
  private activeOperation?: IFileOpsOperation;

  constructor(
    private readonly scanner: ScannerService,
    private readonly gate: MutationGateService,
    private readonly pathGuard: PathGuardService,
    @Inject(FILE_OPS_FS) private readonly fs: IFileOpsFsBundle,
    @Inject(DISK_FS) private readonly diskFs: IDiskFs,
    private readonly git: GitProbe,
    @Inject(PROCESS_SNAPSHOT) private readonly processes: IProcessSnapshot,
    private readonly diskUsage: DiskUsageService,
    private readonly audit: AuditLogService,
    @Inject(RECYCLE_BIN) private readonly recycleBin: IRecycleBin,
  ) {}

  hasRunningPreview(): boolean {
    return this.previews.hasRunningPreview();
  }

  async startExecute(input: IExecuteInput): Promise<IOperationStart> {
    const { previewId, paths } = input;
    const requested = new Set<string>();
    const duplicates = new Set<string>();
    for (const path of paths) {
      if (requested.has(path)) duplicates.add(path);
      requested.add(path);
    }
    if (paths.length === 0 || duplicates.size > 0) {
      throw new ValidationException('Select distinct paths from the preview', {
        paths: [...duplicates],
      });
    }

    const preview = this.getPreview(previewId);
    if (preview.status !== 'completed' && preview.status !== 'cancelled') {
      throw new AppException(
        409,
        'Preview is not ready for execution',
        'CONFLICT',
      );
    }
    if (preview.operationId !== null) {
      return this.replayExecute(preview.operationId, requested);
    }

    const facts = this.previews.getFacts(previewId);
    const eligible = new Map(
      preview.targets
        .filter(
          ({ path, valid, size }) =>
            valid &&
            size.status === 'done' &&
            facts?.identities.has(path) &&
            facts.measurements.has(path),
        )
        .map((target) => [target.path, target]),
    );
    const invalidPaths = paths.filter((path) => !eligible.has(path));
    if (!facts || invalidPaths.length > 0) {
      throw new ValidationException('Select measured paths from the preview', {
        paths: invalidPaths,
      });
    }
    const selected = [...eligible.values()].filter(({ path }) =>
      requested.has(path),
    );

    // Không await từ đây tới khi giữ cổng: reader hoặc execute khác có thể chen vào.
    const token =
      this.scanner.hasRunningScan() ||
      this.diskUsage.hasRunningMeasurement() ||
      this.previews.hasRunningPreview()
        ? null
        : this.gate.tryEnter();
    if (token === null) {
      throw new AppException(
        409,
        'A scan, measurement or file operation is in progress',
        'CONFLICT',
      );
    }

    try {
      const { targets, risk } = await this.preflight(
        input,
        preview.scanId,
        selected,
        facts,
      );
      const operationId = randomUUID();
      try {
        await this.audit.append({
          operation: 'file-ops.delete',
          operationId,
          phase: 'intent',
          targets: targets.map(({ path }) => path),
          method: [...new Set(targets.map(({ method }) => method))].join('+'),
          risk: auditRisk(risk),
          result: 'pending',
          errorCode: null,
        });
      } catch {
        throw new InternalServerException('Audit log is unavailable');
      }
      const operation: IFileOpsOperation = {
        operationId,
        previewId,
        status: 'running',
        currentPath: null,
        results: targets.map(({ path, kind, method, measurement }) => ({
          path,
          kind,
          method,
          status: 'pending',
          errorCode: null,
          mayBePartial: false,
          reclaimableBytes:
            method === 'permanent' ? measurement.reclaimableBytes : null,
        })),
        startedAt: new Date().toISOString(),
      };
      this.operations.create(operation);
      this.previews.attachOperation(previewId, operationId);
      this.activeOperation = operation;
      void this.runOperation(operation, targets, token).catch(() => {
        this.logger.error('File operation failed');
      });
      return { operationId, status: 'running' };
    } catch (error) {
      this.gate.leave(token);
      throw error;
    }
  }

  getOperation(operationId: string): IFileOpsOperation {
    const operation = this.operations.get(operationId);
    if (!operation) throw new NotFoundException('File operation', operationId);
    return operation;
  }

  getActiveOperation(): IFileOpsOperation | null {
    return this.activeOperation
      ? this.getOperation(this.activeOperation.operationId)
      : null;
  }

  cancelOperation(operationId: string): IFileOpsOperation {
    const active = this.activeOperation;
    if (active?.operationId === operationId && active.status === 'running') {
      active.status = 'stopping';
      this.operations.update(operationId, active);
    }
    return this.getOperation(operationId);
  }

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
            (target.method === 'recycle'
              ? (target.size.reclaimableBytes ?? 0)
              : 0),
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
    const deps = this.assessDeps(now, record.controller.signal);
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

  private assessDeps(now: Date, signal: AbortSignal): IAssessDeps {
    return {
      platform: this.platform,
      fs: this.fs,
      checkMany: (paths) => this.pathGuard.checkMany(paths),
      git: this.git,
      processes: this.processes,
      selfPid: process.pid,
      now,
      signal,
    };
  }

  private replayExecute(
    operationId: string,
    paths: ReadonlySet<string>,
  ): IOperationStart {
    const operation = this.operations.get(operationId);
    // Không còn bản ghi để đối chiếu thì từ chối: replay không bao giờ được xoá lại.
    if (
      !operation ||
      operation.results.length !== paths.size ||
      operation.results.some(({ path }) => !paths.has(path))
    ) {
      throw new AppException(
        409,
        'This preview was already executed; preview again',
        'CONFLICT',
      );
    }
    return { operationId, status: operation.status };
  }

  private async preflight(
    input: IExecuteInput,
    scanId: string,
    selected: readonly IFileOpsTarget[],
    facts: IPreviewFacts,
  ): Promise<{ targets: IExecuteTarget[]; risk: IRisk }> {
    const latest = this.scanner.getLatest();
    if (latest.scanId !== scanId) {
      throw new AppException(
        409,
        'The latest scan changed; preview again',
        'SCAN_CHANGED',
      );
    }
    const assessed = await assessTargets(
      selected.map(({ path }) => path),
      toScanMetadata(latest),
      this.assessDeps(new Date(), new AbortController().signal),
    );
    const byInputPath = new Map(
      assessed.map((target) => [target.inputPath, target]),
    );
    const targets: IExecuteTarget[] = [];
    const changedPaths: string[] = [];
    for (const { path, kind, method } of selected) {
      const current = byInputPath.get(path);
      const identity = facts.identities.get(path)!;
      if (
        current?.valid &&
        current.identity &&
        toComparable(current.path, this.platform) ===
          toComparable(path, this.platform) &&
        current.kind === kind &&
        current.method === method &&
        isSameIdentity(current.identity, identity)
      ) {
        targets.push({
          path,
          kind: kind!,
          method: method!,
          owner: current.owner,
          identity,
          measurement: facts.measurements.get(path)!,
          risk: current.risk,
        });
      } else {
        changedPaths.push(path);
      }
    }
    if (changedPaths.length > 0) {
      throw new AppException(
        409,
        'Selected targets changed since the preview',
        'TARGET_CHANGED',
        { paths: changedPaths },
      );
    }
    const riskChangedPaths = changedRiskPaths(
      new Map(selected.map(({ path, risk }) => [path, risk])),
      new Map(targets.map(({ path, risk }) => [path, risk])),
    );
    if (riskChangedPaths.length > 0) {
      throw new AppException(
        409,
        'Risk increased since the preview',
        'RISK_CHANGED',
        { paths: riskChangedPaths },
      );
    }
    const risk = assessSelectionRisk(
      targets.map(({ risk: targetRisk, measurement }) => ({
        risk: targetRisk,
        sizeBytes: measurement.sizeBytes,
      })),
    );
    validateConfirmation(
      risk,
      selectionConfirmText(targets, risk, this.platform),
      input,
    );
    return { targets, risk };
  }

  private async runOperation(
    operation: IFileOpsOperation,
    targets: readonly IExecuteTarget[],
    token: symbol,
  ): Promise<void> {
    const { operationId } = operation;
    const removed: string[] = [];
    const gone: string[] = [];
    let status: 'completed' | 'cancelled' | 'failed' = 'completed';
    const stopRequested = (): boolean => {
      if (operation.status !== 'stopping') return false;
      status = 'cancelled';
      markNotStarted(operation, null);
      return true;
    };
    try {
      const checkPaths = this.pathGuard.createOperationChecker();
      for (const [index, target] of targets.entries()) {
        if (stopRequested()) break;
        const result = operation.results[index];
        operation.currentPath = target.path;
        result.status = 'running';
        this.operations.update(operationId, operation);

        const refusal = await this.refusalBeforeDelete(
          target,
          removed,
          checkPaths,
        );
        // Lệnh dừng đến trong lúc kiểm: target này chưa bị đụng tới.
        if (stopRequested()) break;
        if (refusal !== null) {
          result.status = 'failed';
          result.errorCode = refusal;
        } else {
          const outcome = await deleteTarget(
            {
              path: target.path,
              kind: target.kind,
              apparentBytes: target.measurement.apparentBytes,
            },
            { rm: this.fs.remove, recycleBin: this.recycleBin },
          );
          result.status = outcome.status;
          if (outcome.status === 'success') {
            removed.push(target.path);
          } else {
            result.errorCode = outcome.errorCode;
            result.mayBePartial = outcome.mayBePartial;
          }
        }
        if (result.errorCode === 'TARGET_GONE') gone.push(target.path);
        this.operations.update(operationId, operation);

        try {
          await this.audit.append({
            operation: 'file-ops.delete',
            operationId,
            phase: 'result',
            targets: [target.path],
            method: target.method,
            risk: auditRisk(target.risk),
            result: result.status,
            errorCode: result.errorCode,
          });
        } catch {
          this.logger.error('File operation result audit failed');
          status = 'failed';
          markNotStarted(operation, 'AUDIT_WRITE_FAILED');
          break;
        }
      }
    } catch {
      // Lỗi fs/command line có thể chứa path riêng tư: chỉ log thông điệp cố định.
      this.logger.error('File operation failed');
      status = 'failed';
      markNotStarted(operation, null);
    } finally {
      this.finishOperation(operation, status, removed, gone, token);
    }
  }

  /** Kiểm lại ngay trước khi xoá; trả mã từ chối, hoặc null nếu được xoá. */
  private async refusalBeforeDelete(
    target: IExecuteTarget,
    removed: readonly string[],
    checkPaths: PathChecker,
  ): Promise<'TARGET_CHANGED' | 'TARGET_GONE' | null> {
    const api = pathApi(this.platform);
    const key = (path: string) => toComparable(path, this.platform);
    try {
      const check = (await checkPaths([target.path])).at(0);
      if (check?.allowed === false && check.code === 'NOT_FOUND') {
        return 'TARGET_GONE';
      }
      if (
        !check?.allowed ||
        check.path.isSymbolicLink ||
        key(check.path.realPath) !== key(target.path)
      ) {
        return 'TARGET_CHANGED';
      }
      let stats: IFileOpsStat;
      try {
        stats = await this.fs.files.lstat(target.path);
      } catch (error) {
        return isMissing(error) ? 'TARGET_GONE' : 'TARGET_CHANGED';
      }
      if (
        stats.isSymbolicLink() ||
        !isSameIdentity(statIdentity(stats), target.identity)
      ) {
        return 'TARGET_CHANGED';
      }
      if (target.kind === 'orphan_node_modules') {
        try {
          await this.fs.files.lstat(
            api.join(api.dirname(target.path), 'package.json'),
          );
          return 'TARGET_CHANGED';
        } catch (error) {
          return isMissing(error) ? null : 'TARGET_CHANGED';
        }
      }
      const manifest = api.join(target.owner!.path, 'package.json');
      // D12: manifest do chính operation này xoá thì dùng kết quả preflight.
      if (removed.some((path) => key(path) === key(manifest))) return null;
      const manifestStats = await this.fs.files.lstat(manifest);
      return manifestStats.isFile() && !manifestStats.isSymbolicLink()
        ? null
        : 'TARGET_CHANGED';
    } catch {
      return 'TARGET_CHANGED';
    }
  }

  private finishOperation(
    operation: IFileOpsOperation,
    status: 'completed' | 'cancelled' | 'failed',
    removed: readonly string[],
    gone: readonly string[],
    token: symbol,
  ): void {
    // Mỗi bước bọc riêng: một bước lỗi không được chặn gate.leave.
    const attempt = (step: () => void): void => {
      try {
        step();
      } catch {
        this.logger.error('File operation finalization failed');
      }
    };
    attempt(() => this.scanner.applyDeletions([...removed, ...gone]));
    attempt(() => this.diskUsage.clearCache());
    attempt(() => {
      operation.status = status;
      operation.currentPath = null;
      operation.finishedAt = new Date().toISOString();
      this.operations.update(operation.operationId, operation);
    });
    this.activeOperation = undefined;
    this.gate.leave(token);
  }
}

const auditRisk = ({ level, reasons }: IRisk): IAuditRecord['risk'] => ({
  level,
  codes: reasons.map(({ code }) => code),
});

const isMissing = (error: unknown): boolean => {
  const code = errorCode(error);
  return code === 'ENOENT' || code === 'ENOTDIR';
};

const statIdentity = (stats: IFileOpsStat): ITargetIdentity | null =>
  stats.isFile() || stats.isDirectory()
    ? {
        dev: stats.dev.toString(),
        ino: stats.ino.toString(),
        type: stats.isFile() ? 'file' : 'directory',
      }
    : null;

const isSameIdentity = (
  current: ITargetIdentity | null,
  expected: ITargetIdentity,
): boolean =>
  current?.dev === expected.dev &&
  current.ino === expected.ino &&
  current.type === expected.type;

function markNotStarted(
  operation: IFileOpsOperation,
  code: IFileOpsTargetResult['errorCode'],
): void {
  for (const result of operation.results) {
    if (result.status === 'pending' || result.status === 'running') {
      result.status = 'not_started';
      result.errorCode = code;
    }
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
