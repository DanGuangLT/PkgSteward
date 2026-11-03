jest.mock('execa', () => ({ execa: jest.fn() }));

import { Logger } from '@nestjs/common';
import { execa } from 'execa';
import {
  PROCESS_SNAPSHOT_SCRIPT,
  PROCESS_SNAPSHOT_TIMEOUT_MS,
  WindowsProcessSnapshot,
} from '@/platform/windows/windows-process-snapshot';

const execaMock = execa as unknown as jest.Mock<
  Promise<{ stdout: string }>,
  [string, readonly string[], object]
>;
const systemRoot = 'C:\\Windows';
const powershell =
  'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const commandLine = 'node "D:\\Dự án\\server.js" --secret=PRIVATE_COMMAND_LINE';
const rawProcess = {
  ProcessId: 123,
  Name: 'node.exe',
  ExecutablePath: 'C:\\node\\node.exe',
  CommandLine: commandLine,
  ParentProcessId: 100,
  CreationDate: '2026-11-03T02:00:00.000Z',
};
const processInfo = {
  pid: 123,
  name: 'node.exe',
  executablePath: 'C:\\node\\node.exe',
  commandLine,
  parentPid: 100,
  creationTime: '2026-11-03T02:00:00.000Z',
};

describe('WindowsProcessSnapshot runner identity and bounds', () => {
  beforeEach(() => execaMock.mockReset());

  it.each([
    undefined,
    '',
    'Windows',
    'C:Windows',
    '\\Windows',
    '\\\\server\\Windows',
    '\\\\?\\C:\\Windows',
  ])(
    'refuses non-local SystemRoot %j without launching a helper',
    async (value) => {
      // Supply a missing validated value as empty, avoiding the host env default.
      const snapshot = new WindowsProcessSnapshot(value ?? '');
      await expect(snapshot.capture()).resolves.toMatchObject({
        status: 'unknown',
      });
      expect(execaMock).not.toHaveBeenCalled();
    },
  );

  it('keeps absolute helper paths as one file argument even with spaces', async () => {
    execaMock.mockResolvedValue({ stdout: '[]' });
    await new WindowsProcessSnapshot('C:\\Windows Space').capture();
    expect(execaMock).toHaveBeenCalledWith(
      'C:\\Windows Space\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', PROCESS_SNAPSHOT_SCRIPT],
      expect.objectContaining({
        timeout: 10_000,
        shell: false,
        preferLocal: false,
      }),
    );
  });

  it.each([
    [null, null, null, null],
    ['100', 'bad date', null, null],
    [-1, 123, null, null],
    [1.5, '', null, null],
    [0, '/Date(0)/', 0, '1970-01-01T00:00:00.000Z'],
  ])(
    'normalizes CIM metadata %j/%j safely',
    async (parent, created, parentPid, creationTime) => {
      execaMock.mockResolvedValue({
        stdout: JSON.stringify({
          ...rawProcess,
          ParentProcessId: parent,
          CreationDate: created,
        }),
      });
      await expect(
        new WindowsProcessSnapshot(systemRoot).capture(),
      ).resolves.toEqual({
        status: 'ok',
        processes: [{ ...processInfo, parentPid, creationTime }],
      });
    },
  );

  it('accepts the 100000-record boundary and rejects 100001 records', async () => {
    const entries = Array.from({ length: 100_000 }, (_, pid) => ({
      ProcessId: pid,
    }));
    execaMock.mockResolvedValueOnce({ stdout: JSON.stringify(entries) });
    const accepted = await new WindowsProcessSnapshot(systemRoot).capture();
    expect(accepted.status).toBe('ok');
    if (accepted.status === 'ok')
      expect(accepted.processes).toHaveLength(100_000);
    entries.push({ ProcessId: 100_000 });
    execaMock.mockResolvedValueOnce({ stdout: JSON.stringify(entries) });
    await expect(
      new WindowsProcessSnapshot(systemRoot).capture(),
    ).resolves.toMatchObject({ status: 'unknown' });
  });

  it('bounds raw UTF-8 output at 16MiB even when a mocked helper ignores maxBuffer', async () => {
    execaMock.mockResolvedValue({
      stdout: JSON.stringify({
        ...rawProcess,
        CommandLine: 'ệ'.repeat(6 * 1024 * 1024),
      }),
    });
    await expect(
      new WindowsProcessSnapshot(systemRoot).capture(),
    ).resolves.toMatchObject({ status: 'unknown' });
  });

  it('maps execa maxBuffer overflow to unknown rather than a partial snapshot', async () => {
    execaMock.mockRejectedValue({ isMaxBuffer: true });
    await expect(
      new WindowsProcessSnapshot(systemRoot).capture(),
    ).resolves.toMatchObject({ status: 'unknown' });
  });
});

