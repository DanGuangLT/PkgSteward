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
  IGlobalNpmVersion,
  IGlobalPreviewRequest,
  IGlobalSnapshot,
  IGlobalVersionsRequest,
} from '@/global-packages/interfaces/global-packages.types';
import {
  GLOBAL_DISABLED_MANAGERS,
  GLOBAL_MANAGERS,
  GLOBAL_REASON_CODES,
} from '@/global-packages/interfaces/global-packages.types';
import type {
  IGlobalPreviewFacts,
  IGlobalResolvedLocation,
  IGlobalRegistryInput,
  IGlobalPackageFacts,
  GlobalProbeSpawn,
  INpmSelfFacts,
  INpmPathFacts,
} from '@/global-packages/interfaces/global-packages.runtime';
import {
  AppException,
  NotFoundException,
} from '@/common/exceptions/app.exception';
import { GlobalJob } from '@/global-packages/execution/global-job';
import {
  assertGlobalPreviewUnchanged,
  createGlobalPreview,
  GlobalPreviewStore,
  snapshotGlobalPreviewFacts,
  validateGlobalConfirmation,
} from '@/global-packages/policy/global-preview';
import {
  assertGlobalDirectory,
  assertGlobalLocationsDistinct,
  discoverGlobalLocation,
} from '@/global-packages/discovery/global-location';
import { readGlobalInventory } from '@/global-packages/discovery/global-inventory';
import {
  readNpmSelfFacts,
  summarizeNpmVersion,
} from '@/global-packages/discovery/npm-overlay';
import {
  assertNpmOverlayMutable,
  assertNpmTarget,
  classifyNpmOverlay,
  npmTerminalVersion,
} from '@/global-packages/policy/npm-overlay';
import { deleteTarget } from '@/file-ops/deletion/file-deleter';
import type { IGlobalInventoryResult } from '@/global-packages/discovery/global-inventory';
import { assessPnpmGlobalRegistryPolicy } from '@/global-packages/config/pnpm-global-config';
import { assertPnpm10GlobalMutable } from '@/global-packages/policy/pnpm10-global-policy';
import { verifyPnpm10GlobalPostcondition } from '@/global-packages/policy/pnpm10-global-postcondition';
import { readPnpm10GlobalInventory } from '@/global-packages/discovery/pnpm10-global-inventory';
import { GlobalRegistry } from '@/global-packages/registry/global-registry';
import {
  assessGlobalRegistryPolicy,
  assertGlobalConfigUnchanged,
  GLOBAL_CONFIG_FILE_LIMIT,
  GLOBAL_CONFIG_TOTAL_LIMIT,
} from '@/global-packages/config/global-config';
import { assertGlobalPackageMutable } from '@/global-packages/policy/global-policy';
import { buildGlobalCommand } from '@/global-packages/execution/global-command';
import {
  readRunnerFile,
  revalidateRunnerTool,
  sameRunnerIdentity,
} from '@/npm-runner/toolchain/runner-tool';
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
const npmSelf = (request: IGlobalPreviewRequest): boolean =>
  request.manager === 'npm' && request.package === 'npm';
