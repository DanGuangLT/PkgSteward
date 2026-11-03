jest.mock('execa', () => ({ execa: jest.fn() }));

import { InternalServerException } from '@/common/exceptions/app.exception';
import { createDriveDetector } from '@/platform/drive-detector.factory';
import { UnsupportedDriveDetector } from '@/platform/unsupported-drive-detector';
import { WindowsDriveDetector } from '@/platform/windows/windows-drive-detector';

describe('createDriveDetector', () => {
  it('uses PowerShell CIM on Windows', () =>
    expect(createDriveDetector('win32')).toBeInstanceOf(WindowsDriveDetector));
  it('builds without error on other platforms (CI ubuntu must boot)', () =>
    expect(createDriveDetector('linux')).toBeInstanceOf(
      UnsupportedDriveDetector,
    ));
  it('fails clearly only when drives are requested off Windows', async () => {
    const error = await createDriveDetector('linux')
      .listFixedDrives()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InternalServerException);
    expect((error as Error).message).toMatch(
      /only supported on Windows.*linux/,
    );
  });
});
