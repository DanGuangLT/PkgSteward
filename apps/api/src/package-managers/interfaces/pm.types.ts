import type { IRisk } from '@/core/risk/interfaces/risk.types';
import type { RunFailureCode } from '@/npm-runner/interfaces/npm-runner.types';

export const PM_MANAGERS = ['npm', 'pnpm', 'yarn'] as const;
export type PmManager = (typeof PM_MANAGERS)[number];
export const PM_WRITABLE_MANAGERS = ['npm', 'pnpm'] as const;
export type PmWritableManager = (typeof PM_WRITABLE_MANAGERS)[number];
export const PM_JOB_KINDS = ['versions', 'preview', 'mutation'] as const;
export type PmJobKind = (typeof PM_JOB_KINDS)[number];
export const PM_JOB_STATUSES = [
  'running',
  'completed',
  'failed',
  'cancelled',
  'timed_out',
] as const;
export type PmJobStatus = (typeof PM_JOB_STATUSES)[number];
export const PM_JOB_PHASES = [
  'preflight',
  'fetching',
  'writing',
  'finalizing',
  'done',
] as const;
export type PmJobPhase = (typeof PM_JOB_PHASES)[number];
export const PM_OWN_REASON_CODES = [
  'PIN_UNSUPPORTED',
  'TARGET_VERSION_UNSUPPORTED',
  'MANIFEST_WRITE_FAILED',
  'POSTCONDITION_FAILED',
  'TEMP_CLEANUP_FAILED',
  'PIN_HASH_REMOVED',
  'PIN_DOES_NOT_SWITCH_RUNNER',
  'DEV_ENGINES_NOT_MANAGED',
  'NO_VERSION_CHANGE',
  'PREVIEW_CHANGED',
  'PREVIEW_EXPIRED',
  'PREVIEW_CONSUMED',
  'REQUEST_MISMATCH',
  'SCAN_CHANGED',
  'LIMIT_EXCEEDED',
  'REGISTRY_UNAVAILABLE',
  'REGISTRY_INVALID_RESPONSE',
  'REGISTRY_NOT_FOUND',
  'REGISTRY_RATE_LIMITED',
  'REGISTRY_AUTH_REQUIRED',
  'ACCESS_DENIED',
  'FILE_IN_USE',
] as const;
// Reuse static runner reasons by type, excluding process/script/command-only codes.
export type PmReasonCode =
  | (typeof PM_OWN_REASON_CODES)[number]
  | Extract<
      RunFailureCode,
      | 'PROJECT_NOT_SCANNED'
      | 'INPUT_CHANGED'
      | 'WORKSPACE_LEAF'
      | 'UNSUPPORTED_MANAGER'
      | 'LOCKFILE_MISMATCH'
      | 'TOOL_NOT_FOUND'
      | 'TOOL_LAYOUT_UNSUPPORTED'
      | 'TOOL_VERSION_MISMATCH'
      | 'CONFIG_UNSUPPORTED'
      | 'READERS_RUNNING'
      | 'RUNNING'
      | 'CANCELLED'
      | 'TIMED_OUT'
      | 'SHUTDOWN'
      | 'AUDIT_WRITE_FAILED'
      | 'CACHE_INVALIDATION_FAILED'
      | 'INTERNAL_SERVER_ERROR'
    >;
export const PM_WARNING_CODES = [
  'PIN_HASH_REMOVED',
  'PIN_DOES_NOT_SWITCH_RUNNER',
  'DEV_ENGINES_NOT_MANAGED',
] as const;
export type PmWarningCode = (typeof PM_WARNING_CODES)[number];
export const PM_LIMITATIONS = [
  'EXTERNAL_EDIT_RACE',
  'PARENT_JUNCTION_RACE',
  'CRASH_TEMP_RESIDUAL',
] as const;
export type PmLimitation = (typeof PM_LIMITATIONS)[number];

