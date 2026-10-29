import type { PathCheckFailureCode } from '@/core/path-guard/interfaces/path-guard.types';

export type GitStatusResult =
  | { state: 'clean' }
  | { state: 'dirty'; changedCount: number }
  | { state: 'not_repo' }
  | {
      state: 'unknown';
      reason:
        'git_missing' | 'timeout' | 'cancelled' | 'failed' | 'unsafe_config';
    };

export type GitTrackedResult =
  | { state: 'ok'; tracked: string[] }
  | { state: 'not_repo' }
  | {
      state: 'unknown';
      reason: 'git_missing' | 'timeout' | 'cancelled' | 'failed';
    };

export interface IGitProbe {
  status(projectRoot: string, signal?: AbortSignal): Promise<GitStatusResult>;
  trackedNames(
    projectRoot: string,
    names: readonly string[],
    signal?: AbortSignal,
  ): Promise<GitTrackedResult>;
}

export type FileOpsKind =
  | 'project'
  | 'node_modules'
  | 'orphan_node_modules'
  | 'build_cache'
  | 'project_content';

export type CleanupKind =
  'node_modules' | 'orphan_node_modules' | 'build_cache';

export type FileOpsMethod = 'permanent' | 'recycle';

export type TargetFailureCode =
  | PathCheckFailureCode
  | 'IS_LINK'
  | 'OUTSIDE_SCANNED_PROJECT'
  | 'PROJECT_CHANGED'
  | 'NOT_ORPHAN'
  | 'UNSUPPORTED_TYPE'
  | 'STAT_FAILED';

export interface IFileOpsStat {
  dev: bigint;
  ino: bigint;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export interface IFileOpsDirent {
  name: string;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

/** Minimal injected filesystem for classification and cleanup discovery. */
export interface IFileOpsFs {
  lstat(path: string): Promise<IFileOpsStat>;
  readdir(path: string): Promise<IFileOpsDirent[]>;
  readFile(path: string): Promise<string>; // UTF-8
}

export interface ITargetIdentity {
  dev: string; // Decimal bigint representation.
  ino: string;
  type: 'file' | 'directory';
}

export interface IClassifiedTarget {
  inputPath: string;
  path: string; // Valid targets use the guard's realPath.
  kind: FileOpsKind | null;
  method: FileOpsMethod | null;
  valid: boolean;
  failureCode: TargetFailureCode | null;
  owner: { path: string; name: string | null } | null;
  nestedProjects: string[];
  identity: ITargetIdentity | null;
}
