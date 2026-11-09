import { Global, Module } from '@nestjs/common';
import { createDriveDetector } from '@/platform/drives/drive-detector.factory';
import { DRIVE_DETECTOR } from '@/platform/interfaces/drive-detector.interface';
import { RECYCLE_BIN } from '@/platform/interfaces/recycle-bin.interface';
import { PROCESS_SNAPSHOT } from '@/platform/interfaces/process-snapshot.interface';
import { createRecycleBin } from '@/platform/recycle/recycle-bin.factory';
import { createProcessSnapshot } from '@/platform/processes/process-snapshot.factory';

@Global()
@Module({
  providers: [
    {
      provide: DRIVE_DETECTOR,
      useFactory: () => createDriveDetector(process.platform),
    },
    {
      provide: RECYCLE_BIN,
      useFactory: () => createRecycleBin(process.platform),
    },
    {
      provide: PROCESS_SNAPSHOT,
      useFactory: () => createProcessSnapshot(process.platform),
    },
  ],
  exports: [DRIVE_DETECTOR, RECYCLE_BIN, PROCESS_SNAPSHOT],
})
export class PlatformModule {}
