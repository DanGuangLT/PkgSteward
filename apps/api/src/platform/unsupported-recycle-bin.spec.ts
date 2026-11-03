jest.mock('execa', () => ({ execa: jest.fn() }));

import { execa } from 'execa';
import { UnsupportedRecycleBin } from '@/platform/unsupported-recycle-bin';

describe('UnsupportedRecycleBin', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(['linux', 'darwin'])(
    'returns unavailable on %s without running a command',
    async (platform) => {
      await expect(
        new UnsupportedRecycleBin(platform).recycle('/project', 123),
      ).resolves.toEqual({
        status: 'failed',
        code: 'RECYCLE_UNAVAILABLE',
        message: `Recycle Bin is only supported on Windows (current platform: ${platform})`,
      });
      expect(execa).not.toHaveBeenCalled();
    },
  );
});
