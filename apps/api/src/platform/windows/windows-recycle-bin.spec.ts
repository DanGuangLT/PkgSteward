jest.mock('execa', () => ({ execa: jest.fn() }));
// Fail on a filesystem import, including an attempted permanent-delete fallback.
jest.mock('fs', () => {
  throw new Error('Recycle Bin must not import fs');
});
jest.mock('node:fs', () => {
  throw new Error('Recycle Bin must not import node:fs');
});
jest.mock('fs/promises', () => {
  throw new Error('Recycle Bin must not import fs/promises');
});
jest.mock('node:fs/promises', () => {
  throw new Error('Recycle Bin must not import node:fs/promises');
});
jest.mock('fs-extra', () => {
  throw new Error('Recycle Bin must not import fs-extra');
});

import { execa } from 'execa';
import type {
  RecycleFailureCode,
  RecycleResult,
} from '@/platform/interfaces/recycle-bin.interface';
import {
  RECYCLE_SCRIPT,
  WindowsRecycleBin,
} from '@/platform/windows/windows-recycle-bin';

const execaMock = execa as unknown as jest.Mock;
const target = 'D:\\Dự án có dấu\\a\'"$`; file';

// Exactly { status, code, message } with a non-empty message that never echoes the target.
const expectFailure = (
  result: RecycleResult,
  code: RecycleFailureCode,
): void => {
  expect(result.status).toBe('failed');
  if (result.status !== 'failed') return;
  expect(Object.keys(result).sort()).toEqual(['code', 'message', 'status']);
  expect(result.code).toBe(code);
  expect(result.message.length).toBeGreaterThan(0);
  expect(result.message).not.toContain(target);
};

describe('RECYCLE_SCRIPT safety contract', () => {
  it('uses environment input and checks language, volume and bin settings before deletion', () => {
    const orderedGuards = [
      "$ErrorActionPreference = 'Stop'",
      'FullLanguage',
      '$env:PKGSTEWARD_RECYCLE_TARGET',
      '$env:PKGSTEWARD_RECYCLE_BYTES',
      'Add-Type',
      '[PkgStewardRecycle]::GetVolumePathNameW',
      '[PkgStewardRecycle]::GetDriveTypeW',
      '[PkgStewardRecycle]::GetVolumeNameForVolumeMountPointW',
      'BitBucket\\Volume',
      'NukeOnDelete',
      'MaxCapacity',
      '[PkgStewardRecycle]::Recycle(',
      'Test-Path -LiteralPath $target',
    ];
    let previous = -1;
    for (const guard of orderedGuards) {
      const offset = RECYCLE_SCRIPT.indexOf(guard);
      expect(offset).toBeGreaterThan(previous);
      previous = offset;
    }
    expect(RECYCLE_SCRIPT).toContain('[long]::TryParse');
    // DriveInfo reads the drive-letter root, so a removable volume mounted in a folder looks Fixed.
    expect(RECYCLE_SCRIPT).not.toContain('DriveInfo');
    expect(RECYCLE_SCRIPT).toMatch(/GetDriveTypeW\([^)]*\) -ne 3/);
    // The aborted flag is read inside C#, not via PowerShell [ref] struct write-back.
    expect(RECYCLE_SCRIPT).not.toContain(
      '[PkgStewardRecycle]::SHFileOperationW',
    );
    expect(RECYCLE_SCRIPT).toContain('op.fAnyOperationsAborted');
    expect(RECYCLE_SCRIPT).toContain('0x4454');
    expect(RECYCLE_SCRIPT).toContain('"\\0\\0"');
    expect(RECYCLE_SCRIPT).toContain('fAnyOperationsAborted');
    expect(RECYCLE_SCRIPT).toContain('stillExists');
    expect(RECYCLE_SCRIPT).not.toContain(target);
    expect(RECYCLE_SCRIPT).not.toMatch(
      /Remove-Item|\b(?:unlink|rmdir)\b|File\.Delete|Directory\.Delete/i,
    );
  });
});

