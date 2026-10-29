jest.mock('execa', () => ({ execa: jest.fn() }));

import { Logger } from '@nestjs/common';
import { execa } from 'execa';
import {
  buildTrackedPathspecs,
  matchTrackedNames,
  GIT_FILTER_SCOPE_ARGS,
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
// Existing parser/queue tests control payload commands independently of preflight.
const commandMock = jest.fn();
const root = 'D:\\Dự án \'"$`; test';
const statusArgs = [
  '--no-optional-locks',
  '-c',
  'core.fsmonitor=false',
  'status',
  '--porcelain=v1',
  '-z',
  '--untracked-files=normal',
  '--ignore-submodules=all',
  '--',
  '.',
];
const trackedArgs = [
  '--no-optional-locks',
  '-c',
  'core.fsmonitor=false',
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
  env: { GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1' },
});
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));
const nativePathspec = (name: string) =>
  `${process.platform === 'win32' ? ':(literal,icase)' : ':(literal)'}${name}`;
const filterArgs = [
  '--no-optional-locks',
  'config',
  '--show-scope',
  '--name-only',
  '--get-regexp',
  '^(filter\\.|remote\\..+\\.promisor$|extensions\\.partialclone$)',
];

describe('GitProbe lazy-fetch protection', () => {
  beforeEach(() => execaMock.mockReset());

  it.each(['status', 'trackedNames'] as const)(
    'disables lazy fetch for every command issued by %s',
    async (operation) => {
      execaMock.mockResolvedValue({ stdout: '' });
      const probe = new GitProbe();
      if (operation === 'status') await probe.status(root);
      else await probe.trackedNames(root, ['coverage']);

      expect(execaMock).toHaveBeenCalledTimes(operation === 'status' ? 2 : 1);
      for (const call of execaMock.mock.calls as unknown[][]) {
        expect(call[2]).toMatchObject({
          env: { GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1' },
        });
      }
    },
  );

  it.each([
    'remote.origin.promisor',
    'remote.TEST.backup.promisor',
    'REMOTE.origin.PROMISOR',
    'extensions.partialClone',
    'EXTENSIONS.PARTIALCLONE',
    'filter.lfs.clean',
    'filter.TEST.process',
  ])('includes unsafe config key %s in the preflight query', async (key) => {
    execaMock.mockResolvedValue({ stdout: '' });
    await new GitProbe().status(root);
    const args = (
      execaMock.mock.calls as unknown[][]
    )[0][1] as readonly string[];
    const pattern = args[args.indexOf('--get-regexp') + 1];
    // Git config matches section and variable names without case sensitivity.
    expect(new RegExp(pattern, 'i').test(key)).toBe(true);
  });

  describe.each(['local', 'worktree', 'command'])(
    'partial-clone config in %s scope',
    (scope) => {
      it.each(['remote.origin.promisor', 'extensions.partialClone'])(
        'refuses %s without running status',
        async (key) => {
          execaMock.mockImplementation(
            (_command: string, args: readonly string[]) => {
              if (!args.includes('config'))
                return Promise.resolve({ stdout: '' });
              const pattern = args[args.indexOf('--get-regexp') + 1];
              // Honor the actual query: an unchanged filter-only regex must
              // not accidentally receive a promisor key from this mock.
              return new RegExp(pattern, 'i').test(key)
                ? Promise.resolve({ stdout: `${scope}\t${key}\n` })
                : Promise.reject(
                    Object.assign(new Error('TEST no matching config'), {
                      exitCode: 1,
                      stdout: '',
                    }),
                  );
            },
          );
          await expect(new GitProbe().status(root)).resolves.toEqual({
            state: 'unknown',
            reason: 'unsafe_config',
          });
          expect(execaMock).toHaveBeenCalledTimes(1);
        },
      );
    },
  );

  it.each(['system', 'global'])(
    'continues to trust partial-clone config in %s scope',
    async (scope) => {
      execaMock
        .mockResolvedValueOnce({
          stdout: `${scope}\tremote.origin.promisor\n${scope}\textensions.partialclone\n`,
        })
        .mockResolvedValueOnce({ stdout: '' });
      await expect(new GitProbe().status(root)).resolves.toEqual({
        state: 'clean',
      });
      expect(execaMock).toHaveBeenCalledTimes(2);
    },
  );
});

describe('GitProbe filter preflight', () => {
  beforeEach(() => execaMock.mockReset());

  it('runs filter config then status with identical bounded, shell-free options', async () => {
    const controller = new AbortController();
    execaMock
      .mockResolvedValueOnce({ stdout: '' })
      .mockResolvedValueOnce({ stdout: ' M changed.txt\0' });
    await expect(
      new GitProbe().status(root, controller.signal),
    ).resolves.toEqual({ state: 'dirty', changedCount: 1 });
    expect(GIT_FILTER_SCOPE_ARGS).toEqual(filterArgs);
    expect(execaMock).toHaveBeenCalledTimes(2);
    expect(execaMock).toHaveBeenNthCalledWith(
      1,
      'git',
      filterArgs,
      options(controller.signal),
    );
    expect(execaMock).toHaveBeenNthCalledWith(
      2,
      'git',
      statusArgs,
      options(controller.signal),
    );
  });

  it.each([
    'local\tfilter.evil.clean\n',
    'worktree\tfilter.evil.clean\n',
    'command\tfilter.evil.clean\n',
    'system\tfilter.lfs.clean\nlocal\tfilter.evil.process\n',
    'unknown\tfilter.evil.clean\n',
    'local filter.evil.clean\n',
    'system filter.evil.clean\n',
    'global\t\n',
    '\tfilter.evil.clean\n',
    'global\tfilter.lfs.clean\textra\n',
    'broken\n',
  ])(
    'refuses unsafe or malformed scope output %j without running status',
    async (stdout) => {
      execaMock.mockResolvedValue({ stdout });
      await expect(new GitProbe().status(root)).resolves.toEqual({
        state: 'unknown',
        reason: 'unsafe_config',
      });
      expect(execaMock).toHaveBeenCalledTimes(1);
      expect(execaMock).toHaveBeenCalledWith('git', filterArgs, options());
    },
  );

  it.each([
    '',
    'system\tfilter.lfs.clean\nglobal\tfilter.lfs.process\n',
    '\r\nsystem\tfilter.lfs.clean\r\nglobal\tfilter.lfs.smudge\r\n\r\n',
  ])(
    'allows only trusted filters or empty config output %j',
    async (stdout) => {
      execaMock
        .mockResolvedValueOnce({ stdout })
        .mockResolvedValueOnce({ stdout: '' });
      await expect(new GitProbe().status(root)).resolves.toEqual({
        state: 'clean',
      });
      expect(execaMock).toHaveBeenCalledTimes(2);
      expect(execaMock).toHaveBeenNthCalledWith(
        2,
        'git',
        statusArgs,
        options(),
      );
    },
  );

  it('treats config exit 1 with empty stdout as no matching filter keys', async () => {
    execaMock
      .mockRejectedValueOnce(
        Object.assign(new Error('no match'), { exitCode: 1, stdout: '' }),
      )
      .mockResolvedValueOnce({ stdout: '' });
    await expect(new GitProbe().status(root)).resolves.toEqual({
      state: 'clean',
    });
    expect(execaMock).toHaveBeenCalledTimes(2);
    expect(execaMock).toHaveBeenNthCalledWith(1, 'git', filterArgs, options());
    expect(execaMock).toHaveBeenNthCalledWith(2, 'git', statusArgs, options());
  });

  it.each([
    [
      { exitCode: 128, stderr: 'fatal: not a git repository (or any parent)' },
      { state: 'not_repo' },
    ],
    [{ code: 'ENOENT' }, { state: 'unknown', reason: 'git_missing' }],
    [{ timedOut: true }, { state: 'unknown', reason: 'timeout' }],
    [{ isCanceled: true }, { state: 'unknown', reason: 'cancelled' }],
    [
      { exitCode: 1, stdout: 'local\tfilter.evil.clean\n' },
      { state: 'unknown', reason: 'failed' },
    ],
    [{ exitCode: 1 }, { state: 'unknown', reason: 'failed' }],
    [
      { exitCode: 128, stderr: 'dubious ownership' },
      { state: 'unknown', reason: 'failed' },
    ],
  ])(
    'maps config failure %j and never starts status',
    async (error, expected) => {
      execaMock.mockRejectedValue(
        Object.assign(new Error('config failed'), error),
      );
      await expect(new GitProbe().status(root)).resolves.toEqual(expected);
      expect(execaMock).toHaveBeenCalledTimes(1);
      expect(execaMock).toHaveBeenCalledWith('git', filterArgs, options());
    },
  );

  it.each([false, true])(
    'honors abort between config and status (no-match=%s)',
    async (noMatch) => {
      const controller = new AbortController();
      execaMock.mockImplementation(() => {
        controller.abort();
        return noMatch
          ? Promise.reject(
              Object.assign(new Error('no match'), { exitCode: 1, stdout: '' }),
            )
          : Promise.resolve({ stdout: '' });
      });
      await expect(
        new GitProbe().status(root, controller.signal),
      ).resolves.toEqual({ state: 'unknown', reason: 'cancelled' });
      expect(execaMock).toHaveBeenCalledTimes(1);
      expect(execaMock).toHaveBeenCalledWith(
        'git',
        filterArgs,
        options(controller.signal),
      );
    },
  );

  it('keeps one FIFO slot through both commands and never exceeds four active commands', async () => {
    const pending: (() => void)[] = [];
    const trace: { args: readonly string[]; cwd: string }[] = [];
    let active = 0;
    let maximum = 0;
    execaMock.mockImplementation(
      (_command: string, args: readonly string[], opts: { cwd: string }) => {
        trace.push({ args, cwd: opts.cwd });
        active++;
        maximum = Math.max(maximum, active);
        return new Promise<{ stdout: string }>((resolve) => {
          pending.push(() => {
            active--;
            resolve({ stdout: '' });
          });
        });
      },
    );
    const probe = new GitProbe();
    const requests = Array.from({ length: 6 }, (_, i) =>
      probe.status(`D:\\p${i}`),
    );
    await nextTurn();
    const initialTrace = trace.slice();
    pending.shift()?.();
    await nextTurn();
    const fifth = trace[4];
    // Drain finite mocked commands before assertions, including the old one-command implementation.
    for (let round = 0; round < 12; round++) {
      pending.shift()?.();
      await nextTurn();
    }
    await expect(Promise.all(requests)).resolves.toEqual(
      Array.from({ length: 6 }, () => ({ state: 'clean' })),
    );
    expect(initialTrace).toEqual(
      [0, 1, 2, 3].map((i) => ({ args: filterArgs, cwd: `D:\\p${i}` })),
    );
    expect(fifth).toEqual({ args: statusArgs, cwd: 'D:\\p0' });
    expect(trace).toHaveLength(12);
    expect(maximum).toBe(4);
    expect(active).toBe(0);
    for (let i = 0; i < 6; i++) {
      expect(
        trace.filter(({ cwd }) => cwd === `D:\\p${i}`).map(({ args }) => args),
      ).toEqual([filterArgs, statusArgs]);
    }
  });

  it('does not block a later request after unsafe config', async () => {
    execaMock
      .mockResolvedValueOnce({ stdout: 'local\tfilter.evil.clean\n' })
      .mockResolvedValue({ stdout: '' });
    const probe = new GitProbe();
    await expect(probe.status(root)).resolves.toEqual({
      state: 'unknown',
      reason: 'unsafe_config',
    });
    await expect(probe.status(root)).resolves.toEqual({ state: 'clean' });
    expect(execaMock).toHaveBeenCalledTimes(3);
  });
});

describe('tracked pathspec policy', () => {
  beforeEach(() => execaMock.mockReset());

  it('uses literal, case-insensitive Windows pathspecs even for metacharacters', () => {
    expect(
      buildTrackedPathspecs(
        ['.next', 'with space', 'tiếng Việt 🚀', '*', ':(glob)*'],
        'win32',
      ),
    ).toEqual([
      ':(literal,icase).next',
      ':(literal,icase)with space',
      ':(literal,icase)tiếng Việt 🚀',
      ':(literal,icase)*',
      ':(literal,icase):(glob)*',
    ]);
  });

  it('uses literal, case-sensitive POSIX pathspecs', () => {
    expect(
      buildTrackedPathspecs(
        ['.next', 'with space', 'tiếng Việt 🚀', '*', ':(glob)*'],
        'posix',
      ),
    ).toEqual([
      ':(literal).next',
      ':(literal)with space',
      ':(literal)tiếng Việt 🚀',
      ':(literal)*',
      ':(literal):(glob)*',
    ]);
  });

  it('matches case differences on Windows and retains requested spelling and order', () => {
    expect(
      matchTrackedNames(
        ['coverage', '.next', 'TIẾNG VIỆT', 'untracked'],
        ['.NEXT/a', 'tiếng việt/x', 'COVERAGE', '.NEXT/b', '.nextjs/x'],
        'win32',
      ),
    ).toEqual(['coverage', '.next', 'TIẾNG VIỆT']);
  });

  it('does not match case differences on POSIX', () => {
    expect(
      matchTrackedNames(
        ['.next', 'coverage'],
        ['.NEXT/a', 'coverage/x'],
        'posix',
      ),
    ).toEqual(['coverage']);
  });

  it.each(['win32', 'posix'] as const)(
    'requires an exact name or directory boundary on %s',
    (platform) => {
      expect(
        matchTrackedNames(
          ['.next', 'coverage', '*', ':(glob)*', 'with space', 'tiếng Việt'],
          [
            '.nextjs/x',
            'coverage-old/a',
            '*/file',
            ':(glob)*/x',
            'with space',
            'tiếng Việt/a',
          ],
          platform,
        ),
      ).toEqual(['*', ':(glob)*', 'with space', 'tiếng Việt']);
      expect(matchTrackedNames(['.next'], ['.next'], platform)).toEqual([
        '.next',
      ]);
    },
  );

  it('handles empty names and empty output', () => {
    expect(buildTrackedPathspecs([], 'win32')).toEqual([]);
    expect(matchTrackedNames([], ['.next/a'], 'win32')).toEqual([]);
    expect(matchTrackedNames(['.next'], [], 'win32')).toEqual([]);
  });

  it('passes platform pathspecs to ls-files without the incompatible global literal switch', async () => {
    const names = ['.next', 'with space', '*', ':(glob)*'];
    execaMock.mockResolvedValue({ stdout: '.NEXT/a\0' });
    await expect(new GitProbe().trackedNames(root, names)).resolves.toEqual({
      state: 'ok',
      tracked: process.platform === 'win32' ? ['.next'] : [],
    });
    expect(GIT_TRACKED_ARGS).not.toContain('--literal-pathspecs');
    expect(execaMock).toHaveBeenCalledTimes(1);
    expect(execaMock).toHaveBeenCalledWith(
      'git',
      [...trackedArgs, ...names.map(nativePathspec)],
      options(),
    );
  });
});

describe('GitProbe', () => {
  beforeEach(() => {
    commandMock.mockReset();
    execaMock
      .mockReset()
      .mockImplementation(
        (command: string, args: readonly string[], opts: unknown) => {
          if (args.includes('config')) return Promise.resolve({ stdout: '' });
          return commandMock(command, args, opts) as Promise<{
            stdout: string;
          }>;
        },
      );
  });
  afterEach(() => jest.restoreAllMocks());

  it('declares read-only command arrays and bounded probes', () => {
    expect(GIT_STATUS_ARGS).toEqual(statusArgs);
    expect(GIT_TRACKED_ARGS).toEqual(trackedArgs);
    expect(GIT_PROBE_TIMEOUT_MS).toBe(30_000);
    expect(GIT_PROBE_CONCURRENCY).toBe(4);
  });

  it('runs status with the exact arguments and forwards cancellation', async () => {
    const controller = new AbortController();
    commandMock.mockResolvedValue({ stdout: '' });
    await expect(
      new GitProbe().status(root, controller.signal),
    ).resolves.toEqual({ state: 'clean' });
    expect(commandMock).toHaveBeenCalledTimes(1);
    expect(commandMock).toHaveBeenCalledWith(
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
    commandMock.mockResolvedValue({ stdout });
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
    commandMock.mockResolvedValue({
      stdout: '.next/x\0file name.txt\0coverage/a\0.next/y\0:(glob)*/file\0',
    });
    await expect(
      new GitProbe().trackedNames(root, names, controller.signal),
    ).resolves.toEqual({
      state: 'ok',
      tracked: ['coverage', '.next', 'file name.txt', ':(glob)*'],
    });
    expect(commandMock).toHaveBeenCalledTimes(1);
    expect(commandMock).toHaveBeenCalledWith(
      'git',
      [...trackedArgs, ...names.map(nativePathspec)],
      options(controller.signal),
    );
  });

  it('does not mistake a name prefix for a tracked directory', async () => {
    commandMock.mockResolvedValue({ stdout: '.nextjs/x\0coverage-old/y\0' });
    await expect(
      new GitProbe().trackedNames(root, ['.next', 'coverage']),
    ).resolves.toEqual({ state: 'ok', tracked: [] });
  });

  it('supports exact matches, Unicode and newlines in names', async () => {
    commandMock.mockResolvedValue({
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
    commandMock.mockResolvedValue({ stdout: '' });
    await expect(new GitProbe().trackedNames(root, ['.next'])).resolves.toEqual(
      { state: 'ok', tracked: [] },
    );
  });

  it('does not invoke git for empty requested names', async () => {
    await expect(new GitProbe().trackedNames(root, [])).resolves.toEqual({
      state: 'ok',
      tracked: [],
    });
    expect(commandMock).not.toHaveBeenCalled();
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
        commandMock.mockRejectedValue(error);
        await expect(invoke(new GitProbe())).resolves.toEqual(expected);
      });

      it('recognizes an aborted signal even without execa cancellation metadata', async () => {
        const controller = new AbortController();
        commandMock.mockImplementation(() => {
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
        expect(commandMock).not.toHaveBeenCalled();
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
    commandMock.mockRejectedValue({
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
      commandMock.mockImplementation(() => {
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
      expect(commandMock).toHaveBeenCalledTimes(4);
      expect(active).toBe(4);
      pending[1].finish();
      await nextTurn();
      expect(commandMock).toHaveBeenCalledTimes(5);
      expect(commandMock).toHaveBeenNthCalledWith(
        5,
        'git',
        statusArgs,
        expect.objectContaining({ cwd: 'D:\\five' }),
      );
      pending[0].finish();
      await nextTurn();
      expect(commandMock).toHaveBeenCalledTimes(6);
      expect(commandMock).toHaveBeenNthCalledWith(
        6,
        'git',
        [...trackedArgs, nativePathspec('.next')],
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
        expect(commandMock).toHaveBeenCalledTimes(4);
        controller.abort();
        await nextTurn();
        // Cancellation must settle while all four slots are still occupied.
        expect(cancelledResult).toEqual({
          state: 'unknown',
          reason: 'cancelled',
        });
        expect(commandMock).toHaveBeenCalledTimes(4);
        pending[0].finish();
        await nextTurn();
        expect(commandMock).toHaveBeenCalledTimes(5);
        expect(commandMock).toHaveBeenNthCalledWith(
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
      expect(commandMock).toHaveBeenCalledTimes(4);
      pending[0].fail();
      await nextTurn();
      expect(commandMock).toHaveBeenCalledTimes(5);
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
