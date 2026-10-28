export type GitStatusResult =
  | { state: 'clean' }
  | { state: 'dirty'; changedCount: number }
  | { state: 'not_repo' }
  | {
      state: 'unknown';
      reason: 'git_missing' | 'timeout' | 'cancelled' | 'failed';
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
