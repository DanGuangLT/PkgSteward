jest.mock('execa', () => ({ execa: jest.fn() }));

import { execa } from 'execa';
import { UnsupportedProcessSnapshot } from '@/platform/processes/unsupported-process-snapshot';

describe('UnsupportedProcessSnapshot', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns unknown without running a command', async () => {
    await expect(new UnsupportedProcessSnapshot().capture()).resolves.toEqual({
      status: 'unknown',
      reason: 'unsupported_platform',
    });
    expect(execa).not.toHaveBeenCalled();
  });
});