export interface IPmProjectRequest {
  path: string;
}
export interface IPmVersionsRequest extends IPmProjectRequest {
  requestId: string;
  manager: PmManager;
}
export interface IPmPreviewRequest extends IPmVersionsRequest {
  manager: PmWritableManager;
  targetVersion: string;
}
export interface IPmExecuteRequest {
  requestId: string;
  previewId: string;
  confirm: true;
  acknowledgedRisks?: string[];
  confirmText?: string;
}
export interface IPmParsedPin {
  /** Manager declared by the current pin, including read-only Yarn. */
  manager: PmManager;
  /** Canonical exact version, including a readable current prerelease. */
  version: string;
  /** Declared hash algorithm and digest; never a verified signature. */
  hash: string | null;
}
export interface IPmPinState {
  /** Current string or bounded JSON representation of an inert non-string value. */
  rawPin: string | null;
  /** Indicates that display text was bounded; never used to reconstruct a write. */
  rawPinTruncated: boolean;
  /** Distinguishes an absent declaration from an unsupported value. */
  pinState: 'missing' | 'parsed' | 'unsupported';
  /** Parsed current declaration, null for missing/inert values. */
  parsedPin: IPmParsedPin | null;
  /** Why the current declaration cannot be edited. */
  pinReason: 'PIN_UNSUPPORTED' | null;
}
export interface IPmInstalledTool {
  /** Tool represented by this static observation. */
  manager: PmManager;
  /** Verified installed version; null does not assert absence. */
  version: string | null;
  /** Verified static tool path for display, never accepted from the client. */
  toolPath: string | null;
  /** Yarn is unsupported even when installed on the machine. */
  status: 'available' | 'unavailable' | 'unsupported';
  /** Bounded reason for unavailable/unsupported detection. */
  reason: PmReasonCode | null;
}
export interface IPmWorkspace {
  /** Leaf projects cannot receive a redirected pin write. */
  kind: 'standalone' | 'root' | 'leaf';
  /** Workspace root advice only; null for standalone projects. */
  root: string | null;
}
export interface IPmContext extends IPmPinState {
  /** Canonical scanned project root. */
  path: string;
  /** Human-readable project label. */
  projectName: string;
  /** Latest scan identity used to admit this project. */
  scanId: string;
  /** Time of the fresh static observation. */
  asOf: string;
  /** npm/pnpm observations and a read-only unsupported Yarn entry. */
  installed: IPmInstalledTool[];
  /** Distinct observed lockfile families, independent of the raw pin. */
  lockManagers: PmManager[];
  /** Workspace boundary and root advice. */
  workspace: IPmWorkspace;
  /** Presence blocks writes; the app does not manage devEngines. */
  devEnginesPresent: boolean;
  /** Project-wide safety blocker, if present. */
  reason: PmReasonCode | null;
  /** Declaration/runner and unmanaged-field notices. */
  warnings: PmWarningCode[];
}
export interface IPmVersion {
  /** Public canonical exact release. */
  version: string;
  /** Public deprecation membership; deprecated versions cannot be applied. */
  deprecated: boolean;
  /** Whether this release can be declared using the installed supported tool. */
  supported: boolean;
  /** Disabled reason for read-only/prerelease/major/deprecated entries. */
  reason: PmReasonCode | null;
}
export interface IPmVersions {
  /** Fixed public npm registry package: npm, pnpm, or Yarn Classic. */
  manager: PmManager;
  /** Semver-descending entries, including disabled releases. */
  versions: IPmVersion[];
  /** Public tag-to-exact-version mapping. */
  tags: Record<string, string>;
  /** Time of the catalog observation. */
  asOf: string;
  /** Stale catalogs are display-only and cannot prove an execute target. */
  stale: boolean;
}
export interface IPmFileEdit {
  /** Only this project manifest is affected. */
  file: 'package.json';
  /** Only the root declaration changes. */
  field: 'packageManager';
  /** Distinguishes a missing pin insertion from a token replacement. */
  operation: 'insert' | 'replace';
  /** Previous supported declaration, null if absent. */
  before: string | null;
  /** Plain new declaration without an old-version hash. */
  after: string;
}
export interface IPmPreview {
  /** Opaque server-retained preview identity. */
  previewId: string;
  /** Time the preview became ready. */
  createdAt: string;
  /** Five-minute preview expiry for display; server uses monotonic time. */
  expiresAt: string;
  /** Canonical target project root. */
  path: string;
  /** Project label displayed in confirmation. */
  projectName: string;
  /** Scan identity to be rechecked at execute. */
  scanId: string;
  /** Supported manager to declare. */
  manager: PmWritableManager;
  /** Current supported raw pin or null for insertion. */
  rawPin: string | null;
  /** Current pin version, distinct from the installed runner. */
  currentVersion: string | null;
  /** Original exact/tag selection. */
  requestedVersion: string;
  /** Freshly proven stable exact target. */
  targetVersion: string;
  /** Installed tool that the unchanged runner continues to execute. */
  installedRunnerVersion: string;
  /** Declaration-only edit, without download or activation. */
  method: 'manifest-pin';
  /** Public one-file summary; no private manifest bytes. */
  edit: IPmFileEdit;
  /** Hash removal and runner distinction notices. */
  warnings: PmWarningCode[];
  /** Accepted filesystem/editor/crash residuals to disclose. */
  limitations: PmLimitation[];
  /** Shared risk assessment driving acknowledgement controls. */
  risk: IRisk;
  /** Pin-only has no high-risk typed confirmation. */
  confirmText: null;
}
export interface IPmJobStart {
  /** Opaque job identity used by polling and cancellation. */
  jobId: string;
  /** Client-generated UUID for lost-response recovery. */
  requestId: string;
  /** Retained preview identity when relevant. */
  previewId: string | null;
  /** Job outcome; phase done marks settled finalization. */
  status: PmJobStatus;
}
export interface IPmJob extends IPmJobStart {
  /** Read activity or one project declaration mutation. */
  kind: PmJobKind;
  /** Canonical target root, also used for follow-project links. */
  path: string;
  /** Selected catalog/declaration manager. */
  manager: PmManager;
  /** Current no-process activity stage. */
  phase: PmJobPhase;
  /** Admission time. */
  startedAt: string;
  /** Settlement time, null while pending. */
  finishedAt: string | null;
  /** Cancellation was requested; does not assert an unchanged file. */
  cancelRequested: boolean;
  /** The write sequence began. */
  mutationStarted: boolean;
  /** Rename committed the manifest, even if later cleanup failed. */
  fileCommitted: boolean;
  /** A commit is possible, including ambiguous rename outcomes. */
  mayHaveChanged: boolean;
  /** Mutation exclusion remains held during pending finalization. */
  gateHeld: boolean;
  /** Required mutation result audit was persisted. */
  auditWritten: boolean;
  /** Context/cache invalidation still needs settlement. */
  refreshRequired: boolean;
  /** Only cleanup/finalization may be retried, never another write. */
  cleanupRequired: boolean;
  /** Bounded failure reason for localization. */
  failureCode: PmReasonCode | null;
  /** Public declaration notices. */
  warnings: PmWarningCode[];
  /** Ready preview result, null for other activities. */
  preview: IPmPreview | null;
  /** Catalog result, null for other activities. */
  versions: IPmVersions | null;
}
