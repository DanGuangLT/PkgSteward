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
  IPnpmGlobalConfig,
  IPnpmGlobalGroupFacts,
  IPnpmGlobalInventoryFacts,
  IPnpmGlobalPolicy,
} from '@/global-packages/interfaces/pnpm-global.types';
import type {
  IRunProcess,
  IRunProcessCallbacks,
} from '@/npm-runner/runner-process';

export const GLOBAL_ENVIRONMENT_KEYS = [
  'npm_config_prefix',
  'npm_config_userconfig',
  'npm_config_globalconfig',
  'npm_config_cache',
  'pnpm_config_global_dir',
  'pnpm_config_global_bin_dir',
  'pnpm_config_store_dir',
  'PNPM_HOME',
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
  tool: IRunnerTool;
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
}
export interface IGlobalPreviewFacts {
  location: IGlobalLocation;
  current: IGlobalPackageFacts;
  target: IGlobalTargetFacts | null;
  binOwners: IGlobalBinOwner[];
  registryChangeAllowed?: boolean;
  locations?: IGlobalLocation[];
  pnpmInventory?: IPnpmGlobalInventoryFacts;
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
  ): Promise<IRunnerTool>;
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
