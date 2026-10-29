import { Injectable } from '@nestjs/common';
import { execa } from 'execa';
import { toPathPlatform, type PathPlatform } from '@/common/utils/path.util';
import { resolveGitExecutable } from '@/file-ops/git-executable';
import type {
  GitStatusResult,
  GitTrackedResult,
  IGitProbe,
} from '@/file-ops/interfaces/file-ops.types';

export const GIT_PROBE_TIMEOUT_MS = 30_000;
export const GIT_PROBE_CONCURRENCY = 4;
export const GIT_FILTER_SCOPE_ARGS = [
  '--no-optional-locks',
  'config',
  '--show-scope',
  '--name-only',
  '--get-regexp',
  '^(filter\\.|lfs\\..+\\.(clean|smudge)$|remote\\..+\\.promisor$|extensions\\.partialclone$)',
] as const;
export const GIT_STATUS_ARGS = [
  '--no-optional-locks',
  '-c',
  'core.fsmonitor=false',
  'status',
  '--porcelain=v1',
  '-z',
  '--untracked-files=normal',
  // Submodule configs are not inspected for filters, so do not recurse into them.
  '--ignore-submodules=all',
  '--',
  '.',
] as const;
export const GIT_TRACKED_ARGS = [
  '--no-optional-locks',
  '-c',
  'core.fsmonitor=false',
  'ls-files',
  '-z',
  '--',
] as const;

type GitProbeFailure = Extract<
  GitTrackedResult,
  { state: 'not_repo' | 'unknown' }
>;
type GitCommandResult =
  { state: 'ok'; stdout: string } | { state: 'failed'; error: unknown };

// Chỉ tin filter/LFS extension/partial-clone config ở system/global: repo có thể chạy lệnh qua filter,
// lệnh clean của git-lfs extension, hoặc lazy fetch.
// Chặn partial clone cả trên Git cũ chưa hỗ trợ GIT_NO_LAZY_FETCH.
const TRUSTED_FILTER_LINE = /^(?:system|global)\t[^\t]+$/;

// Global --literal-pathspecs cannot be combined with icase, so each pathspec carries its own magic.
export function buildTrackedPathspecs(
  names: readonly string[],
  platform: PathPlatform,
): string[] {
  const magic = platform === 'win32' ? ':(literal,icase)' : ':(literal)';
  return names.map((name) => `${magic}${name}`);
}

export function matchTrackedNames(
  names: readonly string[],
  outputPaths: readonly string[],
  platform: PathPlatform,
): string[] {
  const fold = (value: string) =>
    platform === 'win32' ? value.toLowerCase() : value;
  const paths = outputPaths.map(fold);
  return names.filter((name) => {
    const key = fold(name);
    return paths.some((path) => path === key || path.startsWith(`${key}/`));
  });
}

// `git config --get-regexp` exits 1 with no output when no key matches.
const isNoMatch = (error: unknown): boolean =>
  error !== null &&
  typeof error === 'object' &&
  'exitCode' in error &&
  error.exitCode === 1 &&
  'stdout' in error &&
  error.stdout === '';

const onlyTrustedFilters = (stdout: string): boolean =>
  stdout
    .split('\n')
    .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
    .filter((line) => line !== '')
    .every((line) => TRUSTED_FILTER_LINE.test(line));

const classifyFailure = (
  error: unknown,
  signal?: AbortSignal,
): GitProbeFailure => {
  const failure =
    error !== null && typeof error === 'object'
      ? (error as Record<string, unknown>)
      : {};
  if (
    failure.exitCode === 128 &&
    typeof failure.stderr === 'string' &&
    /not a git repository/i.test(failure.stderr)
  ) {
    return { state: 'not_repo' };
  }
  if (failure.code === 'ENOENT')
    return { state: 'unknown', reason: 'git_missing' };
  if (failure.timedOut) return { state: 'unknown', reason: 'timeout' };
  if (failure.isCanceled || signal?.aborted)
    return { state: 'unknown', reason: 'cancelled' };
  return { state: 'unknown', reason: 'failed' };
};

@Injectable()
export class GitProbe implements IGitProbe {
  private readonly platform = toPathPlatform();
  private activeCount = 0;
  private readonly queue: Array<() => void> = [];
  private gitPath?: string;

