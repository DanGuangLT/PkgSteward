import { Injectable } from '@nestjs/common';
import { execa } from 'execa';
import type {
  GitStatusResult,
  GitTrackedResult,
  IGitProbe,
} from '@/file-ops/interfaces/file-ops.types';

export const GIT_PROBE_TIMEOUT_MS = 30_000;
export const GIT_PROBE_CONCURRENCY = 4;
export const GIT_STATUS_ARGS = [
  '--no-optional-locks',
  '-c',
  'core.fsmonitor=false',
  'status',
  '--porcelain=v1',
  '-z',
  '--untracked-files=normal',
  '--',
  '.',
] as const;
export const GIT_TRACKED_ARGS = [
  '--no-optional-locks',
  '-c',
  'core.fsmonitor=false',
  '--literal-pathspecs',
  'ls-files',
  '-z',
  '--',
] as const;

type GitProbeFailure = Extract<
  GitStatusResult,
  { state: 'not_repo' | 'unknown' }
>;
type GitCommandResult = { state: 'ok'; stdout: string } | GitProbeFailure;

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
  private activeCount = 0;
  private readonly queue: Array<() => void> = [];

  async status(
    projectRoot: string,
    signal?: AbortSignal,
  ): Promise<GitStatusResult> {
    const result = await this.run(projectRoot, GIT_STATUS_ARGS, signal);
    if (result.state !== 'ok') return result;

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
  }

  async trackedNames(
    projectRoot: string,
    names: readonly string[],
    signal?: AbortSignal,
  ): Promise<GitTrackedResult> {
    if (names.length === 0) return { state: 'ok', tracked: [] };
    const result = await this.run(
      projectRoot,
      [...GIT_TRACKED_ARGS, ...names],
      signal,
    );
    if (result.state !== 'ok') return result;
    const paths = result.stdout.split('\0').filter((path) => path !== '');
    return {
      state: 'ok',
      tracked: names.filter((name) =>
        paths.some((path) => path === name || path.startsWith(`${name}/`)),
      ),
    };
  }

  private async run(
    projectRoot: string,
    args: readonly string[],
    signal?: AbortSignal,
  ): Promise<GitCommandResult> {
    if (!(await this.acquire(signal)))
      return { state: 'unknown', reason: 'cancelled' };
    try {
      // A signal can abort after a slot was reserved but before this continuation.
      if (signal?.aborted) return { state: 'unknown', reason: 'cancelled' };
      const { stdout } = await execa('git', args, {
        cwd: projectRoot,
        shell: false,
        timeout: GIT_PROBE_TIMEOUT_MS,
        cancelSignal: signal,
        windowsHide: true,
        env: { GIT_TERMINAL_PROMPT: '0' },
      });
      return { state: 'ok', stdout };
    } catch (error) {
      return classifyFailure(error, signal);
    } finally {
      this.release();
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
