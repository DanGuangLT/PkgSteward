jest.mock('execa', () => ({ execa: jest.fn() }));
jest.mock('@/platform/drives/drive-detector.factory', () => ({
  createDriveDetector: jest.fn(),
}));
jest.mock('@/platform/recycle/recycle-bin.factory', () => ({
  createRecycleBin: jest.fn(),
}));
jest.mock('@/platform/processes/process-snapshot.factory', () => ({
  createProcessSnapshot: jest.fn(),
}));

import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createDriveDetector } from '@/platform/drives/drive-detector.factory';
import { createRecycleBin } from '@/platform/recycle/recycle-bin.factory';
import { createProcessSnapshot } from '@/platform/processes/process-snapshot.factory';
import { DRIVE_DETECTOR } from '@/platform/interfaces/drive-detector.interface';
import { RECYCLE_BIN } from '@/platform/interfaces/recycle-bin.interface';
import { PROCESS_SNAPSHOT } from '@/platform/interfaces/process-snapshot.interface';
import { PlatformModule } from '@/platform/platform.module';

const CONSUMER = Symbol('PLATFORM_CONSUMER');
@Module({
  imports: [PlatformModule],
  providers: [
    {
      provide: CONSUMER,
      inject: [DRIVE_DETECTOR, RECYCLE_BIN, PROCESS_SNAPSHOT],
      useFactory: (drives: unknown, recycle: unknown, processes: unknown) => ({
        drives,
        recycle,
        processes,
      }),
    },
  ],
})
class ConsumerModule {}

describe('PlatformModule', () => {
  it('exports all three adapters and selects each using the host platform', async () => {
    const drives = { listFixedDrives: jest.fn() };
    const recycle = { recycle: jest.fn() };
    const processes = { capture: jest.fn() };
    jest.mocked(createDriveDetector).mockReturnValue(drives);
    jest.mocked(createRecycleBin).mockReturnValue(recycle);
    jest.mocked(createProcessSnapshot).mockReturnValue(processes);
    const module = await Test.createTestingModule({
      imports: [ConsumerModule],
    }).compile();
    try {
      expect(module.get<unknown>(CONSUMER)).toEqual({
        drives,
        recycle,
        processes,
      });
      expect(createDriveDetector).toHaveBeenCalledWith(process.platform);
      expect(createRecycleBin).toHaveBeenCalledWith(process.platform);
      expect(createProcessSnapshot).toHaveBeenCalledWith(process.platform);
    } finally {
      await module.close();
    }
  });
});
