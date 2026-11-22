import { Module, RequestMethod } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AppPathsModule } from '@/core/app-paths/app-paths.module';
import { AuditLogModule } from '@/core/audit-log/audit-log.module';
import { MutationGateModule } from '@/core/mutation-gate/mutation-gate.module';
import { PathGuardModule } from '@/core/path-guard/path-guard.module';
import { DiskUsageModule } from '@/disk-usage/disk-usage.module';
import { FileOpsModule } from '@/file-ops/file-ops.module';
import { ProjectsModule } from '@/projects/projects.module';
import { ScannerModule } from '@/scanner/scanner.module';
import { RejectPrototypePollutionGuard } from '@/settings/guards/reject-prototype-pollution.guard';
import { PluginRegistryService } from '@/settings/plugins/plugin-registry.service';
import { SettingsController } from '@/settings/settings.controller';
import { SettingsService } from '@/settings/settings.service';

@Module({
  imports: [
    AppPathsModule,
    AuditLogModule,
    MutationGateModule,
    PathGuardModule,
    ScannerModule,
    DiskUsageModule,
    FileOpsModule,
    ProjectsModule,
  ],
  controllers: [SettingsController],
  providers: [
    RejectPrototypePollutionGuard,
    PluginRegistryService,
    SettingsService,
  ],
  exports: [SettingsService, PluginRegistryService],
})
export class SettingsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply((_request: Request, response: Response, next: NextFunction) => {
        response.setHeader('Cache-Control', 'no-store');
        next();
      })
      .forRoutes(
        { path: 'settings', method: RequestMethod.ALL },
        { path: 'settings{/*path}', method: RequestMethod.ALL },
      );
  }
}
