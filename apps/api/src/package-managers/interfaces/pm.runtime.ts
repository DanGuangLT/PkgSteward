import type {
  IPmContext,
  IPmJob,
  IPmVersions,
  PmReasonCode,
  PmWritableManager,
} from '@/package-managers/interfaces/pm.types';
import type {
  IRunnerFs,
  IRunnerFileHandle,
  IRunnerFileIdentity,
  IRunnerInputDeps,
  IRunnerTool,
} from '@/npm-runner/interfaces/npm-runner.types';
import type { IProjectFileStat } from '@/projects/interfaces/projects.types';
import type { IRegistryPackageMetadata } from '@/projects/interfaces/projects.runtime';
import type { IPmPinEdit } from '@/package-managers/pm-manifest';
import type { IRisk } from '@/core/risk/interfaces/risk.types';

export const PM_FS = Symbol('PM_FS');
export const PM_RUNTIME = Symbol('PM_RUNTIME');
export interface IPmFileStat extends IProjectFileStat {
  nlink: number;
}
export interface IPmReadHandle extends IRunnerFileHandle {
  stat(): Promise<IPmFileStat>;
}
export interface IPmWriteHandle {
  stat(): Promise<IPmFileStat>;
  /** Must write the entire buffer, not just a single possibly partial syscall. */
  write(bytes: Uint8Array): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}
export interface IPmFs extends IRunnerFs {
  lstat(path: string): Promise<IPmFileStat>;
  open(path: string): Promise<IPmReadHandle>;
  openExclusive(path: string, flags: 'wx'): Promise<IPmWriteHandle>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
}
export interface IPmProjectDeps extends IRunnerInputDeps {
  fs: IPmFs;
  uuid(): string;
}
/** Private snapshot, including bytes; counts against G3's retained-preview budget. */
export interface IPmProjectFacts {
  context: IPmContext;
  bytes: Buffer;
  manifestPath: string;
  manifestIdentity: IPmFileStat;
  identities: IRunnerFileIdentity[];
  inputHash: string;
  tools: Partial<Record<PmWritableManager, IRunnerTool>>;
  lastActivityAt: string | null;
}
/** Private retry state. Never serialize handles, identities or bytes to HTTP/audit. */
export interface IPmOwnedTemp {
  path: string;
  identity: IPmFileStat | null;
  handle: IPmWriteHandle | null;
}
export interface IPmCommitResult {
  mutationStarted: boolean;
  mayHaveChanged: boolean;
  fileCommitted: boolean;
  observedPin: string | null;
  cleanupRequired: boolean;
  failureCode: PmReasonCode | null;
  temp: IPmOwnedTemp | null;
}
export interface IPmCommitDeps extends IPmProjectDeps {
  /** Idempotent G3 local TTL/risk/consent check; called after temp IO and again
   * after the last FS await. No network, consumption or mutation here. */
  beforeRename(): Promise<void>;
}
export interface IPmCatalog extends IPmVersions {
  metadata: IRegistryPackageMetadata;
}
export interface IPmTargetProof {
  requestedVersion: string;
  targetVersion: string;
  /** Only relevant exact/tag/deprecation/support facts, never entire packument. */
  fingerprint: string;
}
export interface IPmRegistry {
  readCatalog(
    manager: IPmVersions['manager'],
    installedVersion: string | null,
    signal: AbortSignal,
  ): Promise<IPmCatalog>;
  resolveTarget(
    catalog: IPmCatalog,
    requested: string,
    installedVersion: string | null,
  ): IPmTargetProof;
}
export interface IPmAuditDetails {
  risk: IRisk;
  oldPin: string | null;
  targetPin: string;
  observedPin: string | null;
}
export interface IPmRuntime {
  /** New dependencies per activity: cancellation never leaks between jobs. */
  projectDeps(signal: AbortSignal): IPmProjectDeps;
  /** Context-only admission checks gate idle; G3 preflight uses projectDeps directly. */
  readProject(path: string, signal: AbortSignal): Promise<IPmProjectFacts>;
  commit(
    facts: IPmProjectFacts,
    edit: IPmPinEdit,
    signal: AbortSignal,
    beforeRename: () => Promise<void>,
  ): Promise<IPmCommitResult>;
  cleanupTemp(temp: IPmOwnedTemp): Promise<void>;
  registry: IPmRegistry;
  timeoutMs: number | undefined;
  gate: { tryEnter(): symbol | null; leave(token: symbol): void };
  readers: {
    hasRunningScan(): boolean;
    hasRunningMeasurement(): boolean;
    hasRunningPreview(): boolean;
    hasRunningAnalysis(): boolean;
  };
  /** Tries both invalidations; G3 separately clears its own retained previews. */
  invalidate(path: string): Promise<void>;
  audit: {
    write(
      job: Readonly<IPmJob>,
      phase: 'intent' | 'result',
      details: IPmAuditDetails,
      operation?: 'project-pin' | 'cancel',
    ): Promise<void>;
  };
  now(): Date;
  monotonicNow(): number;
  uuid(): string;
  setTimer(
    callback: () => void,
    milliseconds: number,
  ): ReturnType<typeof setTimeout>;
  clearTimer(timer: ReturnType<typeof setTimeout>): void;
}
