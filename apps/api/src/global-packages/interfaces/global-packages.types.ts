import type { IRisk } from '@/core/risk/interfaces/risk.types';
import {
  RUN_FAILURE_CODES,
  RUN_STATUSES,
  RUN_WARNING_CODES,
} from '@/npm-runner/interfaces/npm-runner.types';
import type {
  IRunLogPage,
  RunStatus,
} from '@/npm-runner/interfaces/npm-runner.types';

export const GLOBAL_MANAGERS = ['npm', 'pnpm', 'yarn'] as const;
export type GlobalManager = (typeof GLOBAL_MANAGERS)[number];
export const GLOBAL_DISABLED_MANAGERS: readonly GlobalManager[] = [];
export const GLOBAL_ACTIONS = ['remove', 'change', 'repair'] as const;
export type GlobalAction = (typeof GLOBAL_ACTIONS)[number];
export const GLOBAL_JOB_KINDS = [
  'inventory',
  'versions',
  'preview',
  'mutation',
] as const;
export type GlobalJobKind = (typeof GLOBAL_JOB_KINDS)[number];
export const GLOBAL_JOB_STATUSES = RUN_STATUSES;
export type GlobalJobStatus = RunStatus;
export const GLOBAL_REASON_CODES = [
  ...RUN_FAILURE_CODES,
  'LOCATION_AMBIGUOUS',
  'REGISTRY_CONFIG_UNSUPPORTED',
  'LINKED_PACKAGE',
  'PROTECTED_PACKAGE',
  'BIN_CONFLICT',
  'NO_VERSION_CHANGE',
  'PREVIEW_CHANGED',
  'PREVIEW_EXPIRED',
  'PREVIEW_CONSUMED',
  'REQUEST_MISMATCH',
  'LIMIT_EXCEEDED',
  'REGISTRY_UNAVAILABLE',
  'REGISTRY_INVALID_RESPONSE',
  'REGISTRY_NOT_FOUND',
  'REGISTRY_RATE_LIMITED',
  'REGISTRY_AUTH_REQUIRED',
  'INVENTORY_FAILED',
  'POSTCONDITION_FAILED',
  'MANAGER_DISABLED',
  'PNPM_GLOBAL_NOT_CONFIGURED',
  'YARN_GLOBAL_NOT_CONFIGURED',
  'GLOBAL_GROUP_UNSUPPORTED',
  'NPM_PREFIX_IS_NODE_DIR',
  'NPM_OVERLAY_ABSENT',
  'NPM_OVERLAY_NOT_BROKEN',
  'NPM_DELEGATION_UNVERIFIED',
  'TARGET_VERSION_UNSUPPORTED',
  'ENGINE_UNSUPPORTED',
  'FILE_IN_USE',
  'ACCESS_DENIED',
  'DELETE_FAILED',
  'PATH_TOO_LONG',
] as const;
export type GlobalReasonCode = (typeof GLOBAL_REASON_CODES)[number];
export const GLOBAL_WARNING_CODES = [
  ...RUN_WARNING_CODES,
  'MAJOR_VERSION_CHANGE',
  'VERSION_DOWNGRADE',
  'PRERELEASE_VERSION',
  'GLOBAL_CODE_EXECUTION',
  'GLOBAL_CONSUMERS_UNKNOWN',
  'PROCESS_ESCAPE_RESIDUAL',
  'TERMINAL_NPM_SWITCH',
  'PNPM_SHARED_GLOBAL_PROJECT',
  'YARN_SHARED_GLOBAL_PROJECT',
] as const;
export type GlobalWarningCode = (typeof GLOBAL_WARNING_CODES)[number];

