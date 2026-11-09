import { Module, RequestMethod } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { NotFoundException } from '@/common/exceptions/app.exception';
import { toPathPlatform } from '@/common/utils/path.util';
import { MutationGateService } from '@/core/mutation-gate/mutation-gate.service';
import type { IMutationGateService } from '@/core/mutation-gate/interfaces/mutation-gate.types';
import { PathGuardService } from '@/core/path-guard/path-guard.service';
import type { IPathGuardService } from '@/core/path-guard/interfaces/path-guard.service.interface';
import { DiskUsageModule } from '@/disk-usage/disk-usage.module';
import { DiskUsageService } from '@/disk-usage/disk-usage.service';
import { ScannerModule } from '@/scanner/scanner.module';
import { ScannerService } from '@/scanner/scanner.service';
import type {
  IProjectRegistry,
  IProjectsRuntime,
  ProjectAnalyzer,
} from '@/projects/interfaces/projects.runtime';
import type {
  IProjectDetail,
  IProjectFs,
  ProjectScanSnapshot,
} from '@/projects/interfaces/projects.types';
import {
  analyzeProject,
  PROJECT_ANALYZER,
} from '@/projects/analysis/project-analysis';
import { createProjectFs } from '@/projects/input/project-fs';
import {
  ProjectRegistry,
  PROJECT_REGISTRY,
} from '@/projects/registry/project-registry';
import { ProjectsController } from '@/projects/projects.controller';
import {
  PROJECT_FS,
  PROJECT_RUNTIME,
  ProjectsService,
} from '@/projects/projects.service';

export { PROJECT_ANALYZER, PROJECT_REGISTRY };

export const createProjectRegistry = (): IProjectRegistry =>
  new ProjectRegistry();

export const createProjectsRuntime = (
  fs: IProjectFs,
  registry: IProjectRegistry,
  analyze: ProjectAnalyzer,
  scanner: { getLatest: () => ProjectScanSnapshot | null | undefined },
  gate: Pick<IMutationGateService, 'assertIdle'>,
  disk: { peekCompletedSize: (path: string) => IProjectDetail['diskUsage'] },
  guard: Pick<IPathGuardService, 'assertAllowed'>,
  config: ConfigService,
): IProjectsRuntime => {
  const configured = config.get<number | string>('NPM_COMMAND_TIMEOUT_MS');
  const timeoutMs =
    configured === undefined || configured === ''
      ? undefined
      : Number(configured);
  return {
    input: {
      platform: toPathPlatform(),
      fs,
      assertAllowed: async (path) => (await guard.assertAllowed(path)).realPath,
      now: () => new Date(),
    },
    lifecycle: {
      getLatest: () => {
        const latest = scanner.getLatest();
        if (!latest) throw new NotFoundException('Latest scan');
        return latest;
      },
      assertIdle: () => gate.assertIdle(),
      peekCompletedSize: (path) => disk.peekCompletedSize(path),
      now: () => new Date(),
      timeoutMs,
    },
    registry,
    analyze,
  };
};

@Module({
  imports: [ScannerModule, DiskUsageModule],
  controllers: [ProjectsController],
  providers: [
    ProjectsService,
    { provide: PROJECT_FS, useFactory: createProjectFs },
    { provide: PROJECT_REGISTRY, useFactory: createProjectRegistry },
    { provide: PROJECT_ANALYZER, useValue: analyzeProject },
    {
      provide: PROJECT_RUNTIME,
      useFactory: createProjectsRuntime,
      inject: [
        PROJECT_FS,
        PROJECT_REGISTRY,
        PROJECT_ANALYZER,
        ScannerService,
        MutationGateService,
        DiskUsageService,
        PathGuardService,
        ConfigService,
      ],
    },
  ],
  exports: [ProjectsService],
})
export class ProjectsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Run before guards and pipes so rejected GETs also remain uncacheable.
    consumer
      .apply((_request: Request, response: Response, next: NextFunction) => {
        response.setHeader('Cache-Control', 'no-store');
        next();
      })
      .forRoutes({ path: 'projects', method: RequestMethod.GET });
  }
}
