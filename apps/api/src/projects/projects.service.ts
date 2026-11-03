import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AppException,
  NotFoundException,
} from '@/common/exceptions/app.exception';
import {
  isSameOrInside,
  pathApi,
  toComparable,
} from '@/common/utils/path.util';
import type { IProjectsRuntime } from '@/projects/interfaces/projects.runtime';
import type { IProjectsService } from '@/projects/interfaces/projects.service.interface';
import type {
  AnalysisStatus,
  IProjectAnalysisJob,
  IProjectAnalysisStart,
  IProjectDetail,
  IProjectInput,
  ProjectAnalysisCode,
  ProjectScanSnapshot,
} from '@/projects/interfaces/projects.types';
import { readProjectInput } from '@/projects/project-input';
import { buildProjectInventory } from '@/projects/project-inventory';
import { compareProjectText } from '@/projects/project-lock-common';

export const PROJECT_FS = Symbol('PROJECT_FS');
export const PROJECT_RUNTIME = Symbol('PROJECT_RUNTIME');

interface IActiveAnalysis {
  job: IProjectAnalysisJob;
  input: IProjectInput;
  controller: AbortController;
  timer?: ReturnType<typeof setTimeout>;
}

@Injectable()
export class ProjectsService implements IProjectsService, OnModuleDestroy {
  private readonly logger = new Logger(ProjectsService.name);
  private current?: IActiveAnalysis;
  private closed = false;

  constructor(
    @Inject(PROJECT_RUNTIME) private readonly runtime: IProjectsRuntime,
  ) {}

  async detail(path: string): Promise<IProjectDetail> {
    this.assertOpen();
    const signal = new AbortController().signal;
    const input = await readProjectInput(
      path,
      this.runtime.lifecycle.getLatest(),
      signal,
      this.runtime.input,
    );
    const inventory = await buildProjectInventory(input, signal);
    const dependencies = [...input.manifest.dependencies].sort((a, b) =>
      compareProjectText(a.name, b.name),
    );
    const warnings = new Set([
      ...input.warningCodes,
      ...inventory.warningCodes,
    ]);
    if (dependencies.length > 2000) warnings.add('LIMIT_EXCEEDED');
    if (input.registryPolicy) warnings.add(input.registryPolicy);
    return structuredClone({
      path: input.path,
      requestPath: input.requestPath,
      name: input.manifest.name,
      version: input.manifest.version,
      manager: input.manager,
      packageManager: input.manifest.packageManager,
      lockfile: input.lock?.name ?? null,
      scanId: input.scanId,
      inputHash: input.inputHash,
      readAt: input.readAt,
      dependencies: dependencies.slice(0, 2000).map((dependency) => ({
        ...dependency,
        lockedVersions: inventory.direct.get(dependency.name) ?? [],
      })),
      scripts: input.manifest.scripts,
      warnings: [...warnings].sort(compareProjectText),
      diskUsage: await this.diskSummary(input, signal),
    });
  }

