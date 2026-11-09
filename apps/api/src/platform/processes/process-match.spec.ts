import type { IProcessInfo } from '@/platform/interfaces/process-snapshot.interface';
import { matchProcessesToRoots } from '@/platform/processes/process-match';

const info = (overrides: Partial<IProcessInfo> = {}): IProcessInfo => ({
  pid: 42,
  name: 'node.exe',
  executablePath: null,
  commandLine: null,
  ...overrides,
});

describe('matchProcessesToRoots', () => {
  it.each<[string | null, boolean]>([
    ['node D:\\app\\server.js', true],
    ['node D:/app/server.js', true],
    ['node d:/APP/server.js', true],
    ['"D:\\app"', true],
    ["'D:\\app'", true],
    ['D:\\app --watch', true],
    ['D:\\app\t--watch', true],
    ['D:\\app', true],
    ['node D:\\app2\\server.js', false],
    ['node D:\\app-old\\server.js', false],
    ['D:\\app2 then D:\\app\\server.js', true],
    [null, false],
  ])(
    'matches command line %j at path boundaries: %s',
    (commandLine, matches) => {
      expect(
        matchProcessesToRoots(
          [info({ commandLine })],
          ['D:\\app'],
          'win32',
          999,
        ),
      ).toEqual(
        new Map([['D:\\app', matches ? [{ pid: 42, name: 'node.exe' }] : []]]),
      );
    },
  );

  it('matches executable paths with null command lines and preserves the original root key', () => {
    expect(
      matchProcessesToRoots(
        [info({ executablePath: 'd:/APP/bin/node.exe' })],
        ['D:\\App\\'],
        'win32',
        999,
      ),
    ).toEqual(new Map([['D:\\App\\', [{ pid: 42, name: 'node.exe' }]]]));
  });

  it('excludes the backend PID', () => {
    expect(
      matchProcessesToRoots(
        [info({ commandLine: 'D:\\app' })],
        ['D:\\app'],
        'win32',
        42,
      ),
    ).toEqual(new Map([['D:\\app', []]]));
  });

  it('matches multiple roots once each even when both fields and repeated occurrences match', () => {
    expect(
      matchProcessesToRoots(
        [
          info({
            executablePath: 'D:\\app\\node.exe',
            commandLine: 'D:\\app D:\\app\\x D:\\other\\y',
          }),
        ],
        ['D:\\app', 'D:\\other', 'D:\\unused'],
        'win32',
        999,
      ),
    ).toEqual(
      new Map([
        ['D:\\app', [{ pid: 42, name: 'node.exe' }]],
        ['D:\\other', [{ pid: 42, name: 'node.exe' }]],
        ['D:\\unused', []],
      ]),
    );
  });

  it('keeps distinct processes for the same root without exposing command lines', () => {
    const processes = [
      info({ commandLine: 'D:\\app' }),
      info({ pid: 43, name: 'code.exe', commandLine: 'D:\\app' }),
    ];
    expect(matchProcessesToRoots(processes, ['D:\\app'], 'win32', 999)).toEqual(
      new Map([
        [
          'D:\\app',
          [
            { pid: 42, name: 'node.exe' },
            { pid: 43, name: 'code.exe' },
          ],
        ],
      ]),
    );
  });

  it.each<[string, boolean]>([
    ['/work/app/server.js', true],
    ['/work/App/server.js', false],
    ['/work/app2/server.js', false],
    ['/work/app-old/server.js', false],
    ['/work/app\\server.js', false],
    ['"/work/app"', true],
  ])('uses case-sensitive POSIX boundaries for %s', (commandLine, matches) => {
    expect(
      matchProcessesToRoots(
        [info({ commandLine })],
        ['/work/app/'],
        'linux',
        999,
      ),
    ).toEqual(
      new Map([['/work/app/', matches ? [{ pid: 42, name: 'node.exe' }] : []]]),
    );
  });

  it('returns empty buckets for no processes and no buckets for no roots', () => {
    expect(matchProcessesToRoots([], ['D:\\app'], 'win32', 999)).toEqual(
      new Map([['D:\\app', []]]),
    );
    expect(matchProcessesToRoots([info()], [], 'win32', 999)).toEqual(
      new Map(),
    );
  });
});
