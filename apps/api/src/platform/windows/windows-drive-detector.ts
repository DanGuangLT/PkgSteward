import { execa } from 'execa';
import { InternalServerException } from '@/common/exceptions/app.exception';
import type { IDriveDetector } from '@/platform/interfaces/drive-detector.interface';

// D9: lệnh hằng — KHÔNG BAO GIỜ ghép input người dùng vào đây.
export const FIXED_DRIVES_COMMAND =
  'Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { $_.DeviceID }';
export const DRIVE_DETECT_TIMEOUT_MS = 10_000;

export const parseFixedDrives = (stdout: string): string[] => {
  const drives = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[A-Za-z]:$/.test(line))
    .map((line) => `${line.toUpperCase()}\\`);
  return [...new Set(drives)].sort();
};

export class WindowsDriveDetector implements IDriveDetector {
  async listFixedDrives(): Promise<string[]> {
    try {
      const { stdout } = await execa(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', FIXED_DRIVES_COMMAND],
        { timeout: DRIVE_DETECT_TIMEOUT_MS },
      );
      return parseFixedDrives(stdout);
    } catch (error) {
      throw new InternalServerException(
        `Failed to detect fixed drives: ${(error as Error).message}`,
      );
    }
  }
}
