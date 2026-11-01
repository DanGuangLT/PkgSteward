import { Module } from '@nestjs/common';
import { createDiskFs, DISK_FS } from '@/disk-usage/disk-usage-walker';
import { DiskUsageModule } from '@/disk-usage/disk-usage.module';
import { createFileOpsFs } from '@/file-ops/file-ops-fs';
import { FileOpsController } from '@/file-ops/file-ops.controller';
import { FileOpsService } from '@/file-ops/file-ops.service';
import { GitProbe } from '@/file-ops/git-probe';
import { FILE_OPS_FS } from '@/file-ops/interfaces/file-ops.types';
import { ScannerModule } from '@/scanner/scanner.module';

@Module({
  imports: [ScannerModule, DiskUsageModule],
  controllers: [FileOpsController],
  providers: [
    FileOpsService,
    GitProbe,
    { provide: FILE_OPS_FS, useFactory: createFileOpsFs },
    { provide: DISK_FS, useFactory: createDiskFs },
  ],
})
export class FileOpsModule {}
