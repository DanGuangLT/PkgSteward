jest.mock('execa', () => ({ execa: jest.fn() }));

import { Logger } from '@nestjs/common';
import { execa } from 'execa';
import {
  PROCESS_SNAPSHOT_SCRIPT,
  PROCESS_SNAPSHOT_TIMEOUT_MS,
  WindowsProcessSnapshot,
} from '@/platform/windows/windows-process-snapshot';

const execaMock = execa as unknown as jest.Mock;
const commandLine = 'node "D:\\Dự án\\server.js" --secret=PRIVATE_COMMAND_LINE';
const rawProcess = {
  ProcessId: 123,
  Name: 'node.exe',
  ExecutablePath: 'C:\\node\\node.exe',
  CommandLine: commandLine,
};
const processInfo = {
  pid: 123,
  name: 'node.exe',
  executablePath: 'C:\\node\\node.exe',
  commandLine,
};

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
      'Select-Object ProcessId,Name,ExecutablePath,CommandLine',
    );
    expect(PROCESS_SNAPSHOT_SCRIPT).toContain('ConvertTo-Json -Compress');
  });

  it('captures once with the constant script, a 10s timeout and a hidden window', async () => {
    execaMock.mockResolvedValue({ stdout: JSON.stringify(rawProcess) });
    await expect(new WindowsProcessSnapshot().capture()).resolves.toEqual({
      status: 'ok',
      processes: [processInfo],
    });
    expect(execaMock).toHaveBeenCalledTimes(1);
    expect(PROCESS_SNAPSHOT_TIMEOUT_MS).toBe(10_000);
    expect(execaMock).toHaveBeenCalledWith(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', PROCESS_SNAPSHOT_SCRIPT],
      { timeout: 10_000, windowsHide: true },
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
    await expect(new WindowsProcessSnapshot().capture()).resolves.toEqual({
      status: 'ok',
      processes: [
        processInfo,
        { pid: 124, name: '', executablePath: null, commandLine: null },
      ],
    });
  });

  it.each(['', ' \r\n', '[]'])(
    'parses empty output %j as an empty snapshot',
    async (stdout) => {
      execaMock.mockResolvedValue({ stdout });
      await expect(new WindowsProcessSnapshot().capture()).resolves.toEqual({
        status: 'ok',
        processes: [],
      });
    },
  );

  it('turns broken JSON into bad_output', async () => {
    execaMock.mockResolvedValue({ stdout: '{broken' });
    await expect(new WindowsProcessSnapshot().capture()).resolves.toEqual({
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
    await expect(new WindowsProcessSnapshot().capture()).resolves.toEqual({
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
      const result = await new WindowsProcessSnapshot().capture();
      expect(result.status).toBe(outcome === 'success' ? 'ok' : 'unknown');
      for (const spy of spies)
        expect(JSON.stringify(spy.mock.calls)).not.toContain(
          'PRIVATE_COMMAND_LINE',
        );
    },
  );
});
