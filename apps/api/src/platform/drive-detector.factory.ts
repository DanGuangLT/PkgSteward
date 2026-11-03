import type { IDriveDetector } from '@/platform/interfaces/drive-detector.interface';
import { UnsupportedDriveDetector } from '@/platform/unsupported-drive-detector';
import { WindowsDriveDetector } from '@/platform/windows/windows-drive-detector';

export const createDriveDetector = (
  platform: NodeJS.Platform,
): IDriveDetector =>
  platform === 'win32'
    ? new WindowsDriveDetector()
    : new UnsupportedDriveDetector(platform);