  async status(
    projectRoot: string,
    signal?: AbortSignal,
  ): Promise<GitStatusResult> {
    // Both commands share one slot: the unsafe-config check must gate status.
    return this.withSlot(signal, async (): Promise<GitStatusResult> => {
      const filters = await this.exec(
        projectRoot,
        GIT_FILTER_SCOPE_ARGS,
        signal,
      );
      if (filters.state === 'failed') {
        if (!isNoMatch(filters.error))
          return classifyFailure(filters.error, signal);
      } else if (!onlyTrustedFilters(filters.stdout)) {
        return { state: 'unknown', reason: 'unsafe_config' };
      }
      if (signal?.aborted) return { state: 'unknown', reason: 'cancelled' };

      const result = await this.exec(projectRoot, GIT_STATUS_ARGS, signal);
      if (result.state === 'failed')
        return classifyFailure(result.error, signal);
      const entries = result.stdout.split('\0');
      if (entries[entries.length - 1] === '') entries.pop();
      let changedCount = 0;
      for (let index = 0; index < entries.length; index += 1) {
        changedCount += 1;
        // In -z mode, rename/copy records carry an extra NUL-delimited source path.
        if (/[RC]/.test(entries[index].slice(0, 2))) index += 1;
      }
      return changedCount === 0
        ? { state: 'clean' }
        : { state: 'dirty', changedCount };
    });
  }

  async trackedNames(
    projectRoot: string,
    names: readonly string[],
    signal?: AbortSignal,
  ): Promise<GitTrackedResult> {
    if (names.length === 0) return { state: 'ok', tracked: [] };
    return this.withSlot(signal, async (): Promise<GitTrackedResult> => {
      const result = await this.exec(
        projectRoot,
        [...GIT_TRACKED_ARGS, ...buildTrackedPathspecs(names, this.platform)],
        signal,
      );
      if (result.state === 'failed')
        return classifyFailure(result.error, signal);
      const paths = result.stdout.split('\0').filter((path) => path !== '');
      return {
        state: 'ok',
        tracked: matchTrackedNames(names, paths, this.platform),
      };
    });
  }

  private async withSlot<T>(
    signal: AbortSignal | undefined,
    task: () => Promise<T>,
  ): Promise<T | GitProbeFailure> {
    if (!(await this.acquire(signal)))
      return { state: 'unknown', reason: 'cancelled' };
    try {
      // A signal can abort after a slot was reserved but before this continuation.
      if (signal?.aborted) return { state: 'unknown', reason: 'cancelled' };
      return await task();
    } finally {
      this.release();
    }
  }

  private async exec(
    projectRoot: string,
    args: readonly string[],
    signal?: AbortSignal,
  ): Promise<GitCommandResult> {
    // Never spawn a bare "git": a missing install must not fall back to a lookup in the project.
    this.gitPath ??=
      (await resolveGitExecutable(process.env.PATH, this.platform)) ??
      undefined;
    if (this.gitPath === undefined)
      return { state: 'failed', error: { code: 'ENOENT' } };
    try {
      const { stdout } = await execa(this.gitPath, args, {
        cwd: projectRoot,
        shell: false,
        timeout: GIT_PROBE_TIMEOUT_MS,
        cancelSignal: signal,
        windowsHide: true,
        env: { GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1' },
      });
      return { state: 'ok', stdout };
    } catch (error) {
      return { state: 'failed', error };
    }
  }

  private acquire(signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return Promise.resolve(false);
    if (this.activeCount < GIT_PROBE_CONCURRENCY) {
      // Reserve synchronously so concurrent calls cannot claim the same slot.
      this.activeCount += 1;
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      const start = () => {
        signal?.removeEventListener('abort', cancel);
        this.activeCount += 1;
        resolve(true);
      };
      const cancel = () => {
        const index = this.queue.indexOf(start);
        if (index === -1) return;
        this.queue.splice(index, 1);
        signal?.removeEventListener('abort', cancel);
        resolve(false);
      };
      this.queue.push(start);
      signal?.addEventListener('abort', cancel, { once: true });
    });
  }

  private release(): void {
    this.activeCount -= 1;
    // Hand the slot directly to the oldest waiter, before another caller can enter.
    this.queue.shift()?.();
  }
}
