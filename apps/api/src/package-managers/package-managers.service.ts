import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { NotFoundException } from '@/common/exceptions/app.exception';
import { PM_RUNTIME } from '@/package-managers/interfaces/pm.runtime';
import type {
  IPmAuditDetails,
  IPmOwnedTemp,
  IPmRuntime,
  IPmTargetProof,
} from '@/package-managers/interfaces/pm.runtime';
import type { IPackageManagersService } from '@/package-managers/interfaces/package-managers.service.interface';
import type {
  IPmContext,
  IPmExecuteRequest,
  IPmJob,
  IPmJobStart,
  IPmPreviewRequest,
  IPmVersionsRequest,
} from '@/package-managers/interfaces/pm.types';
import { PmJob, pmFailureReason } from '@/package-managers/pm-job';
import { readPmProject } from '@/package-managers/pm-project';
import { getPmRisk } from '@/package-managers/pm-policy';
import {
  PmPreviewStore,
  assertPmPreviewUnchanged,
  createPmPreview,
  refusePm,
  validatePmConfirmation,
} from '@/package-managers/pm-preview';

interface IActivePm {
  activity: PmJob;
  fingerprint: string;
  token: symbol | null;
  preflight: Promise<void> | null;
  temp: IPmOwnedTemp | null;
  invalidated: boolean;
  refreshed: boolean;
  audit: IPmAuditDetails | null;
  cancelRequested: boolean;
  cancelIntent: boolean;
  cancelResult: boolean;
}
// Property insertion order and omitted optional properties do not change a replay.
const fingerprint = (value: object): string =>
  JSON.stringify(value, (_key, item: unknown): unknown => {
    if (item !== null && typeof item === 'object' && !Array.isArray(item))
      return Object.fromEntries(
        Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
      );
    return item;
  });