describe('WindowsRecycleBin', () => {
  beforeEach(() => execaMock.mockReset());

  it('passes special characters only via env, with exactly one command and no timeout or cancellation', async () => {
    execaMock.mockResolvedValue({ stdout: '{"status":"recycled"}\r\n' });
    await expect(
      new WindowsRecycleBin().recycle(target, 12345),
    ).resolves.toEqual({ status: 'recycled' });
    expect(execaMock).toHaveBeenCalledTimes(1);
    expect(execaMock).toHaveBeenCalledWith(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', RECYCLE_SCRIPT],
      {
        env: {
          PKGSTEWARD_RECYCLE_TARGET: target,
          PKGSTEWARD_RECYCLE_BYTES: '12345',
        },
        windowsHide: true,
      },
    );
  });

  it.each([
    ['{"status":"disabled"}', 'RECYCLE_BIN_DISABLED'],
    ['{"status":"too_large","maxCapacityMb":10}', 'RECYCLE_BIN_TOO_SMALL'],
    [
      '{"status":"unavailable","reason":"language_mode"}',
      'RECYCLE_UNAVAILABLE',
    ],
    ['{"status":"unavailable","reason":"not_fixed"}', 'RECYCLE_UNAVAILABLE'],
    ['{"status":"failed","code":124,"aborted":false}', 'RECYCLE_FAILED'],
    ['{"status":"failed","code":0,"aborted":true}', 'RECYCLE_FAILED'],
    [
      '{"status":"failed","code":0,"aborted":false,"stillExists":true}',
      'RECYCLE_FAILED',
    ],
    ['', 'RECYCLE_FAILED'],
    ['broken JSON', 'RECYCLE_FAILED'],
    ['[{"status":"recycled"}]', 'RECYCLE_FAILED'],
    ['null', 'RECYCLE_FAILED'],
    ['"recycled"', 'RECYCLE_FAILED'],
    ['{}', 'RECYCLE_FAILED'],
    ['{"status":42}', 'RECYCLE_FAILED'],
    ['{"status":"unexpected"}', 'RECYCLE_FAILED'],
    ['{"status":"recycled"}\n{"status":"failed"}', 'RECYCLE_FAILED'],
    ['WARNING\n{"status":"recycled"}', 'RECYCLE_FAILED'],
  ] as const)(
    'maps %s to %s without another delete attempt',
    async (stdout, code) => {
      execaMock.mockResolvedValue({ stdout });
      const result = await new WindowsRecycleBin().recycle(target, 0);
      expectFailure(result, code);
      expect(execaMock).toHaveBeenCalledTimes(1);
    },
  );

  it('does not copy paths or diagnostic fields from valid JSON into the failure message', async () => {
    execaMock.mockResolvedValue({
      stdout: JSON.stringify({
        status: 'failed',
        code: 124,
        aborted: false,
        message: target,
        diagnostic: 'PRIVATE_DIAGNOSTIC',
      }),
    });
    const result = await new WindowsRecycleBin().recycle(target, 1);
    expectFailure(result, 'RECYCLE_FAILED');
    if (result.status === 'failed') {
      expect(result.message).not.toContain('PRIVATE_DIAGNOSTIC');
    }
    expect(execaMock).toHaveBeenCalledTimes(1);
  });

  // SHFileOperation expands wildcards in pFrom and resolves relative paths against the cwd.
  it.each([
    'relative\\app',
    '\\app',
    'D:app',
    'D:\\projects\\*',
    'D:\\projects\\a?b',
    'D:\\projects\\a\0b',
    '',
  ])('refuses %j before running any command', async (unsafe) => {
    const result = await new WindowsRecycleBin().recycle(unsafe, 1);
    expect(result).toMatchObject({
      status: 'failed',
      code: 'RECYCLE_UNAVAILABLE',
    });
    expect(execaMock).not.toHaveBeenCalled();
  });

  it.each([{ exitCode: 1 }, { code: 'ENOENT' }, { isTerminated: true }])(
    'returns a sanitized failure on process rejection %j',
    async (failure) => {
      execaMock.mockRejectedValue({
        ...failure,
        message: target,
        stdout: 'PRIVATE_STDOUT',
        stderr: 'PRIVATE_STDERR',
      });
      const result = await new WindowsRecycleBin().recycle(target, 1);
      expectFailure(result, 'RECYCLE_FAILED');
      expect(JSON.stringify(result)).not.toMatch(
        /PRIVATE_STDOUT|PRIVATE_STDERR/,
      );
      expect(JSON.stringify(result)).not.toContain(
        JSON.stringify(target).slice(1, -1),
      );
      expect(execaMock).toHaveBeenCalledTimes(1);
    },
  );
});
