import type { IRecycleBin } from '@/platform/interfaces/recycle-bin.interface';
import { UnsupportedRecycleBin } from '@/platform/unsupported-recycle-bin';
import { WindowsRecycleBin } from '@/platform/windows/windows-recycle-bin';

export const createRecycleBin = (platform: NodeJS.Platform): IRecycleBin =>
  platform === 'win32'
    ? new WindowsRecycleBin()
    : new UnsupportedRecycleBin(platform);
