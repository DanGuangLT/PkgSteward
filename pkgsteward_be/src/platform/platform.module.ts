import { Global, Module } from '@nestjs/common';
import { createDriveDetector } from '@/platform/drive-detector.factory';
import { DRIVE_DETECTOR } from '@/platform/interfaces/drive-detector.interface';

@Global()
@Module({
  providers: [
    {
      provide: DRIVE_DETECTOR,
      useFactory: () => createDriveDetector(process.platform),
    },
  ],
  exports: [DRIVE_DETECTOR],
})
export class PlatformModule {}