@Injectable()
export class PackageManagersService
  implements IPackageManagersService, OnModuleDestroy
{
  private readonly previews: PmPreviewStore;
  private current: IActivePm | null = null;
  private closed = false;
  constructor(@Inject(PM_RUNTIME) private readonly runtime: IPmRuntime) {
    this.previews = new PmPreviewStore(runtime);
  }
  async getProject(path: string): Promise<IPmContext> {
    this.assertOpen();
    const facts = await this.runtime.readProject(
      path,
      new AbortController().signal,
    );
    return structuredClone(facts.context);
  }
  versions(input: IPmVersionsRequest): Promise<IPmJobStart> {
    return this.admit('versions', input);
  }
  preview(input: IPmPreviewRequest): Promise<IPmJobStart> {
    return this.admit('preview', input);
  }
  async execute(input: IPmExecuteRequest): Promise<IPmJobStart> {
    this.assertOpen();
    const request: IPmExecuteRequest = structuredClone({
      requestId: input.requestId,
      previewId: input.previewId,
      confirm: input.confirm,
      acknowledgedRisks: input.acknowledgedRisks,
      confirmText: input.confirmText,
    });
    const key = fingerprint({ kind: 'mutation', ...request });
    const replay = this.replay(request.requestId, key);
    if (replay) return await Promise.resolve(replay);
    this.assertSlot();
    const record = this.previews.get(request.previewId);
    validatePmConfirmation(record.preview, request);
    // Synchronous admission: no await (including registry/FS) precedes this lease.
    const token = this.runtime.gate.tryEnter();
    if (token === null) throw refusePm('RUNNING');
    let active: IActivePm;
    try {
      active = this.reserve(
        'mutation',
        request.requestId,
        key,
        record.preview.path,
        record.preview.manager,
        record.preview.previewId,
        token,
      );
      active.audit = {
        risk: record.preview.risk,
        oldPin: record.preview.rawPin,
        targetPin: record.edit.summary.after,
        observedPin: null,
      };
    } catch (error) {
      this.runtime.gate.leave(token);
      throw error;
    }
    const accepted = this.start(active);
    let ready!: () => void;
    let failed!: (error: unknown) => void;
    active.preflight = new Promise<void>((resolve, reject) => {
      ready = resolve;
      failed = reject;
    });
    void active.preflight.catch(() => undefined);
    active.activity.run(async (activity) => {
      try {
        this.assertReaders();
        const actual = await readPmProject(
          record.preview.path,
          this.runtime.projectDeps(activity.signal),
        );
        activity.checkpoint();
        const installed =
          actual.context.installed.find(
            (item) => item.manager === record.preview.manager,
          )?.version ?? null;
        activity.update({ phase: 'fetching' });
        const catalog = await this.runtime.registry.readCatalog(
          record.preview.manager,
          installed,
          activity.signal,
        );
        activity.checkpoint();
        let proof: IPmTargetProof;
        try {
          proof = this.runtime.registry.resolveTarget(
            catalog,
            record.preview.requestedVersion,
            installed,
          );
        } catch {
          throw refusePm('PREVIEW_CHANGED');
        }
        // Re-read after network: scan/inputs/tools/activity may have changed meanwhile.
        const fresh = await readPmProject(
          record.preview.path,
          this.runtime.projectDeps(activity.signal),
        );
        activity.checkpoint();
        this.assertReaders();
        assertPmPreviewUnchanged(
          record.preview,
          record.facts,
          record.proof,
          fresh,
          proof,
          this.runtime.now(),
        );
        const retained = this.previews.get(request.previewId);
        validatePmConfirmation(
          {
            ...retained.preview,
            risk: getPmRisk(fresh.lastActivityAt, this.runtime.now()),
          },
          request,
        );
        this.previews.consume(request.previewId);
        active.audit!.risk = getPmRisk(
          fresh.lastActivityAt,
          this.runtime.now(),
        );
      } catch (error) {
        if (activity.signal.aborted) ready();
        else {
          const reason = pmFailureReason(error);
          const changed = [
            'INPUT_CHANGED',
            'CONFIG_UNSUPPORTED',
            'WORKSPACE_LEAF',
            'LOCKFILE_MISMATCH',
            'TOOL_NOT_FOUND',
            'TOOL_LAYOUT_UNSUPPORTED',
            'TOOL_VERSION_MISMATCH',
            'PROJECT_NOT_SCANNED',
            'PIN_UNSUPPORTED',
          ].includes(reason);
          const refusal = changed
            ? refusePm('PREVIEW_CHANGED')
            : error instanceof NotFoundException
              ? refusePm('SCAN_CHANGED')
              : error;
          failed(refusal);
          throw refusal;
        }
        throw error;
      }
      ready();
      try {
        await this.runtime.audit.write(
          activity.snapshot(),
          'intent',
          active.audit!,
        );
      } catch {
        throw refusePm('AUDIT_WRITE_FAILED', 503);
      }
      activity.checkpoint();
      const localCheck = async () => {
        activity.checkpoint();
        this.previews.assertFresh(request.previewId);
        this.assertReaders();
        const fresh = await readPmProject(
          record.preview.path,
          this.runtime.projectDeps(activity.signal),
        );
        activity.checkpoint();
        this.previews.assertFresh(request.previewId);
        this.assertReaders();
        assertPmPreviewUnchanged(
          record.preview,
          record.facts,
          record.proof,
          fresh,
          record.proof,
          this.runtime.now(),
        );
        validatePmConfirmation(
          {
            ...record.preview,
            risk: getPmRisk(fresh.lastActivityAt, this.runtime.now()),
          },
          request,
        );
        active.audit!.risk = getPmRisk(
          fresh.lastActivityAt,
          this.runtime.now(),
        );
      };
      await localCheck();
      activity.checkpoint();
      activity.update({ phase: 'writing', mutationStarted: true });
      const outcome = await this.runtime.commit(
        record.facts,
        record.edit,
        activity.signal,
        async () => {
          await localCheck();
          // The writer is approaching its uninterruptible rename. While IO is
          // pending report uncertainty; its settled outcome replaces these flags.
          activity.update({ mayHaveChanged: true });
        },
      );
      // Do not checkpoint here: post-rename observation/cleanup is not cancellable.
      active.temp = outcome.temp;
      active.audit!.observedPin = outcome.observedPin;
      activity.update({
        mutationStarted: outcome.mutationStarted,
        fileCommitted: outcome.fileCommitted,
        mayHaveChanged: outcome.mayHaveChanged,
        cleanupRequired: outcome.cleanupRequired,
        failureCode: outcome.failureCode,
        warnings: record.preview.warnings,
      });
    });
    // A deadline can expire before PmJob invokes work at all. Its provisional
    // HTTP request must still settle; an earlier preflight rejection stays rejected.
    void active.activity.settled().then(ready);
    return await Promise.resolve(accepted);
  }
  async waitForPreflight(id: string): Promise<void> {
    await this.require(id).preflight;
  }
  getLatest(): IPmJob | null {
    return this.current?.activity.snapshot() ?? null;
  }
  getJob(id: string): IPmJob {
    return this.require(id).activity.snapshot();
  }
  async cancel(id: string): Promise<IPmJob> {
    const active = this.require(id);
    const job = active.activity.snapshot();
    if (job.phase !== 'done') {
      if (job.kind === 'mutation') active.cancelRequested = true;
      active.activity.stop('cancel');
    } else if (job.gateHeld || job.cleanupRequired) {
      if (job.kind === 'mutation') {
        active.cancelRequested = true;
        active.activity.update({ cancelRequested: true });
      }
      void active.activity.retryCleanup();
    }
    return await Promise.resolve(active.activity.snapshot());
  }
  async onModuleDestroy(): Promise<void> {
    this.closed = true;
    const active = this.current;
    if (!active) return;
    const job = active.activity.snapshot();
    if (job.phase === 'done' && !job.gateHeld && !job.cleanupRequired) return;
    if (job.phase !== 'done') active.activity.stop('shutdown');
    const work =
      job.phase === 'done'
        ? active.activity.retryCleanup()
        : active.activity.settled();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        work,
        new Promise<void>((resolve) => {
          timer = this.runtime.setTimer(resolve, 30_000);
        }),
      ]);
    } finally {
      if (timer !== undefined) this.runtime.clearTimer(timer);
    }
    // A shutdown deadline never releases ownership or asserts IO settlement.
  }
  private assertOpen(): void {
    if (this.closed) throw refusePm('SHUTDOWN', 503);
  }
  private assertSlot(): void {
    const job = this.current?.activity.snapshot();
    if (job && (job.phase !== 'done' || job.gateHeld || job.cleanupRequired))
      throw refusePm('RUNNING');
  }
  private assertReaders(): void {
    const readers = this.runtime.readers;
    if (
      readers.hasRunningScan() ||
      readers.hasRunningMeasurement() ||
      readers.hasRunningPreview() ||
      readers.hasRunningAnalysis()
    )
      throw refusePm('READERS_RUNNING');
  }
  private require(id: string): IActivePm {
    if (!this.current || this.current.activity.snapshot().jobId !== id)
      throw new NotFoundException('Package manager job', id);
    return this.current;
  }
  private replay(requestId: string, key: string): IPmJobStart | null {
    if (this.current?.activity.snapshot().requestId !== requestId) return null;
    if (this.current.fingerprint !== key) throw refusePm('REQUEST_MISMATCH');
    return this.start(this.current);
  }
  private start(active: IActivePm): IPmJobStart {
    const { jobId, requestId, previewId, status } = active.activity.snapshot();
    return { jobId, requestId, previewId, status };
  }
  private reserve(
    kind: IPmJob['kind'],
    requestId: string,
    key: string,
    path: string,
    manager: IPmJob['manager'],
    previewId: string | null,
    token: symbol | null,
  ): IActivePm {
    const activity = new PmJob(
      {
        kind,
        requestId,
        jobId: this.runtime.uuid(),
        path,
        manager,
        previewId,
        gateHeld: token !== null,
      },
      {
        now: () => this.runtime.now(),
        monotonicNow: () => this.runtime.monotonicNow(),
        timeoutMs: this.runtime.timeoutMs,
        setTimer: (fn, ms) => this.runtime.setTimer(fn, ms),
        clearTimer: (timer) => this.runtime.clearTimer(timer),
        finalize: (job, retry) => this.finalize(active, job, retry),
      },
    );
    const active: IActivePm = {
      activity,
      fingerprint: key,
      token,
      preflight: null,
      temp: null,
      invalidated: false,
      refreshed: false,
      audit: null,
      cancelRequested: false,
      cancelIntent: false,
      cancelResult: false,
    };
    this.current = active;
    return active;
  }
  private async admit(
    kind: 'versions' | 'preview',
    input: IPmVersionsRequest | IPmPreviewRequest,
  ): Promise<IPmJobStart> {
    this.assertOpen();
    const request = structuredClone(input);
    const key = fingerprint({ kind, ...request });
    const replay = this.replay(request.requestId, key);
    if (replay) return await Promise.resolve(replay);
    this.assertSlot();
    const active = this.reserve(
      kind,
      request.requestId,
      key,
      request.path,
      request.manager,
      kind === 'preview' ? this.runtime.uuid() : null,
      null,
    );
    const accepted = this.start(active);
    active.activity.run(async (activity) => {
      const facts = await this.runtime.readProject(
        request.path,
        activity.signal,
      );
      activity.checkpoint();
      activity.update({ path: facts.context.path, phase: 'fetching' });
      const installed =
        facts.context.installed.find((item) => item.manager === request.manager)
          ?.version ?? null;
      const catalog = await this.runtime.registry.readCatalog(
        request.manager,
        installed,
        activity.signal,
      );
      activity.checkpoint();
      if (kind === 'versions') {
        // Explicit projection: metadata is private, despite its structural subtype.
        activity.update({
          versions: {
            manager: catalog.manager,
            asOf: catalog.asOf,
            stale: catalog.stale,
            versions: catalog.versions,
            tags: catalog.tags,
          },
        });
      } else {
        const previewRequest = request as IPmPreviewRequest;
        const proof = this.runtime.registry.resolveTarget(
          catalog,
          previewRequest.targetVersion,
          installed,
        );
        const built = createPmPreview(
          accepted.previewId!,
          previewRequest,
          facts,
          proof,
          this.runtime.now(),
        );
        const preview = this.previews.put(
          built.preview,
          facts,
          proof,
          built.edit,
        );
        activity.update({ preview, warnings: preview.warnings });
      }
    });
    return await Promise.resolve(accepted);
  }
  private async cancelAudit(active: IActivePm, job: IPmJob): Promise<boolean> {
    if (!active.cancelRequested) return true;
    if (!active.cancelIntent) {
      try {
        await this.runtime.audit.write(job, 'intent', active.audit!, 'cancel');
        active.cancelIntent = true;
      } catch {
        /* Stop is already honored. Explicit cleanup will retry audit only. */
      }
    }
    try {
      await this.runtime.audit.write(job, 'result', active.audit!, 'cancel');
      active.cancelResult = true;
    } catch {
      active.cancelResult = false;
    }
    return active.cancelIntent && active.cancelResult;
  }
  private async finalize(
    active: IActivePm,
    job: IPmJob,
    retry: boolean,
  ): Promise<void> {
    if (job.kind !== 'mutation') return;
    // A possible commit invalidates even failed/cancelled/ambiguous outcomes.
    if (job.mayHaveChanged || job.fileCommitted) {
      if (!active.invalidated) {
        this.previews.invalidate();
        active.invalidated = true;
      }
      if (!active.refreshed) {
        try {
          await this.runtime.invalidate(job.path);
          active.refreshed = true;
        } catch {
          /* Try again only through explicit cleanup. */
        }
      }
      job.refreshRequired = !active.refreshed;
    }
    if (active.temp && retry) {
      try {
        await this.runtime.cleanupTemp(active.temp);
        active.temp = null;
      } catch {
        /* Retain wx-owned identity and handle; never retry the rename. */
      }
    }
    job.cleanupRequired = active.temp !== null || job.refreshRequired;
    if (job.cleanupRequired && job.status === 'completed') {
      job.status = 'failed';
      job.failureCode = job.refreshRequired
        ? 'CACHE_INVALIDATION_FAILED'
        : 'TEMP_CLEANUP_FAILED';
    }
    const cancelWritten = await this.cancelAudit(active, job);
    job.auditWritten = false;
    try {
      await this.runtime.audit.write(job, 'result', active.audit!);
      job.auditWritten = cancelWritten;
    } catch {
      if (job.status === 'completed') job.status = 'failed';
      job.failureCode ??= 'AUDIT_WRITE_FAILED';
    }
    // A cancellation arriving during awaited result audit still needs its audit pair.
    if (
      active.cancelRequested &&
      (!active.cancelIntent || !active.cancelResult)
    )
      job.auditWritten = false;
    job.cleanupRequired ||= !job.auditWritten;
    if (!job.cleanupRequired && active.token !== null) {
      this.runtime.gate.leave(active.token);
      active.token = null;
      job.gateHeld = false;
    }
  }
}
