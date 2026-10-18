jest.mock('execa', () => ({ execa: jest.fn() }));

import { execa } from 'execa';
import { InternalServerException } from '@/common/exceptions/app.exception';
import {
  DRIVE_DETECT_TIMEOUT_MS,
  FIXED_DRIVES_COMMAND,
  parseFixedDrives,
  WindowsDriveDetector,
} from '@/platform/windows/windows-drive-detector';

const execaMock = execa as unknown as jest.Mock;

describe('parseFixedDrives', () => {
  it('turns DeviceID lines into sorted, unique drive roots', () =>
    expect(parseFixedDrives('D:\r\nC:\r\n\r\nc:\r\n')).toEqual([
      'C:\\',
      'D:\\',
    ]));
  it('ignores anything that is not a drive letter', () =>
    expect(parseFixedDrives('WARNING: x\nC:\nAB:\n')).toEqual(['C:\\']));
  it('returns [] for empty output', () =>
    expect(parseFixedDrives('')).toEqual([]));
});

describe('WindowsDriveDetector', () => {
  beforeEach(() => execaMock.mockReset());

  it('runs the constant CIM command with an argument array and a 10s timeout', async () => {
    execaMock.mockResolvedValue({ stdout: 'C:\r\nD:\r\n' });
    await expect(new WindowsDriveDetector().listFixedDrives()).resolves.toEqual(
      ['C:\\', 'D:\\'],
    );
    expect(execaMock).toHaveBeenCalledWith(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', FIXED_DRIVES_COMMAND],
      expect.objectContaining({ timeout: DRIVE_DETECT_TIMEOUT_MS }),
    );
    expect(DRIVE_DETECT_TIMEOUT_MS).toBe(10_000);
    expect(FIXED_DRIVES_COMMAND).toContain('Win32_LogicalDisk');
    expect(FIXED_DRIVES_COMMAND).toContain('DriveType=3');
  });

  it('wraps failures (timeout, missing powershell) in InternalServerException', async () => {
    execaMock.mockRejectedValue(
      new Error('Command timed out after 10000 milliseconds'),
    );
    const error = await new WindowsDriveDetector()
      .listFixedDrives()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InternalServerException);
    expect((error as Error).message).toMatch(/Failed to detect fixed drives/);
  });
});
