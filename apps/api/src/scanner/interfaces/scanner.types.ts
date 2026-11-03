import type { Dirent, Stats } from 'node:fs';
import type { PathPlatform } from '@/common/utils/path.util';

export type ScanStatus =
  'running' | 'completed' | 'cancelled' | 'timed_out' | 'failed';
export type PackageManager = 'pnpm' | 'yarn' | 'npm';

export interface IScanProgress {
  visitedDirs: number;
  foundProjects: number;
  skippedCount: number;
}

export interface IScannedProject {
  path: string;
  name: string | null;
  packageManager: PackageManager | null;
  hasLockfile: boolean;
  lastActivityAt: string;
  nodeModules: {
    exists: boolean;
    path: string;
    sizeBytes: number | null;
    sizeMeasuredAt: string | null;
  };
}

export interface IOrphanNodeModules {
  path: string;
  sizeBytes: number | null;
  sizeMeasuredAt: string | null;
  mtime: string;
}

export interface IScanStart {
  scanId: string;
  status: ScanStatus;
}

export interface IScanJob extends IScanStart {
  partial: boolean;
  progress: IScanProgress;
  startedAt: string;
  finishedAt?: string;
}

export interface IScanResult extends IScanStart {
  status: 'completed' | 'timed_out';
  partial: boolean;
  roots: string[];
  maxDepth: number;
  startedAt: string;
  finishedAt: string;
  skippedCount: number;
  projects: IScannedProject[];
  orphanNodeModules: IOrphanNodeModules[];
}

// Scan metadata and schema-1 files contain no measured sizes. Older files omit
// sizeMeasuredAt; only the API copy requires this field and may contain numbers.
export type IScanProjectMetadata = Omit<IScannedProject, 'nodeModules'> & {
  nodeModules: Omit<
    IScannedProject['nodeModules'],
    'sizeBytes' | 'sizeMeasuredAt'
  > & {
    sizeBytes: null;
    sizeMeasuredAt?: null;
  };
};

export type IScanOrphanMetadata = Omit<
  IOrphanNodeModules,
  'sizeBytes' | 'sizeMeasuredAt'
> & {
  sizeBytes: null;
  sizeMeasuredAt?: null;
};

export type IStoredScanResult = Omit<
  IScanResult,
  'projects' | 'orphanNodeModules'
> & {
  projects: IScanProjectMetadata[];
  orphanNodeModules: IScanOrphanMetadata[];
};

export interface IScanFs {
  readdir(path: string): Promise<Dirent[]>;
  lstat(
    path: string,
  ): Promise<
    Pick<Stats, 'mtimeMs' | 'isFile' | 'isDirectory' | 'isSymbolicLink'>
  >;
  realpath(path: string): Promise<string>;
  readFile(path: string, signal: AbortSignal): Promise<string>;
}

export interface IMetadataDeps {
  platform: PathPlatform;
  fs: IScanFs;
  signal: AbortSignal;
}

export interface IDirectoryMetadata {
  project: IScanProjectMetadata | null;
  orphan: IScanOrphanMetadata | null;
}

export interface IWalkSnapshot {
  roots: string[];
  projects: IScanProjectMetadata[];
  orphanNodeModules: IScanOrphanMetadata[];
  progress: IScanProgress;
}

export interface IWalkerDeps {
  platform: PathPlatform;
  fs: IScanFs;
  isInsideProtectedTree(path: string): Promise<boolean>;
  onProgress(progress: IScanProgress): void;
  onSkipped(path: string, error: unknown): void;
}

export type ScanWalker = (
  roots: readonly string[],
  maxDepth: number,
  signal: AbortSignal,
  deps: IWalkerDeps,
) => Promise<IWalkSnapshot>;

export interface IScanCacheKey {
  roots: '*' | string[];
  maxDepth: number;
}

export interface IScanCacheEntry {
  schemaVersion: 1;
  key: IScanCacheKey;
  result: IStoredScanResult;
}

export interface IScanCacheFs {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export interface IScanCacheDeps {
  cacheFilePath: string;
  fs: IScanCacheFs;
  ensureCacheDir(): Promise<string>;
  warn(message: string, error?: unknown): void;
}
