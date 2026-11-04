import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { GLOBAL_PACKAGES_RUNTIME } from '@/global-packages/interfaces/global-packages.runtime';
import type { IGlobalServiceRuntime } from '@/global-packages/interfaces/global-packages.runtime';
import type { IGlobalPackagesService } from '@/global-packages/interfaces/global-packages.service.interface';
import type {
  GlobalJobKind,
  GlobalManager,
  GlobalReasonCode,
  IGlobalActivityRequest,
  IGlobalExecuteRequest,
  IGlobalJob,
  IGlobalJobStart,
  IGlobalLogPage,
  IGlobalPreviewRequest,
  IGlobalSnapshot,
  IGlobalVersionsRequest,
} from '@/global-packages/interfaces/global-packages.types';
import {
  GLOBAL_MANAGERS,
  GLOBAL_REASON_CODES,
} from '@/global-packages/interfaces/global-packages.types';
import type {
  IGlobalPreviewFacts,
  IGlobalResolvedLocation,
  IGlobalRegistryInput,
  GlobalProbeSpawn,
} from '@/global-packages/interfaces/global-packages.runtime';
import {
  AppException,
  NotFoundException,
} from '@/common/exceptions/app.exception';
import { GlobalJob } from '@/global-packages/global-job';
import {
  assertGlobalPreviewUnchanged,
  createGlobalPreview,
  GlobalPreviewStore,
  snapshotGlobalPreviewFacts,
  validateGlobalConfirmation,
} from '@/global-packages/global-preview';
import {
  assertGlobalDirectory,
  assertGlobalLocationsDistinct,
  discoverGlobalLocation,
} from '@/global-packages/global-location';
import { readGlobalInventory } from '@/global-packages/global-inventory';
import { GlobalRegistry } from '@/global-packages/global-registry';
import {
  assessGlobalRegistryPolicy,
  assertGlobalConfigUnchanged,
  GLOBAL_CONFIG_FILE_LIMIT,
  GLOBAL_CONFIG_TOTAL_LIMIT,
} from '@/global-packages/global-config';
import { assertGlobalPackageMutable } from '@/global-packages/global-policy';
import { buildGlobalCommand } from '@/global-packages/global-command';
import { readRunnerFile } from '@/npm-runner/runner-tool';
import { createHash } from 'node:crypto';
import { win32 } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { IAuditRecord } from '@/core/audit-log/interfaces/audit-log.types';

interface IActiveGlobal {
  activity: GlobalJob;
  fingerprint: string;
  token: symbol | null;
  location: IGlobalResolvedLocation | null;
  facts: IGlobalPreviewFacts | null;
  request: IGlobalPreviewRequest | null;
  consumed: boolean;
  invalidated: boolean;
  refreshed: boolean;
  postcondition: boolean;
  lastAudit: string | null;
  cancelRequested: boolean;
  cancelIntent: boolean;
  cancelResult: string | null;
  preflight: Promise<void> | null;
}

const fail = (reason: GlobalReasonCode, status = 409): AppException =>
  new AppException(
    status,
    'Global packages operation refused',
    status === 503
      ? 'SERVICE_UNAVAILABLE'
      : status === 403
        ? 'FORBIDDEN'
        : 'CONFLICT',
    { reason },
  );
const reasonOf = (error: unknown): GlobalReasonCode => {
  const details = error instanceof AppException ? error.details : undefined;
  const reason: unknown =
    details && typeof details === 'object' && 'reason' in details
      ? details.reason
      : undefined;
  return (
    GLOBAL_REASON_CODES.find((code) => code === reason) ??
    'INTERNAL_SERVER_ERROR'
  );
};
const auditState = (job: IGlobalJob): string =>
  JSON.stringify({
    status: job.status,
    exitCode: job.exitCode,
    signal: job.signal,
    mutationSpawned: job.mutationSpawned,
    terminationVerified: job.terminationVerified,
    mayHaveChanged: job.mayHaveChanged,
    refreshRequired: job.refreshRequired,
  });
