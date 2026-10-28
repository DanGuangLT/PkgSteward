jest.mock('execa', () => ({ execa: jest.fn() }));

import { Logger } from '@nestjs/common';
import { execa } from 'execa';
import {
  GIT_PROBE_CONCURRENCY,
  GIT_PROBE_TIMEOUT_MS,
  GIT_STATUS_ARGS,
  GIT_TRACKED_ARGS,
  GitProbe,
} from '@/file-ops/git-probe';
import type {
  GitStatusResult,
  GitTrackedResult,
} from '@/file-ops/interfaces/file-ops.types';

const execaMock = execa as unknown as jest.Mock;
const root = 'D:\\Dự án \'"$`; test';
const statusArgs = [
  '--no-optional-locks',
  '-c',
  'core.fsmonitor=false',
  'status',
  '--porcelain=v1',
  '-z',
  '--untracked-files=normal',
  '--',
  '.',
];
const trackedArgs = [
  '--no-optional-locks',
  '-c',
  'core.fsmonitor=false',
  '--literal-pathspecs',
  'ls-files',
  '-z',
  '--',
];
const options = (signal?: AbortSignal) => ({
  cwd: root,
  shell: false,
  timeout: 30_000,
  cancelSignal: signal,
  windowsHide: true,
  env: { GIT_TERMINAL_PROMPT: '0' },
});
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('GitProbe', () => {
  beforeEach(() => execaMock.mockReset());
  afterEach(() => jest.restoreAllMocks());

  it('declares read-only command arrays and bounded probes', () => {
    expect(GIT_STATUS_ARGS).toEqual(statusArgs);
    expect(GIT_TRACKED_ARGS).toEqual(trackedArgs);
    expect(GIT_PROBE_TIMEOUT_MS).toBe(30_000);
    expect(GIT_PROBE_CONCURRENCY).toBe(4);
  });

  it('runs status with the exact arguments and forwards cancellation', async () => {
    const controller = new AbortController();
    execaMock.mockResolvedValue({ stdout: '' });
    await expect(
      new GitProbe().status(root, controller.signal),
    ).resolves.toEqual({ state: 'clean' });
    expect(execaMock).toHaveBeenCalledTimes(1);
    expect(execaMock).toHaveBeenCalledWith(
      'git',
      statusArgs,
      options(controller.signal),
    );
  });

  it.each([
    ['', { state: 'clean' }],
    [' M first.txt\0?? second.txt\0', { state: 'dirty', changedCount: 2 }],
    ['R  new name.txt\0old name.txt\0', { state: 'dirty', changedCount: 1 }],
    [
      ' R new.txt\0old.txt\0 M other.txt\0',
      { state: 'dirty', changedCount: 2 },
    ],
    ['C  copy.txt\0original.txt\0', { state: 'dirty', changedCount: 1 }],
    [' C copy.txt\0original.txt\0', { state: 'dirty', changedCount: 1 }],
    [
      'RM renamed.txt\0 M old filename.txt\0?? untracked.txt\0',
      { state: 'dirty', changedCount: 2 },
    ],
    [
      ' M file with spaces.txt\0?? tiếng Việt\nfile.txt\0',
      { state: 'dirty', changedCount: 2 },
    ],
    [
      'R  tiếng Việt\nnew.txt\0old\nname.txt\0',
      { state: 'dirty', changedCount: 1 },
    ],
  ])('parses porcelain -z %j', async (stdout, expected) => {
    execaMock.mockResolvedValue({ stdout });
    await expect(new GitProbe().status(root)).resolves.toEqual(expected);
  });

  it('uses literal pathspecs, keeps requested order and returns only tracked names', async () => {
    const names = [
      'coverage',
      '.next',
      'file name.txt',
      ':(glob)*',
      'untracked',
    ];
    const controller = new AbortController();
    execaMock.mockResolvedValue({
      stdout: '.next/x\0file name.txt\0coverage/a\0.next/y\0:(glob)*/file\0',
    });
    await expect(
      new GitProbe().trackedNames(root, names, controller.signal),
    ).resolves.toEqual({
      state: 'ok',
      tracked: ['coverage', '.next', 'file name.txt', ':(glob)*'],
    });
    expect(execaMock).toHaveBeenCalledTimes(1);
    expect(execaMock).toHaveBeenCalledWith(
      'git',
      [...trackedArgs, ...names],
      options(controller.signal),
    );
  });

  it('does not mistake a name prefix for a tracked directory', async () => {
    execaMock.mockResolvedValue({ stdout: '.nextjs/x\0coverage-old/y\0' });
    await expect(
      new GitProbe().trackedNames(root, ['.next', 'coverage']),
    ).resolves.toEqual({ state: 'ok', tracked: [] });
  });

  it('supports exact matches, Unicode and newlines in names', async () => {
    execaMock.mockResolvedValue({
      stdout: 'tiếng Việt/x\0line\nbreak\0.next\0',
    });
    await expect(
      new GitProbe().trackedNames(root, ['.next', 'line\nbreak', 'tiếng Việt']),
    ).resolves.toEqual({
      state: 'ok',
      tracked: ['.next', 'line\nbreak', 'tiếng Việt'],
    });
  });

  it('returns no tracked names for empty ls-files output', async () => {
    execaMock.mockResolvedValue({ stdout: '' });
    await expect(new GitProbe().trackedNames(root, ['.next'])).resolves.toEqual(
      { state: 'ok', tracked: [] },
    );
  });

  it('does not invoke git for empty requested names', async () => {
    await expect(new GitProbe().trackedNames(root, [])).resolves.toEqual({
      state: 'ok',
      tracked: [],
    });
    expect(execaMock).not.toHaveBeenCalled();
  });

  describe.each(['status', 'trackedNames'] as const)(
    '%s error handling',
    (method) => {
      const invoke = (probe: GitProbe, signal?: AbortSignal) =>
        method === 'status'
          ? probe.status(root, signal)
          : probe.trackedNames(root, ['.next'], signal);

      it.each([
        [
          {
            exitCode: 128,
            stderr: 'fatal: not a git repository (or any parent)',
          },
          { state: 'not_repo' },
        ],
        [
          { exitCode: 128, stderr: 'NOT A GIT REPOSITORY' },
          { state: 'not_repo' },
        ],
        [
          { exitCode: 128, stderr: 'fatal: dubious ownership' },
          { state: 'unknown', reason: 'failed' },
        ],
        [
          { exitCode: 1, stderr: 'not a git repository' },
          { state: 'unknown', reason: 'failed' },
        ],
        [{ code: 'ENOENT' }, { state: 'unknown', reason: 'git_missing' }],
        [{ timedOut: true }, { state: 'unknown', reason: 'timeout' }],
        [{ isCanceled: true }, { state: 'unknown', reason: 'cancelled' }],
        [new Error('other failure'), { state: 'unknown', reason: 'failed' }],
        [null, { state: 'unknown', reason: 'failed' }],
      ])('maps rejection %j', async (error, expected) => {
        execaMock.mockRejectedValue(error);
        await expect(invoke(new GitProbe())).resolves.toEqual(expected);
      });

      it('recognizes an aborted signal even without execa cancellation metadata', async () => {
        const controller = new AbortController();
        execaMock.mockImplementation(() => {
          controller.abort();
          return Promise.reject(new Error('interrupted'));
        });
        await expect(
          invoke(new GitProbe(), controller.signal),
        ).resolves.toEqual({ state: 'unknown', reason: 'cancelled' });
      });

      it('never starts an already-cancelled request', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(
          invoke(new GitProbe(), controller.signal),
        ).resolves.toEqual({ state: 'unknown', reason: 'cancelled' });
        expect(execaMock).not.toHaveBeenCalled();
      });
    },
  );

  it('does not log stdout or stderr on either probe', async () => {
    const spies = [
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined),
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
      jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined),
      jest
        .spyOn(Logger.prototype, 'verbose')
        .mockImplementation(() => undefined),
      jest.spyOn(Logger.prototype, 'fatal').mockImplementation(() => undefined),
    ];
    execaMock.mockRejectedValue({
      stdout: 'PRIVATE_GIT_STDOUT',
      stderr: 'PRIVATE_GIT_STDERR',
    });
    const probe = new GitProbe();
    await expect(probe.status(root)).resolves.toEqual({
      state: 'unknown',
      reason: 'failed',
    });
    await expect(probe.trackedNames(root, ['.next'])).resolves.toEqual({
      state: 'unknown',
      reason: 'failed',
    });
    for (const spy of spies)
      expect(JSON.stringify(spy.mock.calls)).not.toMatch(
        /PRIVATE_GIT_STDOUT|PRIVATE_GIT_STDERR/,
      );
  });

  describe('shared FIFO concurrency limit', () => {
    let pending: { finish: () => void; fail: () => void }[];
    let active: number;
    let maximum: number;

    beforeEach(() => {
      pending = [];
      active = 0;
      maximum = 0;
      execaMock.mockImplementation(() => {
        active += 1;
        maximum = Math.max(maximum, active);
        return new Promise<{ stdout: string }>((resolve, reject) => {
          pending.push({
            finish: () => {
              active -= 1;
              resolve({ stdout: '' });
            },
            fail: () => {
              active -= 1;
              reject(
                Object.assign(new Error('git timed out'), { timedOut: true }),
              );
            },
          });
        });
      });
    });

    it('shares four slots across both methods and starts queued commands in FIFO order', async () => {
      const probe = new GitProbe();
      const requests = [
        probe.status('D:\\one'),
        probe.trackedNames('D:\\two', ['.next']),
        probe.status('D:\\three'),
        probe.trackedNames('D:\\four', ['.next']),
        probe.status('D:\\five'),
        probe.trackedNames('D:\\six', ['.next']),
      ];
      const all = Promise.all(requests);
      await nextTurn();
      expect(execaMock).toHaveBeenCalledTimes(4);
      expect(active).toBe(4);
      pending[1].finish();
      await nextTurn();
      expect(execaMock).toHaveBeenCalledTimes(5);
      expect(execaMock).toHaveBeenNthCalledWith(
        5,
        'git',
        statusArgs,
        expect.objectContaining({ cwd: 'D:\\five' }),
      );
      pending[0].finish();
      await nextTurn();
      expect(execaMock).toHaveBeenCalledTimes(6);
      expect(execaMock).toHaveBeenNthCalledWith(
        6,
        'git',
        [...trackedArgs, '.next'],
        expect.objectContaining({ cwd: 'D:\\six' }),
      );
      for (const index of [2, 3, 4, 5]) pending[index].finish();
      await expect(all).resolves.toHaveLength(6);
      expect(maximum).toBe(4);
      expect(active).toBe(0);
    });

    it.each(['status', 'trackedNames'] as const)(
      'cancels a queued %s without starting git or blocking the next waiter',
      async (method) => {
        const probe = new GitProbe();
        const running = Array.from({ length: 4 }, (_, index) =>
          probe.status(`D:\\active-${index}`),
        );
        const controller = new AbortController();
        let cancelledResult: GitStatusResult | GitTrackedResult | undefined;
        const request: Promise<GitStatusResult | GitTrackedResult> =
          method === 'status'
            ? probe.status('D:\\cancelled', controller.signal)
            : probe.trackedNames('D:\\cancelled', ['.next'], controller.signal);
        const cancelled = request.then((result) => {
          cancelledResult = result;
          return result;
        });
        const next = probe.status('D:\\next');
        const all = Promise.all([...running, cancelled, next]);
        await nextTurn();
        expect(execaMock).toHaveBeenCalledTimes(4);
        controller.abort();
        await nextTurn();
        // Cancellation must settle while all four slots are still occupied.
        expect(cancelledResult).toEqual({
          state: 'unknown',
          reason: 'cancelled',
        });
        expect(execaMock).toHaveBeenCalledTimes(4);
        pending[0].finish();
        await nextTurn();
        expect(execaMock).toHaveBeenCalledTimes(5);
        expect(execaMock).toHaveBeenNthCalledWith(
          5,
          'git',
          statusArgs,
          expect.objectContaining({ cwd: 'D:\\next' }),
        );
        for (const index of [1, 2, 3, 4]) pending[index].finish();
        await all;
        expect(maximum).toBe(4);
      },
    );

    it('releases a slot after failure so the queue can continue', async () => {
      const probe = new GitProbe();
      const requests = Array.from({ length: 5 }, (_, index) =>
        probe.status(`D:\\project-${index}`),
      );
      const all = Promise.all(requests);
      await nextTurn();
      expect(execaMock).toHaveBeenCalledTimes(4);
      pending[0].fail();
      await nextTurn();
      expect(execaMock).toHaveBeenCalledTimes(5);
      await expect(requests[0]).resolves.toEqual({
        state: 'unknown',
        reason: 'timeout',
      });
      for (const index of [1, 2, 3, 4]) pending[index].finish();
      await all;
      expect(maximum).toBe(4);
    });
  });
});
