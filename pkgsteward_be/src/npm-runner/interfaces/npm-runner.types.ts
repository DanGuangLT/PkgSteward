import type {
  IManifestInput,
  IProjectFileStat,
  IProjectFs,
  ProjectLockName,
  ProjectManager,
  ProjectScanSnapshot,
} from '@/projects/interfaces/projects.types';
import type { PathPlatform } from '@/common/utils/path.util';

export const RUN_ACTIONS = [
  'install_all',
  'install_one',
  'update_all',
  'update_one',
  'uninstall_one',
  'script',
] as const;
export type RunAction = (typeof RUN_ACTIONS)[number];
export const RUN_STATUSES = [
  'running',
  'stopping',
  'completed',
  'failed',
  'cancelled',
  'timed_out',
  'termination_failed',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const RUN_FAILURE_CODES = [
  'PROJECT_NOT_SCANNED',
  'INPUT_CHANGED',
  'WORKSPACE_LEAF',
  'UNSUPPORTED_MANAGER',
  'LOCKFILE_MISMATCH',
  'TOOL_NOT_FOUND',
  'TOOL_LAYOUT_UNSUPPORTED',
  'TOOL_VERSION_MISMATCH',
  'CONFIG_UNSUPPORTED',
  'INVALID_PACKAGE_SPEC',
  'SCRIPT_NOT_FOUND',
  'SCRIPT_NAME_UNSUPPORTED',
  'READERS_RUNNING',
  'RUNNING',
  'SPAWN_FAILED',
  'COMMAND_FAILED',
  'CANCELLED',
  'TIMED_OUT',
  'SHUTDOWN',
  'TERMINATION_UNCONFIRMED',
  'AUDIT_WRITE_FAILED',
  'CACHE_INVALIDATION_FAILED',
  'INTERNAL_SERVER_ERROR',
] as const;
export type RunFailureCode = (typeof RUN_FAILURE_CODES)[number];
export const RUN_WARNING_CODES = [
  'NO_LOCKFILE',
  'PACKAGE_MANAGER_PIN_DIFFERS',
  'OUTPUT_TRUNCATED',
  'OUTPUT_ENCODING_LOSS',
  'LOGS_MAY_CONTAIN_SECRETS',
  'PROJECT_CODE_EXECUTION',
  'PATH_RACE_RESIDUAL',
] as const;
export type RunWarningCode = (typeof RUN_WARNING_CODES)[number];
export type RunnerManager = Extract<ProjectManager, 'npm' | 'pnpm'>;

export interface IRunRequest {
  path: string;
  action: RunAction;
  inputHash: string;
  requestId: string;
  package?: string;
  script?: string;
}
export interface IRunStart {
  jobId: string;
  requestId: string;
  status: RunStatus;
}
export interface IRunnerScript {
  name: string;
  command: string;
  eligible: boolean;
}
export interface IRunnerContext {
  requestPath: string;
  path: string;
  scanId: string;
  inputHash: string;
  manager: ProjectManager;
  version: string | null;
  available: boolean;
  reason: RunFailureCode | null;
  scripts: IRunnerScript[];
  warnings: RunWarningCode[];
}
export interface IRunJob extends IRunStart {
  requestPath: string;
  path: string;
  scanId: string;
  action: RunAction;
  manager: ProjectManager;
  version: string | null;
  package: string | null;
  script: string | null;
  phase: 'preflight' | 'executing' | 'stopping' | 'finalizing' | 'done';
  startedAt: string;
  finishedAt: string | null;
  spawned: boolean;
  exitCode: number | null;
  signal: string | null;
  failureCode: RunFailureCode | null;
  stopReason: 'cancel' | 'timeout' | 'shutdown' | null;
  terminationVerified: boolean;
  mayHaveChanged: boolean;
  gateHeld: boolean;
  auditWritten: boolean;
  refreshRequired: boolean;
  warningCodes: RunWarningCode[];
  firstCursor: number;
  endCursor: number;
  droppedBytes: number;
}
export interface IRunLogChunk {
  seq: number;
  stream: 'stdout' | 'stderr';
  text: string;
}
export interface IRunLogPage {
  jobId: string;
  firstCursor: number;
  nextCursor: number;
  endCursor: number;
  truncated: boolean;
  droppedBytes: number;
  chunks: IRunLogChunk[];
}

// Internal data only; executable paths and file identities never enter API entities.
export interface IRunnerFileIdentity {
  path: string;
  stat: IProjectFileStat;
}
export interface IRunnerFileHandle {
  stat(): Promise<IProjectFileStat>;
  readChunks(signal: AbortSignal): AsyncIterable<Uint8Array>;
  close(): Promise<void>;
}
export interface IRunnerFs extends IProjectFs {
  open(path: string): Promise<IRunnerFileHandle>;
}
export interface IRunnerTool {
  manager: RunnerManager;
  version: string;
  file: string;
  entry: string | null;
  packageDir: string;
  identities: IRunnerFileIdentity[];
}
export interface IRunnerToolSnapshot {
  platform: PathPlatform;
  execPath: string;
  env: Readonly<NodeJS.ProcessEnv>;
  projectPaths: readonly string[];
  signal: AbortSignal;
}
export interface IRunnerWorkspace {
  kind: 'standalone' | 'root' | 'leaf';
  root: string | null;
}
export interface IRunnerInput {
  requestPath: string;
  path: string;
  scanId: string;
  inputHash: string;
  manifest: IManifestInput;
  scripts: Record<string, unknown>;
  manager: ProjectManager;
  tool: IRunnerTool | null;
  reason: RunFailureCode | null;
  warnings: RunWarningCode[];
  workspace: IRunnerWorkspace;
  lockFiles: ProjectLockName[];
  identities: IRunnerFileIdentity[];
}
export interface IRunnerInputDeps {
  platform: PathPlatform;
  fs: IRunnerFs;
  signal: AbortSignal;
  // Fixed scan roots bound ancestor reads; never read above them or a drive root.
  scanRoots: readonly string[];
  assertAllowed(path: string): Promise<string>;
  getScanSnapshot(): ProjectScanSnapshot | null;
  resolveTool(manager: RunnerManager): Promise<IRunnerTool>;
  now(): Date;
}
export interface IRunnerCommand {
  file: string;
  args: string[];
  cwd: string;
  manager: RunnerManager;
  version: string;
}
export interface IRunnerPackageSpec {
  name: string;
  version: string | null;
  spec: string;
}
