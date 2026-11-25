import type {
  IRunnerFileIdentity,
  IRunnerFs,
  IRunnerTool,
} from '@/npm-runner/interfaces/npm-runner.types';
import type {
  GlobalAction,
  GlobalManager,
  IGlobalBin,
} from '@/global-packages/interfaces/global-packages.types';
import type { IAuditRecord } from '@/core/audit-log/interfaces/audit-log.types';
import type {
  IPnpm10GlobalConfig,
  IPnpm10GlobalInventoryFacts,
} from '@/global-packages/interfaces/pnpm10-global.types';
import type { IFileDeleterDeps } from '@/file-ops/deletion/file-deleter';
import type {
  IPnpmGlobalConfig,
  IPnpmGlobalGroupFacts,
  IPnpmGlobalInventoryFacts,
  IPnpmGlobalPolicy,
} from '@/global-packages/interfaces/pnpm-global.types';
import type {
  IYarnGlobalConfig,
  IYarnGlobalInventoryFacts,
} from '@/global-packages/interfaces/yarn-global.types';
import type {
  IRunProcess,
  IRunProcessCallbacks,
} from '@/npm-runner/execution/runner-process';

export type IGlobalTool = Omit<IRunnerTool, 'manager'> & {
  manager: GlobalManager;
};

export const GLOBAL_ENVIRONMENT_KEYS = [
  'npm_config_prefix',
  'npm_config_userconfig',
  'npm_config_globalconfig',
  'npm_config_cache',
  'pnpm_config_global_dir',
  'pnpm_config_global_bin_dir',
  'pnpm_config_store_dir',
  'PNPM_HOME',
  'PREFIX',
  'YARN_CACHE_FOLDER',
] as const;
export type GlobalEnvironmentKey = (typeof GLOBAL_ENVIRONMENT_KEYS)[number];
export type GlobalEnvironmentCapture = Readonly<
  Partial<Record<GlobalEnvironmentKey, string>>
>;
export interface IGlobalConfigIdentity {
  file: IRunnerFileIdentity;
  sha256: string;
}
// Policy summaries contain key presence only, never credentials or raw config.
export interface IGlobalNpmrcPolicy {
  defaultRegistry: 'public' | 'custom' | null;
  scopedRegistries: string[];
  publicAuthPresent: boolean;
  provenanceKnown: boolean;
}
export interface IGlobalRegistryInput {
  packageName: string;
  action: GlobalAction;
  configs: readonly string[];
  environment: Readonly<NodeJS.ProcessEnv>;
  provenanceKnown: boolean;
  pnpmPolicies?: readonly IPnpmGlobalPolicy[];
}
export interface IGlobalRegistryDecision {
  changeAllowed: boolean;
  reason: 'REGISTRY_CONFIG_UNSUPPORTED' | null;
  publicAuthPresent: boolean;
}
export interface IGlobalLocation {
  manager: GlobalManager;
  tool: IGlobalTool;
  prefix: string | null;
  globalDir: string | null;
  globalRoot: string;
  binDir: string;
  cacheDir: string | null;
  storeDir: string | null;
  userConfig: string;
  globalConfig: string;
  configIdentities: IGlobalConfigIdentity[];
  pnpm?: IPnpmGlobalConfig;
  pnpm10?: IPnpm10GlobalConfig;
  yarn?: IYarnGlobalConfig;
}
export interface IGlobalBinOwner {
  name: string;
  owner: string | null;
}
export interface IGlobalProtectionInput {
  packageName: string;
  packageRoot: string;
  linked: boolean;
  currentBins: readonly IGlobalBin[];
  targetBins: readonly IGlobalBin[];
  binOwners: readonly IGlobalBinOwner[];
  ownershipComplete: boolean;
  protectedPaths: readonly string[];
  // Internal-link proof and all packages affected by a pnpm install-dir mutation.
  pnpmGroup?: IPnpmGlobalGroupFacts;
  groupPackages?: readonly IGlobalPackageFacts[];
}
export interface IGlobalPackageFacts {
  name: string;
  version: string;
  packageRoot: string;
  manifest: IGlobalConfigIdentity;
  bins: IGlobalBin[];
  binIdentities: IRunnerFileIdentity[];
  pnpmGroup?: IPnpmGlobalGroupFacts;
}
export interface IGlobalTargetFacts {
  name: string;
  version: string;
  requestedVersion: string;
  manifestHash: string;
  integrity: string;
  bins: IGlobalBin[];
  engines: string | null;
  deprecated: boolean;
}
export const NPM_SHIM_NAMES = [
  'npm',
  'npm.cmd',
  'npm.ps1',
  'npx',
  'npx.cmd',
  'npx.ps1',
] as const;
export type NpmShimName = (typeof NPM_SHIM_NAMES)[number];
// lstat/realpath results supplied by the reader, including negative observations.
// Directory identity uses dev/ino/type; file identity additionally pins content.
export interface INpmPathFacts {
  path: string;
  realPath: string;
  type: 'file' | 'directory' | 'other';
  reparse: boolean;
  identity: IRunnerFileIdentity;
  sha256: string | null;
  text: string | null;
}
export interface INpmShimFacts {
  name: NpmShimName;
  entry: INpmPathFacts | null;
}
export interface INpmSelfFacts {
  nodeVersion: string;
  nodeDir: string;
  packageDir: string;
  prefixResolved: string;
  prefixReal: string;
  protectedPaths: string[];
  prefixDirectory: INpmPathFacts;
  rootDirectory: INpmPathFacts;
  bundledVersion: string;
  bundledIdentities: IGlobalConfigIdentity[];
  nodeDirShims: INpmShimFacts[];
  prefixScript: IGlobalConfigIdentity | null;
  overlay: {
    directory: INpmPathFacts;
    package: IGlobalPackageFacts | null;
  } | null;
  shims: INpmShimFacts[];
  retired: INpmPathFacts[];
  repairTargets: INpmPathFacts[];
}
export interface IGlobalPreviewFacts {
  location: IGlobalLocation;
  current: IGlobalPackageFacts | null;
  target: IGlobalTargetFacts | null;
  binOwners: IGlobalBinOwner[];
  registryChangeAllowed?: boolean;
  locations?: IGlobalLocation[];
  pnpmInventory?: IPnpmGlobalInventoryFacts;
  pnpm10Inventory?: IPnpm10GlobalInventoryFacts;
  yarnInventory?: IYarnGlobalInventoryFacts;
  npm?: INpmSelfFacts;
}
// Infrastructure inputs only; no controller accepts paths, argv or environment.
export interface IGlobalRuntime {
  fs: IRunnerFs;
  environment: Readonly<NodeJS.ProcessEnv>;
  now(): Date;
  monotonicNow(): number;
  resolveTool(
    manager: GlobalManager,
    signal: AbortSignal,
  ): Promise<IGlobalTool>;
}

