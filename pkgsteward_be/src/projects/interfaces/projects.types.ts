import type { PathPlatform } from '@/common/utils/path.util';
import type { IScanResult } from '@/scanner/interfaces/scanner.types';

export type ProjectManager = 'npm' | 'pnpm' | 'yarn' | 'unknown' | 'ambiguous';
export type AnalysisStatus =
  'running' | 'completed' | 'cancelled' | 'timed_out' | 'failed';
export type AnalysisSectionState =
  'pending' | 'running' | 'complete' | 'partial' | 'unavailable';
export type AnalysisPhase =
  'reading' | 'outdated' | 'audit' | 'validating' | 'done';
export type DependencyGroup =
  | 'dependencies'
  | 'devDependencies'
  | 'optionalDependencies'
  | 'peerDependencies';
export type ProjectAnalysisCode =
  | 'INPUT_CHANGED'
  | 'PROJECT_NOT_SCANNED'
  | 'CANCELLED'
  | 'TIMED_OUT'
  | 'UNREADABLE_INPUT'
  | 'INVALID_LOCKFILE'
  | 'NO_LOCKFILE'
  | 'UNSUPPORTED_LOCKFILE'
  | 'LOCKFILE_MISMATCH'
  | 'UNSUPPORTED_MANAGER'
  | 'UNSUPPORTED_SPEC'
  | 'REGISTRY_CONFIG_UNSUPPORTED'
  | 'LIMIT_EXCEEDED'
  | 'REGISTRY_AUTH_REQUIRED'
  | 'REGISTRY_RATE_LIMITED'
  | 'REGISTRY_UNAVAILABLE'
  | 'PACKAGE_NOT_FOUND'
  | 'INVALID_REGISTRY_RESPONSE'
  | 'INTERNAL_SERVER_ERROR';

export interface IDependencyDeclaration {
  group: DependencyGroup;
  spec: string;
}
export interface IManifestDependency {
  name: string;
  declarations: IDependencyDeclaration[];
}
export interface IProjectDependency extends IManifestDependency {
  lockedVersions: string[];
}
export interface IProjectScript {
  name: string;
  command: string;
}
export interface IManifestInput {
  name: string | null;
  version: string | null;
  packageManager: string | null;
  dependencies: IManifestDependency[];
  scripts: IProjectScript[];
}
export interface IProjectDetail {
  path: string;
  requestPath: string;
  name: string | null;
  version: string | null;
  manager: ProjectManager;
  packageManager: string | null;
  lockfile: string | null;
  scanId: string;
  inputHash: string;
  readAt: string;
  dependencies: IProjectDependency[];
  scripts: IProjectScript[];
  warnings: ProjectAnalysisCode[];
  diskUsage: { sizeBytes: number; measuredAt: string } | null;
}
export interface IProjectOutdated {
  name: string;
  registryName: string;
  lockedVersions: string[];
  wanted: string | null;
  latest: string | null;
  behindWanted: boolean | null;
  behindLatest: boolean | null;
  warning: ProjectAnalysisCode | null;
}
export interface IProjectAdvisory {
  id: string;
  name: string;
  title: string;
  url: string | null;
  severity: 'info' | 'low' | 'moderate' | 'high' | 'critical' | 'unknown';
  range: string;
  affectedVersions: string[];
  direct: boolean;
}
export interface IAnalysisSection<T> {
  state: AnalysisSectionState;
  items: T[];
  warningCodes: ProjectAnalysisCode[];
  failureCode: ProjectAnalysisCode | null;
  checkedCount: number;
  totalCount: number | null;
}
export interface IProjectAnalysisStart {
  jobId: string;
  status: AnalysisStatus;
}
export interface IProjectAnalysisJob extends IProjectAnalysisStart {
  path: string;
  requestPath: string;
  scanId: string;
  inputHash: string;
  phase: AnalysisPhase;
  partial: boolean;
  stale: boolean;
  startedAt: string;
  finishedAt: string | null;
  checkedAt: string | null;
  outdated: IAnalysisSection<IProjectOutdated>;
  audit: IAnalysisSection<IProjectAdvisory>;
  warningCodes: ProjectAnalysisCode[];
  failureCode: ProjectAnalysisCode | null;
}
export interface IAnalysisResult {
  outdated: IAnalysisSection<IProjectOutdated>;
  audit: IAnalysisSection<IProjectAdvisory>;
  partial: boolean;
  warningCodes: ProjectAnalysisCode[];
}
export type ProjectLockName =
  'package-lock.json' | 'npm-shrinkwrap.json' | 'pnpm-lock.yaml' | 'yarn.lock';
export interface IProjectInput {
  path: string;
  requestPath: string;
  scanId: string;
  inputHash: string;
  readAt: string;
  manifest: IManifestInput;
  manager: ProjectManager;
  lock: { name: ProjectLockName; text: string } | null;
  registryPolicy: 'REGISTRY_CONFIG_UNSUPPORTED' | null;
  warningCodes: ProjectAnalysisCode[];
}
export interface ILockPackage {
  name: string;
  version: string;
  direct: boolean;
}
export interface ILockInventory {
  coverage: 'complete' | 'partial' | 'unavailable';
  direct: Map<string, string[]>;
  packages: ILockPackage[];
  warningCodes: ProjectAnalysisCode[];
  failureCode: ProjectAnalysisCode | null;
}
export interface IProjectFileStat {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  ino: number;
  dev: number;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}
// Production adapter streams bytes; readProjectInput counts them before parsing.
export interface IProjectFs {
  lstat(path: string): Promise<IProjectFileStat>;
  realpath(path: string): Promise<string>;
  readChunks(path: string, signal: AbortSignal): AsyncIterable<Uint8Array>;
}
export interface IProjectInputDeps {
  platform: PathPlatform;
  fs: IProjectFs;
  // Adapter delegates to the existing path guard and returns its canonical path.
  assertAllowed(path: string): Promise<string>;
  now(): Date;
}
export type ProjectScanSnapshot = Pick<IScanResult, 'scanId' | 'projects'>;
export interface IProjectOutdatedTarget {
  name: string;
  registryName: string | null;
  spec: string;
  kind: 'range' | 'tag' | 'unsupported';
  warning: ProjectAnalysisCode | null;
}
