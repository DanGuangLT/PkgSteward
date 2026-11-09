import { Logger, Module } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { AppPathsService } from '@/core/app-paths/app-paths.service';
import { DiskUsageModule } from '@/disk-usage/disk-usage.module';
import { SCAN_WALKER, walkScan } from '@/scanner/discovery/scan-walker';
import { ScannerCache } from '@/scanner/cache/scanner-cache';
import { ScannerController } from '@/scanner/scanner.controller';
import { ScannerService } from '@/scanner/scanner.service';

@Module({
  imports: [DiskUsageModule],
  controllers: [ScannerController],
  providers: [
    ScannerService,
    { provide: SCAN_WALKER, useValue: walkScan },
    {
      provide: ScannerCache,
      inject: [AppPathsService],
      useFactory: (appPaths: AppPathsService) => {
        const logger = new Logger(ScannerCache.name);
        return new ScannerCache({
          cacheFilePath: join(appPaths.cacheDir, 'last-scan.json'),
          ensureCacheDir: () => appPaths.ensureDir('cache'),
          fs: {
            readFile: (file) => fs.readFile(file, 'utf8'),
            writeFile: (file, content) => fs.writeFile(file, content, 'utf8'),
            rename: (from, to) => fs.rename(from, to),
            unlink: (file) => fs.unlink(file),
          },
          warn: (message, error) =>
            error === undefined
              ? logger.warn(message)
              : logger.warn(message, error),
        });
      },
    },
  ],
  exports: [ScannerService],
})
export class ScannerModule {}