  async start({ path }: { path: string }): Promise<IProjectAnalysisStart> {
    this.assertOpen();
    const controller = new AbortController();
    const input = structuredClone(
      await readProjectInput(
        path,
        this.runtime.lifecycle.getLatest(),
        controller.signal,
        this.runtime.input,
      ),
    );
    this.assertOpen();
    const latest = this.runtime.lifecycle.getLatest();
    if (!this.isMember(input, latest)) {
      throw new AppException(
        409,
        'Project is not in the latest scan',
        'CONFLICT',
        { reason: 'PROJECT_NOT_SCANNED' },
      );
    }
    if (latest.scanId !== input.scanId) {
      throw new AppException(
        409,
        'Project input changed while reading',
        'CONFLICT',
        { reason: 'INPUT_CHANGED' },
      );
    }
    // Keep the gate check and slot reservation in one synchronous turn.
    this.runtime.lifecycle.assertIdle();
    if (this.current?.job.status === 'running') {
      const running = this.current.job;
      if (this.comparable(running.path) === this.comparable(input.path)) {
        return { jobId: running.jobId, status: running.status };
      }
      throw new AppException(
        409,
        'A project analysis is already running',
        'CONFLICT',
        {
          reason: 'ANALYSIS_RUNNING',
          jobId: running.jobId,
          path: running.requestPath,
        },
      );
    }
    const startedAt = this.runtime.lifecycle.now().toISOString();
    const job: IProjectAnalysisJob = {
      jobId: randomUUID(),
      status: 'running',
      path: input.path,
      requestPath: input.requestPath,
      scanId: input.scanId,
      inputHash: input.inputHash,
      phase: 'reading',
      partial: true,
      stale: false,
      startedAt,
      finishedAt: null,
      checkedAt: null,
      outdated: {
        state: 'pending',
        items: [],
        warningCodes: [],
        failureCode: null,
        checkedCount: 0,
        totalCount: null,
      },
      audit: {
        state: 'pending',
        items: [],
        warningCodes: [],
        failureCode: null,
        checkedCount: 0,
        totalCount: null,
      },
      warningCodes: [...input.warningCodes],
      failureCode: null,
    };
    const active: IActiveAnalysis = { job, input, controller };
    this.current = active;
    if (this.runtime.lifecycle.timeoutMs !== undefined) {
      active.timer = setTimeout(() => {
        this.finish(active, 'timed_out', 'TIMED_OUT');
      }, this.runtime.lifecycle.timeoutMs);
    }
    void this.run(active).catch(() => {
      if (!this.isRunning(active)) return;
      this.logger.error({
        jobId: active.job.jobId,
        phase: active.job.phase,
        code: 'INTERNAL_SERVER_ERROR',
      });
      this.finish(active, 'failed', 'INTERNAL_SERVER_ERROR');
    });
    return { jobId: job.jobId, status: job.status };
  }

  get(jobId: string): IProjectAnalysisJob {
    return structuredClone(this.requireJob(jobId).job);
  }

  cancel(jobId: string): IProjectAnalysisJob {
    const active = this.requireJob(jobId);
    this.finish(active, 'cancelled', 'CANCELLED');
    return structuredClone(active.job);
  }

  hasRunningAnalysis(): boolean {
    return this.current?.job.status === 'running';
  }

  invalidateAfterMutation(path: string): void {
    const active = this.current;
    if (!active || this.comparable(active.job.path) !== this.comparable(path)) {
      return;
    }
    active.job.stale = true;
    active.job.warningCodes = [
      ...new Set([...active.job.warningCodes, 'INPUT_CHANGED' as const]),
    ].sort(compareProjectText);
    this.finish(active, 'cancelled', 'INPUT_CHANGED');
  }