export interface IGlobalResolvedLocation extends IGlobalLocation {
  cwd: string;
  protectedPaths: readonly string[];
  missingConfigPaths?: readonly string[];
}
export interface IGlobalCommand {
  file: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  shell?: false;
  extendEnv?: false;
  stdin?: 'ignore';
}
export interface IGlobalProbeOptions {
  cwd: string;
  env: Readonly<NodeJS.ProcessEnv>;
  signal: AbortSignal;
  timeout: number;
  maxBuffer: { stdout: number; stderr: number };
  shell: false;
  extendEnv: false;
  stdin: 'ignore';
  encoding: 'buffer';
  reject: false;
}
export interface IGlobalProbeResult {
  stdout: Uint8Array;
  stderr: Uint8Array;
  exitCode: number | null;
  terminationVerified: boolean;
  overflowed?: boolean;
  timedOut?: boolean;
}
// The injected launcher must bound capture and verify termination, including aborts.
export type GlobalProbeSpawn = (
  file: string,
  args: readonly string[],
  options: IGlobalProbeOptions,
) => Promise<IGlobalProbeResult>;

export const GLOBAL_PACKAGES_RUNTIME = Symbol('GLOBAL_PACKAGES_RUNTIME');
export const GLOBAL_PACKAGES_FS = Symbol('GLOBAL_PACKAGES_FS');
export const GLOBAL_PACKAGES_PROCESS = Symbol('GLOBAL_PACKAGES_PROCESS');

export interface IGlobalServiceRuntime extends IGlobalRuntime {
  // Optional for read-only/custom adapters; production always binds both.
  fs: IRunnerFs & Partial<Pick<IFileDeleterDeps, 'rm'>>;
  nodeVersion?: string;
  platform: NodeJS.Platform;
  execPath: string;
  paths: {
    cacheDir: string;
    appInstallDir: string;
    sourceCheckoutDir: string | null;
    dataDir: string;
  };
  scannedProjectPaths(): readonly string[];
  makeDirectory(path: string): Promise<void>;
  probe: GlobalProbeSpawn;
  fetcher: typeof fetch;
  launch: GlobalMutationLaunch;
  timeoutMs: number | undefined;
  uuid(): string;
  setTimer(callback: () => void, milliseconds: number): unknown;
  clearTimer(handle: unknown): void;
  gate: {
    tryEnter(): symbol | null;
    leave(token: symbol): void;
  };
  audit: IGlobalAuditSink;
  // Must retry stop/verification of retained probe identities, never launch another probe.
  verifyProbeTermination?(): Promise<boolean>;
}

export interface IGlobalAuditSink {
  append(record: IAuditRecord): Promise<void>;
}

export type GlobalMutationLaunch = (
  command: IGlobalCommand,
  callbacks: IRunProcessCallbacks,
) => IRunProcess;
