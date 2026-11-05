import type {
  IRunnerFileIdentity,
  IRunnerFs,
  IRunnerTool,
} from '@/npm-runner/interfaces/npm-runner.types';
import type { IGlobalConfigIdentity } from '@/global-packages/interfaces/global-packages.runtime';

// Private facts only. Never retain raw YAML/INI, auth values or the OS environment.
export interface IPnpmGlobalPolicy {
  defaultRegistry: 'public' | 'custom' | null;
  scopedRegistries: readonly string[];
  unknownRouting: boolean;
  publicAuthPresent: boolean;
  changeUnsupported: boolean;
}

export interface IPnpmGlobalSafetySettings {
  minimumReleaseAge?: number;
  minimumReleaseAgeStrict?: boolean;
  allowBuilds?: Readonly<Record<string, boolean>>;
}

export interface IPnpmGlobalConfig {
  homeDir: string;
  globalDir: string;
  globalRoot: string;
  binDir: string;
  // null means discovery must validate the default store from group metadata.
  storeDir: string | null;
  cacheDir: string;
  stateDir: string;
  configDir: string;
  authFile: string;
  originalPath: readonly string[];
  configIdentities: readonly IGlobalConfigIdentity[];
  missingConfigPaths: readonly string[];
  missingDirectoryPaths: readonly string[];
  directoryIdentities: readonly IRunnerFileIdentity[];
  selectors: Readonly<Partial<Record<PnpmGlobalSelector, string>>>;
  policy: IPnpmGlobalPolicy;
  safety: IPnpmGlobalSafetySettings;
}

export type PnpmGlobalSelector =
  | 'PNPM_HOME'
  | 'XDG_DATA_HOME'
  | 'XDG_CONFIG_HOME'
  | 'XDG_CACHE_HOME'
  | 'XDG_STATE_HOME'
  | 'LOCALAPPDATA'
  | 'APPDATA'
  | 'USERPROFILE'
  | 'HOME'
  | 'pnpm_config_npmrc_auth_file'
  | 'pnpm_config_userconfig'
  | 'pnpm_config_global_dir'
  | 'pnpm_config_global_bin_dir'
  | 'pnpm_config_store_dir'
  | 'pnpm_config_cache_dir'
  | 'pnpm_config_state_dir'
  | 'pnpm_config_config_dir'
  | 'pnpm_config_pnpm_home_dir'
  | 'npm_config_userconfig';

export interface IPnpmGlobalConfigDeps {
  fs: IRunnerFs;
  environment: Readonly<NodeJS.ProcessEnv>;
  signal: AbortSignal;
  tool: IRunnerTool;
  cwd: string;
  // Caller applies ancestor/reparse/overlap guards; optional paths may be absent.
  checkDirectory(path: string): Promise<void>;
}

export interface IPnpmGlobalLinkFacts {
  logicalPath: string;
  realPath: string;
  identity: IRunnerFileIdentity;
}

export interface IPnpmGlobalGroupFacts {
  index: IPnpmGlobalLinkFacts;
  installDir: string;
  directory: IRunnerFileIdentity;
  manifest: IGlobalConfigIdentity;
  lockfile: IGlobalConfigIdentity;
  modules: IGlobalConfigIdentity;
  packageMap: IGlobalConfigIdentity;
  virtualStoreLockfile: IGlobalConfigIdentity;
  directDependencies: readonly string[];
  packageLinks: readonly IPnpmGlobalLinkFacts[];
  storeDir: string;
  virtualStoreDir: string;
}

export interface IPnpmGlobalInventoryFacts {
  groups: readonly IPnpmGlobalGroupFacts[];
  unreferencedDirectories: readonly IRunnerFileIdentity[];
  ownershipComplete: boolean;
  shimIdentities?: readonly IGlobalConfigIdentity[];
}