// Preview storage strips stat methods. Runner identities contain regular files,
// the package directory, and npm 10 compat ancestor directories; validated paths retain that distinction.
const retainedStat = (
  stat: INpmPathFacts['identity']['stat'],
  directory = false,
) => ({
  ...stat,
  isFile: () => !directory,
  isDirectory: () => directory,
  isSymbolicLink: () => false,
});
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
// Failed static pnpm discovery/inventory must not disable npm. Stop/termination
// signals are control flow; the caller also checks the activity signal first.
const isolatablePnpmError = (error: unknown): boolean =>
  !['CANCELLED', 'TIMED_OUT', 'SHUTDOWN', 'TERMINATION_UNCONFIRMED'].includes(
    reasonOf(error),
  ) &&
  !(
    error instanceof Error &&
    ['AbortError', 'TimeoutError'].includes(error.name)
  );
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
      active.facts = finalFacts;
      if (npmSelf(active.request!) && active.request!.action === 'repair') {
        await this.repairNpm(finalFacts.npm!, activity);
        return;
      }
      const command = buildGlobalCommand({
        location: active.location,
        environment: this.runtime.environment,
        action: active.request!.action,
        packageName: active.request!.package,
        exactVersion: finalFacts.target?.version ?? null,
        publicRegistry: finalFacts.registryChangeAllowed === true,
        pnpm10Inventory: finalFacts.pnpm10Inventory,
      });
      activity.checkpoint();
      // Launch only runs tools registered by a fresh verified resolution; static pnpm
      // discovery spawns nothing, so resolve here (launch rejects a changed identity).
      await this.runtime.resolveTool(active.request!.manager, activity.signal);
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
    if (
      kind === 'preview' &&
      'manager' in request &&
      request.manager === 'pnpm' &&
      'package' in request &&
      request.package === 'npm'
    )
      throw fail('PROTECTED_PACKAGE', 403);
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
        if (
          location.pnpm10?.missingDirectoryPaths.some(
            (path) =>
              win32.resolve(path).toLowerCase() ===
              win32.resolve(location.binDir).toLowerCase(),
          )
        )
          await readGlobalInventory(location, {
            fs: this.runtime.fs,
            environment: this.runtime.environment,
            signal: activity.signal,
            spawn: this.probeFor(activity),
          });
        const policy = await this.registryInput(
          location,
          { ...versions, action: 'change' },
          activity.signal,
        );
        activity.checkpoint();
        if (!this.registryDecision(location, policy).changeAllowed)
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
    if (GLOBAL_DISABLED_MANAGERS.includes(manager))
      throw fail('MANAGER_DISABLED');
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
    if (location.manager === 'pnpm')
      return await this.pnpmRegistryInput(location, request, signal);
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

  private registryDecision(
    location: IGlobalResolvedLocation,
    input: IGlobalRegistryInput,
  ) {
    return location.manager === 'pnpm'
      ? assessPnpmGlobalRegistryPolicy(input)
      : assessGlobalRegistryPolicy(input);
  }

  private async pnpmRegistryInput(
    location: IGlobalResolvedLocation,
    request: IGlobalPreviewRequest,
    signal: AbortSignal,
  ): Promise<IGlobalRegistryInput> {
    const config = location.pnpm10 ?? location.pnpm;
    if (!config) throw fail('CONFIG_UNSUPPORTED');
    const identities: IGlobalResolvedLocation['configIdentities'] = [];
    const budget = { remaining: GLOBAL_CONFIG_TOTAL_LIMIT };
    const paths = new Set([
      ...config.configIdentities.map((identity) => identity.file.path),
      ...config.missingConfigPaths,
    ]);
    for (const path of paths) {
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
            assertGlobalDirectory(
              win32.dirname(path),
              this.runtime.fs,
              signal,
              true,
            ),
        },
      );
      signal.throwIfAborted();
      if (data)
        identities.push({
          file: data.identity,
          sha256: createHash('sha256').update(data.bytes).digest('hex'),
        });
    }
    assertGlobalConfigUnchanged(config.configIdentities, identities);
    assertGlobalConfigUnchanged(location.configIdentities, identities);
    return {
      packageName: request.package,
      action: request.action,
      configs: [],
      // Discovery has already unioned every original file/environment source.
      environment: {},
      provenanceKnown: true,
      pnpmPolicies: [config.policy],
    };
  }

  private assertPnpmInventoryMutable(
    request: IGlobalPreviewRequest,
    location: IGlobalResolvedLocation,
    inventory: IGlobalInventoryResult,
    current: IGlobalPackageFacts,
  ): void {
    if (location.manager !== 'pnpm') return;
    if (location.pnpm10) {
      assertPnpm10GlobalMutable({
        location,
        inventory,
        packageName: request.package,
        action: request.action,
      });
      location.storeDir = inventory.pnpm10Inventory!.project.storeDir;
      return;
    }
    const group = current.pnpmGroup;
    if (!group || !location.pnpm || !inventory.pnpmInventory)
      throw fail('INVENTORY_FAILED');
    if (
      !inventory.ownershipComplete ||
      !inventory.pnpmInventory.ownershipComplete
    )
      throw fail('BIN_CONFLICT');
    if (
      inventory.packages.filter((row) => row.name === request.package)
        .length !== 1 ||
      inventory.facts.filter((facts) => facts.name === request.package)
        .length !== 1
    )
      throw fail('INVENTORY_FAILED');
    if (group.directDependencies.length !== 1)
      throw fail('GLOBAL_GROUP_UNSUPPORTED');
    if (group.directDependencies[0] !== request.package)
      throw fail('INVENTORY_FAILED');
    if (
      request.action === 'change' &&
      inventory.pnpmInventory.unreferencedDirectories.length
    )
      throw fail('INVENTORY_FAILED');
    // With default-store discovery, inventory proves the actual store from group metadata.
    if (location.storeDir === null) {
      location.storeDir = group.storeDir;
      location.pnpm = { ...location.pnpm, storeDir: group.storeDir };
    }
  }

  private readNpm(
    location: IGlobalResolvedLocation,
    signal: AbortSignal,
  ): Promise<INpmSelfFacts> {
    return readNpmSelfFacts(
      {
        location,
        nodeVersion: this.runtime.nodeVersion ?? process.versions.node,
        signal,
      },
      { fs: this.runtime.fs },
    );
  }

  private async readNpmFacts(
    request: IGlobalPreviewRequest,
    location: IGlobalResolvedLocation,
    activity: GlobalJob,
    finalCheck: boolean,
    locations: IGlobalResolvedLocation[],
  ): Promise<IGlobalPreviewFacts> {
    let npm = await this.readNpm(location, activity.signal);
    activity.checkpoint();
    assertNpmOverlayMutable(request.action, npm);
    const policy = await this.registryInput(location, request, activity.signal);
    activity.checkpoint();
    const registryChangeAllowed = this.registryDecision(
      location,
      policy,
    ).changeAllowed;
    if (request.action === 'change' && !registryChangeAllowed)
      throw fail('REGISTRY_CONFIG_UNSUPPORTED');
    const target =
      request.action === 'change'
        ? await this.registry.getTarget(
            { ...policy, manager: 'npm' },
            request.targetVersion!,
            activity.signal,
          )
        : null;
    activity.checkpoint();
    if (finalCheck) {
      await this.registryInput(location, request, activity.signal);
      npm = await this.readNpm(location, activity.signal);
      activity.checkpoint();
    }
    const classification = assertNpmOverlayMutable(request.action, npm);
    if (target)
      assertNpmTarget(
        target,
        npm.nodeVersion,
        npmTerminalVersion(npm, classification.state),
      );
    // The classifier is the single source, also used after final preview comparison.
    npm.repairTargets = classification.repairTargets;
    return snapshotGlobalPreviewFacts({
      location,
      current: npm.overlay?.package ?? null,
      target,
      binOwners: [],
      npm,
      registryChangeAllowed,
      locations,
    });
  }

  private async assertRepairTarget(
    npm: INpmSelfFacts,
    entry: INpmPathFacts,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      await assertGlobalDirectory(npm.prefixReal, this.runtime.fs, signal);
      await assertGlobalDirectory(
        win32.join(npm.prefixReal, 'node_modules'),
        this.runtime.fs,
        signal,
      );
      signal.throwIfAborted();
      const stat = await this.runtime.fs.lstat(entry.path);
      const real = await this.runtime.fs.realpath(entry.path);
      signal.throwIfAborted();
      if (
        stat.isSymbolicLink() ||
        entry.reparse ||
        win32.resolve(real).toLowerCase() !==
          win32.resolve(entry.path).toLowerCase() ||
        // Retired names carry a case-sensitive hash: the stored name must match exactly (G3-2).
        (win32.basename(entry.path).startsWith('.') &&
          win32.basename(real) !== win32.basename(entry.path))
      )
        throw fail('PREVIEW_CHANGED');
      if (entry.type === 'directory') {
        if (
          !stat.isDirectory?.() ||
          stat.isFile() ||
          stat.dev !== entry.identity.stat.dev ||
          stat.ino !== entry.identity.stat.ino
        )
          throw fail('PREVIEW_CHANGED');
      } else {
        const data = await readRunnerFile(
          entry.path,
          64 * 1024,
          this.runtime.fs,
          signal,
          'win32',
          {
            checkParent: () =>
              assertGlobalDirectory(
                win32.dirname(entry.path),
                this.runtime.fs,
                signal,
              ),
          },
        );
        signal.throwIfAborted();
        if (
          !data ||
          !sameRunnerIdentity(retainedStat(entry.identity.stat), stat) ||
          !sameRunnerIdentity(
            retainedStat(entry.identity.stat),
            data.identity.stat,
          ) ||
          createHash('sha256').update(data.bytes).digest('hex') !== entry.sha256
        )
          throw fail('PREVIEW_CHANGED');
      }
    } catch {
      signal.throwIfAborted();
      throw fail('PREVIEW_CHANGED');
    }
  }

  private async repairNpm(
    npm: INpmSelfFacts,
    activity: GlobalJob,
  ): Promise<void> {
    const targets = classifyNpmOverlay(npm).repairTargets;
    const progress = {
      deleted: [] as string[],
      failed: null as { path: string; code: GlobalReasonCode } | null,
      remaining: targets.map((entry) => entry.path),
    };
    activity.update({ npmRepair: progress });
    for (const entry of targets) {
      activity.checkpoint();
      try {
        await this.assertRepairTarget(npm, entry, activity.signal);
      } catch (error) {
        activity.checkpoint();
        progress.failed = { path: entry.path, code: reasonOf(error) };
        activity.update({ npmRepair: progress });
        throw error;
      }
      activity.checkpoint();
      await activity.executeInProcess(async () => {
        const outcome = await deleteTarget(
          { path: entry.path, kind: 'node_modules', apparentBytes: 0 },
          {
            rm: (path, options) => {
              if (!this.runtime.fs.rm)
                return Promise.reject(fail('DELETE_FAILED'));
              return this.runtime.fs.rm(path, options);
            },
            // kind node_modules always selects permanent rm; never recycle npm.
            recycleBin: {
              recycle: () => Promise.reject(fail('DELETE_FAILED')),
            },
          },
        );
        if (outcome.status === 'failed') {
          const code =
            outcome.errorCode === 'TARGET_GONE'
              ? 'PREVIEW_CHANGED'
              : outcome.errorCode;
          const reason =
            GLOBAL_REASON_CODES.find((reason) => reason === code) ??
            'DELETE_FAILED';
          progress.failed = { path: entry.path, code: reason };
          activity.update({ npmRepair: progress });
          throw fail(reason);
        }
        progress.deleted.push(entry.path);
        progress.remaining.shift();
        activity.update({ npmRepair: progress });
      });
    }
  }

  private npmInfrastructureUnchanged(
    before: INpmSelfFacts,
    after: INpmSelfFacts,
  ): boolean {
    const config = (
      a: INpmSelfFacts['prefixScript'],
      b: INpmSelfFacts['prefixScript'],
    ): boolean =>
      a === null || b === null
        ? a === b
        : a.file.path === b.file.path &&
          a.sha256 === b.sha256 &&
          sameRunnerIdentity(retainedStat(a.file.stat), b.file.stat);
    return (
      before.bundledVersion === after.bundledVersion &&
      before.nodeDir === after.nodeDir &&
      before.packageDir === after.packageDir &&
      config(before.prefixScript, after.prefixScript) &&
      before.nodeDirShims.length === after.nodeDirShims.length &&
      before.nodeDirShims.every((shim) => {
        const next = after.nodeDirShims.find(({ name }) => name === shim.name);
        if (!next) return false;
        const a = shim.entry,
          b = next.entry;
        // Any entry type must simply be unchanged: a linked or folder shim is what makes
        // delegation unverified, and restore/repair stay allowed then (G3-1).
        const fields =
          a?.type === 'directory'
            ? (['dev', 'ino'] as const)
            : (['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'] as const);
        return a === null || b === null
          ? a === b
          : a.path === b.path &&
              a.realPath === b.realPath &&
              a.type === b.type &&
              a.reparse === b.reparse &&
              a.sha256 === b.sha256 &&
              a.text === b.text &&
              fields.every(
                (field) => a.identity.stat[field] === b.identity.stat[field],
              );
      })
    );
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
        !(request.manager === 'npm' && isolatablePnpmError(error)) &&
        ![
          'TOOL_NOT_FOUND',
          'TOOL_VERSION_MISMATCH',
          'TOOL_LAYOUT_UNSUPPORTED',
          'MANAGER_DISABLED',
        ].includes(reasonOf(error))
      )
        throw error;
    }
    assertGlobalLocationsDistinct(locations);
    if (npmSelf(request))
      return await this.readNpmFacts(
        request,
        location,
        activity,
        finalCheck,
        locations,
      );
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
    this.assertPnpmInventoryMutable(request, location, inventory, current);
    const policy = await this.registryInput(location, request, activity.signal);
    activity.checkpoint();
    if (
      request.action === 'change' &&
      !this.registryDecision(location, policy).changeAllowed
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
      this.assertPnpmInventoryMutable(request, location, inventory, current);
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
      pnpmGroup: current.pnpmGroup,
      groupPackages: current.pnpmGroup
        ? inventory.facts.filter(
            (entry) =>
              entry.pnpmGroup?.installDir.toLowerCase() ===
              current.pnpmGroup!.installDir.toLowerCase(),
          )
        : undefined,
    });
    return snapshotGlobalPreviewFacts({
      location,
      current,
      target,
      binOwners: inventory.binOwners,
      registryChangeAllowed: this.registryDecision(location, policy)
        .changeAllowed,
      locations,
      pnpmInventory: inventory.pnpmInventory,
      pnpm10Inventory: inventory.pnpm10Inventory,
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
          ...(request.manager === 'pnpm'
            ? [
                'PNPM_GLOBAL_NOT_CONFIGURED',
                'GLOBAL_GROUP_UNSUPPORTED',
                'INVENTORY_FAILED',
              ]
            : []),
          ...(npmSelf(request)
            ? [
                'NPM_OVERLAY_ABSENT',
                'NPM_OVERLAY_NOT_BROKEN',
                'NPM_DELEGATION_UNVERIFIED',
                'NPM_PREFIX_IS_NODE_DIR',
                'TARGET_VERSION_UNSUPPORTED',
                'ENGINE_UNSUPPORTED',
                'NO_VERSION_CHANGE',
                'INVENTORY_FAILED',
                'INPUT_CHANGED',
              ]
            : []),
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
          !(manager === 'pnpm' && isolatablePnpmError(error)) &&
          ![
            'TOOL_NOT_FOUND',
            'TOOL_VERSION_MISMATCH',
            'TOOL_LAYOUT_UNSUPPORTED',
            'LOCATION_AMBIGUOUS',
            'CONFIG_UNSUPPORTED',
            'MANAGER_DISABLED',
            'PNPM_GLOBAL_NOT_CONFIGURED',
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
      // Unreadable npm-self facts hide the npm version card; they never fail the inventory (A14).
      let npmVersion: IGlobalNpmVersion | undefined;
      if (manager === 'npm')
        try {
          npmVersion = summarizeNpmVersion(
            await this.readNpm(location, activity.signal),
          );
        } catch (error) {
          activity.checkpoint();
          if (
            !['INVENTORY_FAILED', 'LOCATION_AMBIGUOUS'].includes(
              reasonOf(error),
            )
          )
            throw error;
        }
      activity.checkpoint();
      let result: IGlobalInventoryResult;
      try {
        result = await readGlobalInventory(location, {
          fs: this.runtime.fs,
          environment: this.runtime.environment,
          signal: activity.signal,
          spawn: this.probeFor(activity),
        });
      } catch (error) {
        activity.checkpoint();
        // Location overlap was checked above and must never be swallowed here.
        if (!isolatablePnpmError(error)) throw error;
        managers.push({
          manager,
          available: false,
          reason: reasonOf(error),
          version: null,
          globalRoot: null,
          binDir: null,
          packages: [],
          ...(npmVersion ? { npmVersion } : {}),
        });
        continue;
      }
      activity.checkpoint();
      managers.push({
        manager,
        version: location.tool.version,
        available: true,
        reason: null,
        globalRoot: location.globalRoot,
        binDir: location.binDir,
        packages: result.packages,
        ...(npmVersion ? { npmVersion } : {}),
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
      targets:
        request.action === 'repair' && active.facts?.npm
          ? classifyNpmOverlay(active.facts.npm).repairTargets.map(
              (entry) => entry.path,
            )
          : [
              active.location?.globalRoot ??
                active.facts?.location.globalRoot ??
                '',
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
    const changed = job.mutationSpawned || job.mayHaveChanged;
    if (changed && !active.invalidated) {
      if (this.snapshot) this.snapshot.stale = true;
      this.previews.clear();
      active.invalidated = true;
    }
    if (changed && job.terminationVerified && !active.refreshed) {
      try {
        if (active.request && npmSelf(active.request)) {
          const signal = new AbortController().signal;
          const npm = await this.readNpm(active.location!, signal);
          const classification = classifyNpmOverlay(npm);
          let bundledUnchanged = true;
          try {
            const tool = active.facts!.location.tool;
            const compatFiles = tool.npm10InstallCompat?.supported
              ? new Set(
                  [
                    tool.npm10InstallCompat.preload,
                    tool.npm10InstallCompat.source,
                    tool.npm10InstallCompat.loader,
                  ].map((file) => win32.resolve(file).toLowerCase()),
                )
              : null;
            await revalidateRunnerTool(
              {
                ...tool,
                identities: tool.identities.map((identity) => ({
                  ...identity,
                  stat: retainedStat(
                    identity.stat,
                    win32.resolve(identity.path).toLowerCase() ===
                      win32.resolve(tool.packageDir).toLowerCase(),
                  ),
                })),
                ...(compatFiles && tool.npm10InstallCompatIdentities
                  ? {
                      npm10InstallCompatIdentities:
                        tool.npm10InstallCompatIdentities.map((identity) => ({
                          ...identity,
                          stat: retainedStat(
                            identity.stat,
                            !compatFiles.has(
                              win32.resolve(identity.path).toLowerCase(),
                            ),
                          ),
                        })),
                    }
                  : {}),
              },
              this.runtime.fs,
              signal,
            );
          } catch {
            bundledUnchanged = false;
          }
          active.postcondition =
            bundledUnchanged &&
            this.npmInfrastructureUnchanged(active.facts!.npm!, npm) &&
            (active.request.action === 'change'
              ? classification.state === 'present' &&
                npm.overlay?.package?.version === active.facts?.target?.version
              : classification.state === 'absent');
          active.refreshed = true;
        } else {
          // Cleanup uses its own signal: cancelling mutation must not cancel verification.
          const deps = {
            fs: this.runtime.fs,
            environment: this.runtime.environment,
            signal: new AbortController().signal,
            spawn: this.probeFor(active.activity),
          };
          const result = active.location!.pnpm10
            ? await readPnpm10GlobalInventory(active.location!, deps, {
                allowMissingBinDir: true,
              })
            : await readGlobalInventory(active.location!, deps);
          const request = active.request!;
          if (active.location!.pnpm10) {
            active.postcondition = verifyPnpm10GlobalPostcondition(
              active.facts!,
              result,
              request,
            );
            active.refreshed = true;
          } else {
            if (
              request.manager === 'pnpm' &&
              (!result.ownershipComplete ||
                result.pnpmInventory?.ownershipComplete !== true)
            )
              throw fail('INVENTORY_FAILED');
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
                  (request.manager !== 'pnpm' ||
                    (result.packages.filter(
                      (entry) => entry.name === request.package,
                    ).length === 1 &&
                      result.facts.filter(
                        (entry) => entry.name === request.package,
                      ).length === 1)) &&
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
          }
        }
      } catch {
        /* Explicit cleanup retry only, never another mutation. */
      }
    }
    job.refreshRequired = changed && !active.refreshed;
    if (
      active.location?.pnpm10 &&
      changed &&
      active.refreshed &&
      !active.postcondition &&
      (job.status === 'completed' || job.failureCode === 'POSTCONDITION_FAILED')
    )
      job.refreshRequired = true;
    if (!job.terminationVerified) {
      job.status = 'termination_failed';
      job.failureCode = 'TERMINATION_UNCONFIRMED';
    } else if (job.status === 'completed' && job.refreshRequired) {
      job.status = 'failed';
      job.failureCode = active.location?.pnpm10
        ? 'POSTCONDITION_FAILED'
        : 'INVENTORY_FAILED';
    } else if (job.status === 'completed' && changed && !active.postcondition) {
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
      if (
        job.terminationVerified &&
        (!job.refreshRequired ||
          (active.location?.pnpm10 && active.refreshed)) &&
        job.auditWritten
      ) {
        this.runtime.gate.leave(active.token);
        job.gateHeld = false;
      }
    }
  }
}