const canonical = (value: unknown): string => {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item !== null && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, entry]) => [key, normalize(entry)]),
      );
    return item;
  };
  return JSON.stringify(normalize(value));
};

@Injectable()
export class GlobalPackagesService
  implements IGlobalPackagesService, OnModuleDestroy
{
  private readonly previews: GlobalPreviewStore;
  private readonly registry: GlobalRegistry;
  private current: IActiveGlobal | null = null;
  private snapshot: IGlobalSnapshot | null = null;
  private closed = false;

  constructor(
    @Inject(GLOBAL_PACKAGES_RUNTIME)
    private readonly runtime: IGlobalServiceRuntime,
  ) {
    this.previews = new GlobalPreviewStore({
      now: () => runtime.now(),
      monotonicNow: () => runtime.monotonicNow(),
    });
    this.registry = new GlobalRegistry(runtime.fetcher);
  }

  getSnapshot(): IGlobalSnapshot | null {
    return structuredClone(this.snapshot);
  }

  inventory(input: IGlobalActivityRequest): Promise<IGlobalJobStart> {
    return this.admit('inventory', input);
  }

  versions(input: IGlobalVersionsRequest): Promise<IGlobalJobStart> {
    return this.admit('versions', input);
  }

  preview(input: IGlobalPreviewRequest): Promise<IGlobalJobStart> {
    return this.admit('preview', input);
  }

  async execute(input: IGlobalExecuteRequest): Promise<IGlobalJobStart> {
    this.assertOpen();
    // Only identity and consent are accepted; all execution facts stay server-side.
    const request: IGlobalExecuteRequest = structuredClone({
      requestId: input.requestId,
      previewId: input.previewId,
      confirm: input.confirm,
      acknowledgedRisks: input.acknowledgedRisks,
      confirmText: input.confirmText,
    });
    const fingerprint = canonical({ kind: 'mutation', ...request });
    const replay = this.replay(request.requestId, fingerprint);
    if (replay) return await Promise.resolve(replay);
    this.assertSlot();
    if (
      this.current?.consumed &&
      this.current.activity.snapshot().previewId === request.previewId
    )
      throw fail('PREVIEW_CONSUMED');
    const record = this.previews.get(request.previewId);
    // backend 4.0: wrong consent fails the request itself (400), before the gate; rechecked after refresh.
    validateGlobalConfirmation(record.preview, request);
    this.assertWindows();
    const token = this.runtime.gate.tryEnter();
    if (token === null) throw this.running();
    let active: IActiveGlobal;
    try {
      const preview = record.preview;
      active = this.reserve(
        'mutation',
        request.requestId,
        fingerprint,
        token,
        preview.previewId,
        {
          requestId: request.requestId,
          manager: preview.manager,
          package: preview.package,
          action: preview.action,
          ...(preview.requestedVersion === null
            ? {}
            : { targetVersion: preview.requestedVersion }),
        },
      );
      active.activity.update({
        managerVersion: preview.managerVersion,
        currentVersion: preview.currentVersion,
        targetVersion: preview.targetVersion,
      });
      active.facts = record.facts;
      active.location = record.facts.location as IGlobalResolvedLocation;
    } catch (error) {
      this.runtime.gate.leave(token);
      throw error;
    }
    const accepted = this.startSnapshot(active.activity);
    let preflightReady!: () => void;
    let preflightFailed!: (error: unknown) => void;
    active.preflight = new Promise<void>((resolve, reject) => {
      preflightReady = resolve;
      preflightFailed = reject;
    });
    // Direct service callers may only poll; HTTP observes this rejection separately.
    void active.preflight.catch(() => undefined);
    active.activity.run(async (activity) => {
      let facts: IGlobalPreviewFacts;
      try {
        facts = await this.executeFacts(active.request!, activity);
        activity.checkpoint();
        assertGlobalPreviewUnchanged(record.facts, facts);
        // TTL and consumption are checked again after awaited preflight work.
        const ready = this.previews.get(request.previewId);
        validateGlobalConfirmation(ready.preview, request);
        this.previews.consume(request.previewId);
        active.consumed = true;
        active.facts = structuredClone(facts);
        active.location = facts.location as IGlobalResolvedLocation;
      } catch (error) {
        if (activity.signal.aborted) preflightReady();
        else {
          if (reasonOf(error) === 'PREVIEW_CHANGED') this.previews.clear();
          preflightFailed(error);
        }
        throw error;
      }
      preflightReady();
      try {
        await this.appendMutation(
          active,
          activity.snapshot(),
          'intent',
          'intent',
        );
      } catch {
        throw fail('AUDIT_WRITE_FAILED');
      }
      activity.checkpoint();
      const finalFacts = await this.executeFacts(
        active.request!,
        activity,
        true,
      );
      activity.checkpoint();
      assertGlobalPreviewUnchanged(record.facts, finalFacts);
      active.location = finalFacts.location as IGlobalResolvedLocation;
      const command = buildGlobalCommand({
        location: active.location,
        environment: this.runtime.environment,
        action: active.request!.action,
        packageName: active.request!.package,
        exactVersion: finalFacts.target?.version ?? null,
        publicRegistry: finalFacts.registryChangeAllowed === true,
      });
      activity.checkpoint();
      await activity.launch(command);
    });
    return await Promise.resolve(accepted);
  }

  async waitForPreflight(id: string): Promise<void> {
    const active = this.requireJob(id);
    await active.preflight;
  }

  getLatest(): IGlobalJob | null {
    return this.current?.activity.snapshot() ?? null;
  }

  getJob(id: string): IGlobalJob {
    return this.requireJob(id).activity.snapshot();
  }

  getLogs(id: string, cursor: number): IGlobalLogPage {
    return this.requireJob(id).activity.logs(cursor);
  }

  async cancel(id: string): Promise<IGlobalJob> {
    const active = this.requireJob(id);
    const job = active.activity.snapshot();
    if (job.phase !== 'done') {
      active.cancelRequested = true;
      // Stop never waits for audit storage.
      active.activity.stop('cancel');
    } else if (
      job.gateHeld ||
      !job.terminationVerified ||
      (active.cancelRequested &&
        (!active.cancelIntent || active.cancelResult === null))
    ) {
      active.cancelRequested = true;
      void active.activity.retryCleanup();
    }
    return await Promise.resolve(active.activity.snapshot());
  }

  async onModuleDestroy(): Promise<void> {
    this.closed = true;
    const active = this.current;
    if (!active) return;
    const job = active.activity.snapshot();
    if (job.phase === 'done' && !job.gateHeld && job.terminationVerified)
      return;
    let work: Promise<void>;
    if (job.phase === 'done') work = active.activity.retryCleanup();
    else {
      active.activity.stop('shutdown');
      work = active.activity.settled();
    }
    let timer: unknown;
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
  }

  private assertOpen(): void {
    if (this.closed) throw fail('SHUTDOWN', 503);
  }

  private assertWindows(): void {
    if (this.runtime.platform !== 'win32')
      throw new AppException(
        503,
        'Global packages require Windows',
        'SERVICE_UNAVAILABLE',
      );
  }

  private running(): AppException {
    const id = this.current?.activity.snapshot().jobId;
    return new AppException(
      409,
      'A global activity or mutation is active',
      'CONFLICT',
      {
        reason: 'RUNNING',
        ...(id ? { jobId: id } : {}),
      },
    );
  }

  private assertSlot(): void {
    const active = this.current;
    if (!active) return;
    const job = active.activity.snapshot();
    if (
      job.phase !== 'done' ||
      job.gateHeld ||
      !job.terminationVerified ||
      (active.cancelRequested &&
        (!active.cancelIntent || active.cancelResult === null))
    )
      throw this.running();
  }

  private replay(
    requestId: string,
    fingerprint: string,
  ): IGlobalJobStart | null {
    const active = this.current;
    if (!active || active.activity.snapshot().requestId !== requestId)
      return null;
    if (active.fingerprint !== fingerprint) throw fail('REQUEST_MISMATCH');
    return this.startSnapshot(active.activity);
  }

  private requireJob(id: string): IActiveGlobal {
    if (!this.current || this.current.activity.snapshot().jobId !== id)
      throw new NotFoundException('Global job', id);
    return this.current;
  }

  private startSnapshot(activity: GlobalJob): IGlobalJobStart {
    const { jobId, requestId, previewId, status } = activity.snapshot();
    return { jobId, requestId, previewId, status };
  }

  private reserve(
    kind: GlobalJobKind,
    requestId: string,
    fingerprint: string,
    token: symbol | null,
    previewId?: string,
    request?: IGlobalPreviewRequest,
  ): IActiveGlobal {
    const activity = new GlobalJob(
      {
        kind,
        requestId,
        jobId: this.runtime.uuid(),
        previewId,
        request,
        gateHeld: token !== null,
      },
      {
        now: () => this.runtime.now(),
        monotonicNow: () => this.runtime.monotonicNow(),
        setTimer: (callback, ms) => this.runtime.setTimer(callback, ms),
        clearTimer: (handle) => this.runtime.clearTimer(handle),
        timeoutMs: this.runtime.timeoutMs,
        launch: (command, callbacks) => this.runtime.launch(command, callbacks),
        finalize: (job) => this.finalize(active, job),
        verifyProbeTermination: () =>
          this.runtime.verifyProbeTermination?.() ?? Promise.resolve(false),
      },
    );
    const active: IActiveGlobal = {
      activity,
      fingerprint,
      token,
      location: null,
      facts: null,
      request: request ? structuredClone(request) : null,
      consumed: false,
      invalidated: false,
      refreshed: false,
      postcondition: false,
      lastAudit: null,
      cancelRequested: false,
      cancelIntent: false,
      cancelResult: null,
      preflight: null,
    };
    this.current = active;
    return active;
  }

  private async admit(
    kind: Exclude<GlobalJobKind, 'mutation'>,
    input:
      IGlobalActivityRequest | IGlobalVersionsRequest | IGlobalPreviewRequest,
  ): Promise<IGlobalJobStart> {
    this.assertOpen();
    const request = structuredClone(input);
    const fingerprint = canonical({ kind, ...request });
    const replay = this.replay(request.requestId, fingerprint);
    if (replay) return await Promise.resolve(replay);
    this.assertSlot();
    this.assertWindows();
    const previewId = kind === 'preview' ? this.runtime.uuid() : undefined;
    const active = this.reserve(
      kind,
      request.requestId,
      fingerprint,
      null,
      previewId,
      kind === 'preview' ? (request as IGlobalPreviewRequest) : undefined,
    );
    const accepted = this.startSnapshot(active.activity);
    active.activity.run(async (activity) => {
      if (kind === 'inventory') {
        await this.refreshSnapshot(activity);
      } else if (kind === 'versions') {
        const versions = request as IGlobalVersionsRequest;
        const location = await this.discover(versions.manager, activity);
        const policy = await this.registryInput(
          location,
          { ...versions, action: 'change' },
          activity.signal,
        );
        activity.checkpoint();
        if (!assessGlobalRegistryPolicy(policy).changeAllowed)
          throw fail('REGISTRY_CONFIG_UNSUPPORTED');
        const result = await this.registry.getVersions(
          { ...policy, manager: versions.manager },
          activity.signal,
        );
        activity.checkpoint();
        activity.update({
          manager: versions.manager,
          managerVersion: location.tool.version,
          package: versions.package,
          versions: result,
        });
      } else {
        const facts = await this.readFacts(active.request!, activity);
        activity.checkpoint();
        const preview = this.previews.put(
          createGlobalPreview(
            previewId!,
            active.request!,
            facts,
            this.runtime.now(),
          ),
          facts,
        );
        activity.update({
          preview,
          managerVersion: preview.managerVersion,
          currentVersion: preview.currentVersion,
          targetVersion: preview.targetVersion,
        });
      }
    });
    return await Promise.resolve(accepted);
  }

  private async discover(
    manager: GlobalManager,
    activity: GlobalJob,
  ): Promise<IGlobalResolvedLocation> {
    const location = await discoverGlobalLocation(manager, {
      fs: this.runtime.fs,
      environment: this.runtime.environment,
      execPath: this.runtime.execPath,
      paths: this.runtime.paths,
      scannedProjectPaths: this.runtime.scannedProjectPaths(),
      signal: activity.signal,
      spawn: this.probeFor(activity),
      makeDirectory: (path) => this.runtime.makeDirectory(path),
    });
    activity.checkpoint();
    return location;
  }

  private probeFor(activity: GlobalJob): GlobalProbeSpawn {
    return async (file, args, options) => {
      options.signal.throwIfAborted();
      try {
        const result = await this.runtime.probe(file, args, options);
        // Record uncertainty before an adapter can replace it with an abort error.
        if (!result.terminationVerified) activity.noteProbeUncertain();
        return result;
      } catch (error) {
        activity.noteProbeUncertain();
        throw error;
      }
    };
  }

  private async registryInput(
    location: IGlobalResolvedLocation,
    request: IGlobalPreviewRequest,
    signal: AbortSignal,
  ): Promise<IGlobalRegistryInput> {
    const configs: string[] = [];
    const identities: IGlobalResolvedLocation['configIdentities'] = [];
    const budget = { remaining: GLOBAL_CONFIG_TOTAL_LIMIT };
    const paths = new Map<string, string>(
      [location.userConfig, location.globalConfig].map((path) => [
        win32.resolve(path).toLowerCase(),
        path,
      ]),
    );
    for (const path of paths.values()) {
      const data = await readRunnerFile(
        path,
        GLOBAL_CONFIG_FILE_LIMIT,
        this.runtime.fs,
        signal,
        'win32',
        {
          optional: true,
          budget,
          checkParent: () =>
            assertGlobalDirectory(win32.dirname(path), this.runtime.fs, signal),
        },
      );
      signal.throwIfAborted();
      if (data) {
        configs.push(data.text);
        identities.push({
          file: data.identity,
          sha256: createHash('sha256').update(data.bytes).digest('hex'),
        });
      }
    }
    assertGlobalConfigUnchanged(location.configIdentities, identities);
    return {
      packageName: request.package,
      action: request.action,
      configs,
      environment: this.runtime.environment,
      provenanceKnown: true,
    };
  }

  private async readFacts(
    request: IGlobalPreviewRequest,
    activity: GlobalJob,
    finalCheck = false,
  ): Promise<IGlobalPreviewFacts> {
    const location = await this.discover(request.manager, activity);
    const locations = [location];
    try {
      locations.push(
        await this.discover(
          request.manager === 'npm' ? 'pnpm' : 'npm',
          activity,
        ),
      );
    } catch (error) {
      activity.checkpoint();
      if (
        ![
          'TOOL_NOT_FOUND',
          'TOOL_VERSION_MISMATCH',
          'TOOL_LAYOUT_UNSUPPORTED',
        ].includes(reasonOf(error))
      )
        throw error;
    }
    assertGlobalLocationsDistinct(locations);
    let inventory = await readGlobalInventory(location, {
      fs: this.runtime.fs,
      environment: this.runtime.environment,
      signal: activity.signal,
      spawn: this.probeFor(activity),
    });
    activity.checkpoint();
    let row = inventory.packages.find(
      (entry) => entry.name === request.package,
    );
    let current = inventory.facts.find(
      (entry) => entry.name === request.package,
    );
    if (!row || !current) throw fail(row?.reason ?? 'INVENTORY_FAILED');
    if (row.status !== 'manageable')
      throw fail(row.reason ?? 'PROTECTED_PACKAGE', 403);
    const policy = await this.registryInput(location, request, activity.signal);
    activity.checkpoint();
    if (
      request.action === 'change' &&
      !assessGlobalRegistryPolicy(policy).changeAllowed
    )
      throw fail('REGISTRY_CONFIG_UNSUPPORTED');
    const target =
      request.action === 'change'
        ? await this.registry.getTarget(
            { ...policy, manager: request.manager },
            request.targetVersion!,
            activity.signal,
          )
        : null;
    activity.checkpoint();
    if (finalCheck) {
      await this.registryInput(location, request, activity.signal);
      activity.checkpoint();
      inventory = await readGlobalInventory(location, {
        fs: this.runtime.fs,
        environment: this.runtime.environment,
        signal: activity.signal,
        spawn: this.probeFor(activity),
      });
      activity.checkpoint();
      row = inventory.packages.find((entry) => entry.name === request.package);
      current = inventory.facts.find((entry) => entry.name === request.package);
      if (!row || !current || row.status !== 'manageable')
        throw fail('PREVIEW_CHANGED');
    }
    assertGlobalPackageMutable({
      packageName: request.package,
      packageRoot: current.packageRoot,
      linked: false,
      currentBins: current.bins,
      targetBins: target?.bins ?? [],
      binOwners: inventory.binOwners,
      ownershipComplete: inventory.ownershipComplete,
      protectedPaths: location.protectedPaths,
    });
    return snapshotGlobalPreviewFacts({
      location,
      current,
      target,
      binOwners: inventory.binOwners,
      registryChangeAllowed: assessGlobalRegistryPolicy(policy).changeAllowed,
      locations,
    });
  }

  private async executeFacts(
    request: IGlobalPreviewRequest,
    activity: GlobalJob,
    finalCheck = false,
  ): Promise<IGlobalPreviewFacts> {
    try {
      return await this.readFacts(request, activity, finalCheck);
    } catch (error) {
      if (
        [
          'PROTECTED_PACKAGE',
          'BIN_CONFLICT',
          'LINKED_PACKAGE',
          'REGISTRY_CONFIG_UNSUPPORTED',
          'LOCATION_AMBIGUOUS',
          'CONFIG_UNSUPPORTED',
          'TOOL_VERSION_MISMATCH',
          'TOOL_LAYOUT_UNSUPPORTED',
        ].includes(reasonOf(error))
      )
        throw fail('PREVIEW_CHANGED');
      throw error;
    }
  }

  private async refreshSnapshot(activity: GlobalJob): Promise<void> {
    const managers: IGlobalSnapshot['managers'] = [];
    const locations: IGlobalResolvedLocation[] = [];
    for (const manager of GLOBAL_MANAGERS) {
      let location: IGlobalResolvedLocation;
      try {
        location = await this.discover(manager, activity);
      } catch (error) {
        activity.checkpoint();
        const reason = reasonOf(error);
        if (
          ![
            'TOOL_NOT_FOUND',
            'TOOL_VERSION_MISMATCH',
            'TOOL_LAYOUT_UNSUPPORTED',
            'LOCATION_AMBIGUOUS',
            'CONFIG_UNSUPPORTED',
          ].includes(reason)
        )
          throw error;
        managers.push({
          manager,
          available: false,
          reason,
          version: null,
          globalRoot: null,
          binDir: null,
          packages: [],
        });
        continue;
      }
      locations.push(location);
      assertGlobalLocationsDistinct(locations);
      const result = await readGlobalInventory(location, {
        fs: this.runtime.fs,
        environment: this.runtime.environment,
        signal: activity.signal,
        spawn: this.probeFor(activity),
      });
      activity.checkpoint();
      managers.push({
        manager,
        version: location.tool.version,
        available: true,
        reason: null,
        globalRoot: location.globalRoot,
        binDir: location.binDir,
        packages: result.packages,
      });
    }
    this.snapshot = structuredClone({
      revision: this.runtime.uuid(),
      asOf: this.runtime.now().toISOString(),
      managers,
      stale: false,
    });
  }

  private appendMutation(
    active: IActiveGlobal,
    job: IGlobalJob,
    phase: IAuditRecord['phase'],
    result: string,
  ): Promise<void> {
    const request = active.request!;
    return this.runtime.audit.append({
      operation: `global-packages.${request.action}`,
      operationId: job.jobId,
      phase,
      targets: [
        active.location?.globalRoot ?? active.facts?.location.globalRoot ?? '',
        request.package,
      ],
      method: `${request.manager}:${request.action}`,
      risk: { level: 'high', codes: ['MACHINE_WIDE'] },
      result,
    });
  }

  private async cancelAudit(
    active: IActiveGlobal,
    job: IGlobalJob,
  ): Promise<boolean> {
    if (!active.cancelRequested) return true;
    const base = {
      operation: 'global-packages.cancel',
      operationId: job.jobId,
      targets: [job.jobId],
      method: `${job.manager ?? 'global'}:cancel`,
      risk: { level: 'high' as const, codes: ['MACHINE_WIDE' as const] },
    };
    if (!active.cancelIntent) {
      try {
        await this.runtime.audit.append({
          ...base,
          phase: 'intent',
          result: 'intent',
        });
        active.cancelIntent = true;
      } catch {
        /* Stop has already been requested; retain cleanup ownership. */
      }
    }
    const result = auditState(job);
    if (active.cancelResult !== result) {
      try {
        await this.runtime.audit.append({ ...base, phase: 'result', result });
        active.cancelResult = result;
      } catch {
        active.cancelResult = null;
      }
    }
    return active.cancelIntent && active.cancelResult === result;
  }

  private async finalize(
    active: IActiveGlobal,
    job: IGlobalJob,
  ): Promise<void> {
    if (job.mutationSpawned && !active.invalidated) {
      if (this.snapshot) this.snapshot.stale = true;
      this.previews.clear();
      active.invalidated = true;
    }
    if (job.mutationSpawned && job.terminationVerified && !active.refreshed) {
      try {
        // Cleanup uses its own signal: cancelling mutation must not cancel verification.
        const result = await readGlobalInventory(active.location!, {
          fs: this.runtime.fs,
          environment: this.runtime.environment,
          signal: new AbortController().signal,
          spawn: this.probeFor(active.activity),
        });
        const request = active.request!;
        const row = result.packages.find(
          (entry) => entry.name === request.package,
        );
        const facts = result.facts.find(
          (entry) => entry.name === request.package,
        );
        const bins = (value: readonly { name: string; target: string }[]) =>
          [...value].sort((a, b) => a.name.localeCompare(b.name));
        active.postcondition =
          request.action === 'remove'
            ? !row && !facts
            : !!row &&
              !!facts &&
              row.status === 'manageable' &&
              row.version === active.facts?.target?.version &&
              facts.version === active.facts?.target?.version &&
              isDeepStrictEqual(
                bins(row.bins),
                bins(active.facts?.target?.bins ?? []),
              ) &&
              isDeepStrictEqual(
                bins(facts.bins),
                bins(active.facts?.target?.bins ?? []),
              );
        active.refreshed = true;
      } catch {
        /* Explicit cleanup retry only, never another mutation. */
      }
    }
    job.refreshRequired = job.mutationSpawned && !active.refreshed;
    if (!job.terminationVerified) {
      job.status = 'termination_failed';
      job.failureCode = 'TERMINATION_UNCONFIRMED';
    } else if (job.status === 'completed' && job.refreshRequired) {
      job.status = 'failed';
      job.failureCode = 'INVENTORY_FAILED';
    } else if (
      job.status === 'completed' &&
      job.mutationSpawned &&
      !active.postcondition
    ) {
      job.status = 'failed';
      job.failureCode = 'POSTCONDITION_FAILED';
    }
    const cancelWritten = await this.cancelAudit(active, job);
    if (active.token === null && active.cancelRequested)
      job.auditWritten = cancelWritten;
    if (active.token !== null) {
      const result = auditState(job);
      job.auditWritten = false;
      try {
        if (active.lastAudit !== result)
          await this.appendMutation(active, job, 'result', result);
        active.lastAudit = result;
        job.auditWritten = cancelWritten;
      } catch {
        job.failureCode = 'AUDIT_WRITE_FAILED';
        if (job.status === 'completed') job.status = 'failed';
      }
      if (job.terminationVerified && !job.refreshRequired && job.auditWritten) {
        this.runtime.gate.leave(active.token);
        job.gateHeld = false;
      }
    }
  }
}