export interface IGlobalActivityRequest {
  requestId: string;
}
export interface IGlobalVersionsRequest extends IGlobalActivityRequest {
  manager: GlobalManager;
  package: string;
}
export interface IGlobalPreviewRequest extends IGlobalVersionsRequest {
  action: GlobalAction;
  targetVersion?: string;
}
export interface IGlobalExecuteRequest extends IGlobalActivityRequest {
  previewId: string;
  confirm: true;
  acknowledgedRisks: string[];
  confirmText: string;
}
export interface IGlobalBin {
  name: string;
  target: string;
}
export interface IGlobalBinDiff {
  before: IGlobalBin[];
  after: IGlobalBin[];
  added: IGlobalBin[];
  removed: IGlobalBin[];
  replaced: { before: IGlobalBin; after: IGlobalBin }[];
}
export interface IGlobalPackage {
  name: string;
  version: string;
  bins: IGlobalBin[];
  status: 'manageable' | 'protected' | 'linked' | 'invalid';
  reason: GlobalReasonCode | null;
}
export interface IGlobalNpmVersion {
  bundledVersion: string;
  overlayVersion: string | null;
  terminalVersion: string | null;
  prefix: string;
  overlayState: 'absent' | 'present' | 'broken' | 'linked' | 'unsupported';
  delegation: 'verified' | 'unverified';
  reason: GlobalReasonCode | null;
}
export interface IGlobalNpmPreview {
  appVersion: string;
  terminalBefore: string | null;
  terminalAfter: string;
  prefix: string;
  repairTargets: string[];
}
export interface IGlobalNpmRepair {
  deleted: string[];
  failed: { path: string; code: GlobalReasonCode } | null;
  remaining: string[];
}
export interface IGlobalManagerInventory {
  manager: GlobalManager;
  version: string | null;
  available: boolean;
  reason: GlobalReasonCode | null;
  globalRoot: string | null;
  binDir: string | null;
  packages: IGlobalPackage[];
  npmVersion?: IGlobalNpmVersion;
}
export interface IGlobalSnapshot {
  revision: string;
  asOf: string;
  stale: boolean;
  managers: IGlobalManagerInventory[];
}
export interface IGlobalVersions {
  manager: GlobalManager;
  package: string;
  versions: string[];
  tags: Record<string, string>;
  deprecatedVersions: string[];
}
export interface IGlobalPreview {
  previewId: string;
  createdAt: string;
  expiresAt: string;
  manager: GlobalManager;
  managerVersion: string;
  action: GlobalAction;
  package: string;
  currentVersion: string | null;
  requestedVersion: string | null;
  targetVersion: string | null;
  globalRoot: string;
  binDir: string;
  bins: IGlobalBinDiff;
  warningCodes: GlobalWarningCode[];
  risk: IRisk;
  confirmText: string;
  npm?: IGlobalNpmPreview;
  sharedPackages?: { name: string; version: string; linked: boolean }[];
}
export interface IGlobalJobStart extends IGlobalActivityRequest {
  jobId: string;
  previewId: string | null;
  status: GlobalJobStatus;
}
export interface IGlobalJob extends IGlobalJobStart {
  kind: GlobalJobKind;
  manager: GlobalManager | null;
  managerVersion: string | null;
  action: GlobalAction | null;
  package: string | null;
  currentVersion: string | null;
  targetVersion: string | null;
  phase: 'preflight' | 'executing' | 'stopping' | 'finalizing' | 'done';
  startedAt: string;
  finishedAt: string | null;
  mutationSpawned: boolean;
  mayHaveChanged: boolean;
  exitCode: number | null;
  signal: string | null;
  stopReason: 'cancel' | 'timeout' | 'shutdown' | null;
  terminationVerified: boolean;
  gateHeld: boolean;
  auditWritten: boolean;
  refreshRequired: boolean;
  failureCode: GlobalReasonCode | null;
  warningCodes: GlobalWarningCode[];
  firstCursor: number;
  endCursor: number;
  droppedBytes: number;
  preview: IGlobalPreview | null;
  versions: IGlobalVersions | null;
  npmRepair?: IGlobalNpmRepair | null;
}
export type IGlobalLogPage = IRunLogPage;
