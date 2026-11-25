import type { IRunnerFileIdentity } from '@/npm-runner/interfaces/npm-runner.types';
import type { IGlobalBin } from '@/global-packages/interfaces/global-packages.types';
import type { IGlobalConfigIdentity } from '@/global-packages/interfaces/global-packages.runtime';
import type { IPnpmGlobalPolicy } from '@/global-packages/interfaces/pnpm-global.types';

// Private, inert facts. Raw config/auth values and executable text never escape readers.
export interface IYarnGlobalConfig {
  prefixDir: string;
  globalDir: string;
  globalRoot: string;
  binDir: string;
  cacheDir: string;
  mutexFile: string;
  userYarnrc: string;
  globalYarnrc: string;
  userNpmrc: string;
  globalNpmrc: string;
  binOnPath: boolean;
  explicitPrefix: boolean;
  originalPath: readonly string[];
  selectors: Readonly<Record<string, string>>;
  policy: IPnpmGlobalPolicy;
  configIdentities: readonly IGlobalConfigIdentity[];
  missingConfigPaths: readonly string[];
  directoryIdentities: readonly IRunnerFileIdentity[];
  missingDirectoryPaths: readonly string[];
}

export interface IYarnBinSlot {
  name: string;
  identity: IRunnerFileIdentity;
  realPath: string | null;
  sha256: string | null;
  owner: string | null;
}

export interface IYarnBinDirectory {
  complete: boolean;
  slots: IYarnBinSlot[];
  // Ephemeral proof input only; never copy text into inventory/preview facts.
  texts: ReadonlyMap<string, string>;
}

export interface IYarnDependencyFacts {
  name: string;
  spec: string;
  version: string;
  linked: boolean;
  logicalPath: string;
  realPath: string;
  linkIdentity: IRunnerFileIdentity | null;
  manifest: IGlobalConfigIdentity | null;
  bins: readonly IGlobalBin[];
  binIdentities: readonly IRunnerFileIdentity[];
  shims: readonly IGlobalConfigIdentity[];
}

export interface IYarnGlobalProjectFacts {
  manifest: IGlobalConfigIdentity | null;
  lockfile: IGlobalConfigIdentity | null;
  dependencies: readonly IYarnDependencyFacts[];
  missingPaths: readonly string[];
  files: readonly IGlobalConfigIdentity[];
  enumerations: readonly { path: string; entries: readonly string[] }[];
}

export interface IYarnGlobalInventoryFacts {
  ownershipComplete: boolean;
  project: IYarnGlobalProjectFacts;
  binSlots: readonly IYarnBinSlot[];
}
