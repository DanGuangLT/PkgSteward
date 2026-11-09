import { Module, RequestMethod } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { AppPathsModule } from '@/core/app-paths/app-paths.module';
import { AuditLogModule } from '@/core/audit-log/audit-log.module';
import { AuditLogService } from '@/core/audit-log/audit-log.service';
import { MutationGateModule } from '@/core/mutation-gate/mutation-gate.module';
import { MutationGateService } from '@/core/mutation-gate/mutation-gate.service';
import { PathGuardModule } from '@/core/path-guard/path-guard.module';
import { PathGuardService } from '@/core/path-guard/path-guard.service';
import { ScannerModule } from '@/scanner/scanner.module';
import { ScannerService } from '@/scanner/scanner.service';
import { DiskUsageModule } from '@/disk-usage/disk-usage.module';
import { DiskUsageService } from '@/disk-usage/disk-usage.service';
import { FileOpsModule } from '@/file-ops/file-ops.module';
import { FileOpsService } from '@/file-ops/file-ops.service';
import { ProjectsModule } from '@/projects/projects.module';
import { ProjectsService } from '@/projects/projects.service';
import { ProjectRegistry } from '@/projects/registry/project-registry';
import { PM_FS, PM_RUNTIME } from '@/package-managers/interfaces/pm.runtime';
import type {
  IPmFs,
  IPmRuntime,
} from '@/package-managers/interfaces/pm.runtime';
import {
  createPmFs,
  createPmRuntime,
} from '@/package-managers/execution/pm-runtime';
import { PackageManagersService } from '@/package-managers/package-managers.service';
import { PackageManagersController } from '@/package-managers/package-managers.controller';

@Module({
  imports: [
    ScannerModule,
    DiskUsageModule,
    FileOpsModule,
    ProjectsModule,
    MutationGateModule,
    AppPathsModule,
    AuditLogModule,
    PathGuardModule,
  ],
  controllers: [PackageManagersController],
  providers: [
    PackageManagersService,
    { provide: PM_FS, useFactory: createPmFs },
    // ProjectsModule exports its service only. Reuse the static registry class
    // locally, without changing that module's public provider boundary.
    { provide: ProjectRegistry, useFactory: () => new ProjectRegistry() },
    {
      provide: PM_RUNTIME,
      inject: [
        PM_FS,
        ScannerService,
        DiskUsageService,
        FileOpsService,
        ProjectsService,
        MutationGateService,
        PathGuardService,
        AuditLogService,
        ConfigService,
        ProjectRegistry,
      ],
      useFactory: (
        fs: IPmFs,
        scanner: ScannerService,
        disk: DiskUsageService,
        fileOps: FileOpsService,
        projects: ProjectsService,
        gate: MutationGateService,
        guard: PathGuardService,
        audit: AuditLogService,
        config: ConfigService,
        registry: ProjectRegistry,
      ): IPmRuntime =>
        createPmRuntime({
          fs,
          scanner,
          disk,
          fileOps,
          projects,
          gate,
          guard,
          audit,
          config,
          registry,
        }),
    },
  ],
})
export class PackageManagersModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Before Nest guards/pipes: failed admissions are also uncacheable.
    consumer
      .apply((_request: Request, response: Response, next: NextFunction) => {
        response.setHeader('Cache-Control', 'no-store');
        next();
      })
      .forRoutes({
        path: 'package-managers{/*path}',
        method: RequestMethod.ALL,
      });
  }
}