  onModuleDestroy(): void {
    this.closed = true;
    if (this.current) this.finish(this.current, 'cancelled', 'CANCELLED');
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new AppException(
        503,
        'Project analysis service is shutting down',
        'SERVICE_UNAVAILABLE',
      );
    }
  }

  private comparable(path: string): string {
    const platform = this.runtime.input.platform;
    return toComparable(pathApi(platform).resolve(path), platform);
  }

  private isMember(input: IProjectInput, scan: ProjectScanSnapshot): boolean {
    const canonical = this.comparable(input.path);
    const lexical = this.comparable(input.requestPath);
    return scan.projects.some((project) => {
      const path = this.comparable(project.path);
      return path === canonical || path === lexical;
    });
  }

  private requireJob(jobId: string): IActiveAnalysis {
    if (!this.current || this.current.job.jobId !== jobId) {
      throw new NotFoundException('Project analysis job', jobId);
    }
    return this.current;
  }

  private isRunning(active: IActiveAnalysis): boolean {
    return this.current === active && active.job.status === 'running';
  }

  private async diskSummary(
    input: IProjectInput,
    signal: AbortSignal,
  ): Promise<IProjectDetail['diskUsage']> {
    const { fs, platform } = this.runtime.input;
    const candidate = pathApi(platform).join(input.path, 'node_modules');
    try {
      const before = await fs.lstat(candidate);
      signal.throwIfAborted();
      if (!before.isDirectory?.() || before.isSymbolicLink()) return null;
      const canonical = await fs.realpath(candidate);
      signal.throwIfAborted();
      if (
        !isSameOrInside(canonical, input.path, platform) ||
        this.comparable(canonical) === this.comparable(input.path)
      )
        return null;
      const after = await fs.lstat(candidate);
      signal.throwIfAborted();
      if (
        !after.isDirectory?.() ||
        after.isSymbolicLink() ||
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.ctimeMs !== after.ctimeMs ||
        before.mtimeMs !== after.mtimeMs ||
        this.comparable(await fs.realpath(candidate)) !==
          this.comparable(canonical)
      )
        return null;
      signal.throwIfAborted();
      return structuredClone(
        this.runtime.lifecycle.peekCompletedSize(canonical),
      );
    } catch {
      signal.throwIfAborted();
      return null;
    }
  }

  private async run(active: IActiveAnalysis): Promise<void> {
    const signal = active.controller.signal;
    const result = await this.runtime.analyze(
      structuredClone(active.input),
      signal,
      {
        registry: this.runtime.registry,
        buildInventory: buildProjectInventory,
        now: () => this.runtime.lifecycle.now(),
        onSnapshot: (snapshot) => {
          if (!this.isRunning(active)) return;
          const update = structuredClone(snapshot);
          active.job = {
            ...active.job,
            outdated: update.outdated,
            audit: update.audit,
            warningCodes: update.warningCodes,
            phase: update.phase === 'done' ? 'validating' : update.phase,
            partial: true,
          };
        },
      },
    );
    if (!this.isRunning(active)) return;
    active.job = {
      ...active.job,
      ...structuredClone(result),
      phase: 'validating',
      partial: true,
    };
    let stale: boolean;
    let checkedAt: string | null = null;
    try {
      const checked = await readProjectInput(
        active.input.requestPath,
        this.runtime.lifecycle.getLatest(),
        signal,
        this.runtime.input,
      );
      if (!this.isRunning(active)) return;
      const latest = this.runtime.lifecycle.getLatest();
      stale =
        checked.inputHash !== active.input.inputHash ||
        checked.scanId !== active.input.scanId ||
        latest.scanId !== active.input.scanId ||
        this.comparable(checked.path) !== this.comparable(active.input.path) ||
        !this.isMember(active.input, latest);
      checkedAt = this.runtime.lifecycle.now().toISOString();
    } catch {
      if (!this.isRunning(active)) return;
      stale = true;
    }
    if (!this.isRunning(active)) return;
    active.job.checkedAt = checkedAt;
    active.job.stale = stale;
    active.job.partial =
      result.partial ||
      stale ||
      active.job.outdated.state !== 'complete' ||
      active.job.audit.state !== 'complete';
    this.finish(active, 'completed', stale ? 'INPUT_CHANGED' : null);
  }

  private finish(
    active: IActiveAnalysis,
    status: Exclude<AnalysisStatus, 'running'>,
    code: ProjectAnalysisCode | null,
  ): void {
    if (!this.isRunning(active)) return;
    active.job.status = status;
    active.job.phase = 'done';
    active.job.finishedAt = this.runtime.lifecycle.now().toISOString();
    active.job.failureCode = code;
    active.job.partial = status !== 'completed' || active.job.partial;
    if (code) {
      active.job.warningCodes = [
        ...new Set([...active.job.warningCodes, code]),
      ].sort(compareProjectText);
    }
    if (status !== 'completed') {
      active.job.checkedAt = null;
      for (const section of [active.job.outdated, active.job.audit]) {
        if (section.state === 'pending' || section.state === 'running') {
          section.state = section.items.length > 0 ? 'partial' : 'unavailable';
          section.failureCode = code;
          if (code && !section.warningCodes.includes(code)) {
            section.warningCodes.push(code);
          }
        }
      }
    }
    if (active.timer !== undefined) clearTimeout(active.timer);
    active.timer = undefined;
    active.controller.abort();
  }
}