describe('WindowsProcessSnapshot', () => {
  beforeEach(() => execaMock.mockReset());
  afterEach(() => jest.restoreAllMocks());

  it('keeps UTF-8 output and the CIM projection in a constant script', () => {
    expect(PROCESS_SNAPSHOT_SCRIPT).toContain(
      "$ErrorActionPreference = 'Stop'",
    );
    expect(PROCESS_SNAPSHOT_SCRIPT).toContain(
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    );
    expect(PROCESS_SNAPSHOT_SCRIPT).toContain(
      'Get-CimInstance -ClassName Win32_Process',
    );
    expect(PROCESS_SNAPSHOT_SCRIPT).toContain(
      'Select-Object ProcessId,Name,ExecutablePath,CommandLine,ParentProcessId,CreationDate',
    );
    expect(PROCESS_SNAPSHOT_SCRIPT).toContain('ConvertTo-Json -Compress');
  });

  it('captures once with the constant script, a 10s timeout and a hidden window', async () => {
    execaMock.mockResolvedValue({ stdout: JSON.stringify(rawProcess) });
    await expect(
      new WindowsProcessSnapshot(systemRoot).capture(),
    ).resolves.toEqual({
      status: 'ok',
      processes: [processInfo],
    });
    expect(execaMock).toHaveBeenCalledTimes(1);
    expect(PROCESS_SNAPSHOT_TIMEOUT_MS).toBe(10_000);
    expect(execaMock).toHaveBeenCalledWith(
      powershell,
      ['-NoProfile', '-NonInteractive', '-Command', PROCESS_SNAPSHOT_SCRIPT],
      expect.objectContaining({
        timeout: 10_000,
        windowsHide: true,
        shell: false,
        preferLocal: false,
        stdin: 'ignore',
        maxBuffer: 16 * 1024 * 1024,
      }),
    );
  });

  it('parses arrays and drops invalid IDs while normalizing nullable fields', async () => {
    execaMock.mockResolvedValue({
      stdout: JSON.stringify([
        rawProcess,
        null,
        {},
        { ProcessId: '123' },
        { ProcessId: null },
        { ProcessId: 124, Name: null, ExecutablePath: null, CommandLine: null },
      ]),
    });
    await expect(
      new WindowsProcessSnapshot(systemRoot).capture(),
    ).resolves.toEqual({
      status: 'ok',
      processes: [
        processInfo,
        {
          pid: 124,
          name: '',
          executablePath: null,
          commandLine: null,
          parentPid: null,
          creationTime: null,
        },
      ],
    });
  });

  it.each(['', ' \r\n', '[]'])(
    'parses empty output %j as an empty snapshot',
    async (stdout) => {
      execaMock.mockResolvedValue({ stdout });
      await expect(
        new WindowsProcessSnapshot(systemRoot).capture(),
      ).resolves.toEqual({
        status: 'ok',
        processes: [],
      });
    },
  );

  it('turns broken JSON into bad_output', async () => {
    execaMock.mockResolvedValue({ stdout: '{broken' });
    await expect(
      new WindowsProcessSnapshot(systemRoot).capture(),
    ).resolves.toEqual({
      status: 'unknown',
      reason: 'bad_output',
    });
  });

  it.each([
    [{ timedOut: true }, 'timeout'],
    [{ code: 'ENOENT' }, 'failed'],
    [new Error('access denied'), 'failed'],
  ])('maps %j to unknown/%s', async (error, reason) => {
    execaMock.mockRejectedValue(error);
    await expect(
      new WindowsProcessSnapshot(systemRoot).capture(),
    ).resolves.toEqual({
      status: 'unknown',
      reason,
    });
  });

  it.each(['success', 'bad_output', 'failed'])(
    'does not log command lines on %s',
    async (outcome) => {
      const spies = [
        jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined),
        jest
          .spyOn(Logger.prototype, 'warn')
          .mockImplementation(() => undefined),
        jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation(() => undefined),
        jest
          .spyOn(Logger.prototype, 'debug')
          .mockImplementation(() => undefined),
        jest
          .spyOn(Logger.prototype, 'verbose')
          .mockImplementation(() => undefined),
        jest
          .spyOn(Logger.prototype, 'fatal')
          .mockImplementation(() => undefined),
      ];
      if (outcome === 'failed')
        execaMock.mockRejectedValue({
          stderr: commandLine,
          stdout: commandLine,
          message: commandLine,
        });
      else
        execaMock.mockResolvedValue({
          stdout:
            outcome === 'success' ? JSON.stringify(rawProcess) : commandLine,
        });
      const result = await new WindowsProcessSnapshot(systemRoot).capture();
      expect(result.status).toBe(outcome === 'success' ? 'ok' : 'unknown');
      for (const spy of spies)
        expect(JSON.stringify(spy.mock.calls)).not.toContain(
          'PRIVATE_COMMAND_LINE',
        );
    },
  );
});
