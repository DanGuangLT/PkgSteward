import type { IProcessSnapshot } from '@/platform/interfaces/process-snapshot.interface';
import { UnsupportedProcessSnapshot } from '@/platform/unsupported-process-snapshot';
import { WindowsProcessSnapshot } from '@/platform/windows/windows-process-snapshot';

export const createProcessSnapshot = (
  platform: NodeJS.Platform,
): IProcessSnapshot =>
  platform === 'win32'
    ? new WindowsProcessSnapshot()
    : new UnsupportedProcessSnapshot();
