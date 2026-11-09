jest.mock('execa', () => ({ execa: jest.fn() }));

import { execa } from 'execa';
import { createRecycleBin } from '@/platform/recycle/recycle-bin.factory';
import { UnsupportedRecycleBin } from '@/platform/recycle/unsupported-recycle-bin';
import { WindowsRecycleBin } from '@/platform/windows/windows-recycle-bin';

describe('createRecycleBin', () => {
  beforeEach(() => jest.clearAllMocks());

  it('selects the Windows adapter without running a command at startup', () => {
    expect(createRecycleBin('win32')).toBeInstanceOf(WindowsRecycleBin);
    expect(execa).not.toHaveBeenCalled();
  });

  it.each<NodeJS.Platform>(['linux', 'darwin'])(
    'selects the unsupported adapter on %s',
    (platform) => {
      expect(createRecycleBin(platform)).toBeInstanceOf(UnsupportedRecycleBin);
      expect(execa).not.toHaveBeenCalled();
    },
  );

  it('passes the actual platform to the unsupported adapter', async () => {
    await expect(
      createRecycleBin('linux').recycle('/project', 1),
    ).resolves.toEqual({
      status: 'failed',
      code: 'RECYCLE_UNAVAILABLE',
      message:
        'Recycle Bin is only supported on Windows (current platform: linux)',
    });
  });
});
