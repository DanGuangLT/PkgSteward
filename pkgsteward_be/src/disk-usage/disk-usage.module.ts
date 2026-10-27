import { Module } from '@nestjs/common';
import { DiskUsageCache } from '@/disk-usage/disk-usage-cache';
import { DiskUsageController } from '@/disk-usage/disk-usage.controller';
import { DiskUsageService } from '@/disk-usage/disk-usage.service';
import {
  createDiskFs,
  DISK_FS,
  DISK_WALKER,
  walkDiskUsage,
} from '@/disk-usage/disk-usage-walker';

@Module({
  controllers: [DiskUsageController],
  providers: [
    DiskUsageService,
    DiskUsageCache,
    { provide: DISK_WALKER, useValue: walkDiskUsage },
    { provide: DISK_FS, useFactory: createDiskFs },
  ],
  exports: [DiskUsageService],
})
export class DiskUsageModule {}
