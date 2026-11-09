jest.mock('execa', () => ({ execa: jest.fn() }));

import { execa } from 'execa';
import { createProcessSnapshot } from '@/platform/processes/process-snapshot.factory';
import { UnsupportedProcessSnapshot } from '@/platform/processes/unsupported-process-snapshot';
import { WindowsProcessSnapshot } from '@/platform/windows/windows-process-snapshot';

describe('createProcessSnapshot', () => {
  beforeEach(() => jest.clearAllMocks());

  it('selects the Windows adapter without capturing at startup', () => {
    expect(createProcessSnapshot('win32')).toBeInstanceOf(
      WindowsProcessSnapshot,
    );
    expect(execa).not.toHaveBeenCalled();
  });

  it.each<NodeJS.Platform>(['linux', 'darwin'])(
    'selects the unsupported adapter on %s',
    (platform) => {
      expect(createProcessSnapshot(platform)).toBeInstanceOf(
        UnsupportedProcessSnapshot,
      );
      expect(execa).not.toHaveBeenCalled();
    },
  );
});
