import type {
  AnalysisPhase,
  IAnalysisResult,
  ILockInventory,
  IProjectInput,
  IProjectInputDeps,
  ProjectScanSnapshot,
} from '@/projects/interfaces/projects.types';

export interface IRegistryPackageMetadata {
  versions: string[];
  distTags: Record<string, string>;
  deprecatedVersions?: string[];
}

// Advisory members remain untrusted until the analysis runner validates them.
export type RegistryAdvisories = Record<string, unknown[]>;
export type RegistryVersions = Record<string, string[]>;

export interface IProjectRegistry {
  getPackageMetadata(
    name: string,
    signal: AbortSignal,
  ): Promise<IRegistryPackageMetadata>;
  getBulkAdvisories(
    versions: RegistryVersions,
    signal: AbortSignal,
  ): Promise<RegistryAdvisories>;
}

export type ProjectInventoryBuilder = (
  input: IProjectInput,
  signal: AbortSignal,
) => Promise<ILockInventory>;

export interface IProjectAnalysisUpdate extends IAnalysisResult {
  phase: AnalysisPhase;
}

export interface IProjectAnalysisDeps {
  registry: IProjectRegistry;
  buildInventory: ProjectInventoryBuilder;
  now(): Date;
  onSnapshot(snapshot: IProjectAnalysisUpdate): void;
}

export type ProjectAnalyzer = (
  input: IProjectInput,
  signal: AbortSignal,
  deps: IProjectAnalysisDeps,
) => Promise<IAnalysisResult>;

// G3 binds these read-only adapters to existing Scanner/DiskUsage/gate/config.
export interface IProjectsLifecycleDeps {
  getLatest(): ProjectScanSnapshot;
  assertIdle(): void;
  peekCompletedSize(
    canonicalPath: string,
  ): { sizeBytes: number; measuredAt: string } | null;
  now(): Date;
  timeoutMs: number | undefined;
}

export interface IProjectsRuntime {
  input: IProjectInputDeps;
  lifecycle: IProjectsLifecycleDeps;
  registry: IProjectRegistry;
  analyze: ProjectAnalyzer;
}
