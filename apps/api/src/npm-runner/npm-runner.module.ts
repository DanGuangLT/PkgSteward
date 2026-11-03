import { Module, RequestMethod } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AuditLogService } from '@/core/audit-log/audit-log.service';
import { MutationGateModule } from '@/core/mutation-gate/mutation-gate.module';
import { MutationGateService } from '@/core/mutation-gate/mutation-gate.service';
import { PathGuardService } from '@/core/path-guard/path-guard.service';
import { ScannerModule } from '@/scanner/scanner.module';
import { ScannerService } from '@/scanner/scanner.service';
import { DiskUsageModule } from '@/disk-usage/disk-usage.module';
import { DiskUsageService } from '@/disk-usage/disk-usage.service';
import { FileOpsModule } from '@/file-ops/file-ops.module';
import { FileOpsService } from '@/file-ops/file-ops.service';
import { ProjectsModule } from '@/projects/projects.module';
import { ProjectsService } from '@/projects/projects.service';
import { PlatformModule } from '@/platform/platform.module';
import { PROCESS_SNAPSHOT } from '@/platform/interfaces/process-snapshot.interface';
import type { IProcessSnapshot } from '@/platform/interfaces/process-snapshot.interface';
import { createWindowsRunnerProcess } from '@/platform/windows/windows-runner-process';
import type { IWindowsRunnerProcess } from '@/platform/windows/windows-runner-process';
import {
  NPM_RUNNER_FS,
  NPM_RUNNER_PROCESS,
  NPM_RUNNER_RUNTIME,
} from '@/npm-runner/interfaces/npm-runner.runtime';
import type { INpmRunnerRuntime } from '@/npm-runner/interfaces/npm-runner.runtime';
import type { IRunnerFs } from '@/npm-runner/interfaces/npm-runner.types';
import type { IRunJob } from '@/npm-runner/interfaces/npm-runner.types';
import type { ProjectScanSnapshot } from '@/projects/interfaces/projects.types';
import {
  NotFoundException,
  AppException,
} from '@/common/exceptions/app.exception';
import { parseScanRootPaths } from '@/config/scan-roots';
import { createRunnerFs } from '@/npm-runner/runner-input';
import { resolveRunnerTool } from '@/npm-runner/runner-tool';
import { launchRun } from '@/npm-runner/runner-process';
import { NpmRunnerController } from '@/npm-runner/npm-runner.controller';
import { NpmRunnerService } from '@/npm-runner/npm-runner.service';

export interface IRunnerRuntimeBindings {
  fs: IRunnerFs;
  processes: IWindowsRunnerProcess | null;
  scanner: Pick<
    ScannerService,
    'getLatest' | 'hasRunningScan' | 'refreshProject'
  >;
  disk: Pick<DiskUsageService, 'hasRunningMeasurement' | 'clearCache'>;
  fileOps: Pick<FileOpsService, 'hasRunningPreview'>;
  projects: Pick<
    ProjectsService,
    'hasRunningAnalysis' | 'invalidateAfterMutation'
  >;
  gate: Pick<MutationGateService, 'tryEnter' | 'leave'>;
  audit: Pick<AuditLogService, 'append'>;
  guard: Pick<PathGuardService, 'assertAllowed'>;
  config: ConfigService;
  host?: {
    platform: NodeJS.Platform;
    execPath: string;
    env: Readonly<NodeJS.ProcessEnv>;
  };
}

export function createNpmRunnerRuntime(
  bindings: IRunnerRuntimeBindings,
): INpmRunnerRuntime {
  const { scanner, disk, fileOps, projects, gate, audit, guard, config, fs } =
    bindings;
  // Snapshot once at provider construction, after configuration has initialized.
  const host = bindings.host ?? {
    platform: process.platform,
    execPath: process.execPath,
    env: process.env,
  };
  const execPath = host.execPath;
  const env = Object.freeze({ ...host.env });
  const platform = host.platform === 'win32' ? 'win32' : 'posix';
  const processes = host.platform === 'win32' ? bindings.processes : null;
  const roots = parseScanRootPaths(
    config.get<string>('SCAN_ROOT_PATHS'),
    platform,
  );
  const timeout = config.get<unknown>('NPM_COMMAND_TIMEOUT_MS');
  const getScanSnapshot = (): ProjectScanSnapshot | null => {
    try {
      const latest = scanner.getLatest();
      return latest
        ? { scanId: latest.scanId, projects: structuredClone(latest.projects) }
        : null;
    } catch (error: unknown) {
      if (error instanceof NotFoundException) return null;
      throw error;
    }
  };
  const clock = {
    now: Date.now,
    setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
    clearTimeout: (handle: unknown) =>
      clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const writeAudit = (
    job: Readonly<IRunJob>,
    phase: 'intent' | 'result',
  ): Promise<void> =>
    audit.append({
      operation: 'npm-runner.run',
      operationId: job.jobId,
      phase,
      targets: [job.path],
      method: `${job.manager}:${job.action}`,
      risk: { level: 'high', codes: [] },
      result:
        phase === 'intent'
          ? 'pending'
          : JSON.stringify({
              status: job.status,
              exitCode: job.exitCode,
              signal: job.signal,
              spawned: job.spawned,
              terminationVerified: job.terminationVerified,
              mayHaveChanged: job.mayHaveChanged,
              refreshRequired: job.refreshRequired,
            }),
      errorCode: phase === 'intent' ? null : job.failureCode,
    });
  const signal = new AbortController().signal;
  return {
    input: {
      platform,
      fs,
      signal,
      scanRoots: roots.kind === 'paths' ? roots.paths : ['*'],
      assertAllowed: async (path) => (await guard.assertAllowed(path)).realPath,
      getScanSnapshot,
      resolveTool: (manager) =>
        resolveRunnerTool(
          manager,
          {
            platform,
            execPath,
            env,
            signal,
            projectPaths:
              getScanSnapshot()?.projects.map((project) => project.path) ?? [],
          },
          fs,
        ),
      now: () => new Date(),
    },
    env,
    processes,
    timeoutMs: typeof timeout === 'number' ? timeout : undefined,
    gate: {
      tryEnter: () => gate.tryEnter(),
      leave: (token) => gate.leave(token),
    },
    readers: {
      hasRunningScan: () => scanner.hasRunningScan(),
      hasRunningMeasurement: () => disk.hasRunningMeasurement(),
      hasRunningPreview: () => fileOps.hasRunningPreview(),
      hasRunningAnalysis: () => projects.hasRunningAnalysis(),
    },
    audit: {
      writeIntent: (job) => writeAudit(job, 'intent'),
      writeResult: (job) => writeAudit(job, 'result'),
    },
    invalidation: {
      refreshProject: (path) => scanner.refreshProject(path),
      clearDiskUsage: () => disk.clearCache(),
      staleAnalysis: (path) => projects.invalidateAfterMutation(path),
    },
    launch: (command, childEnv, callbacks) => {
      if (!processes)
        throw new AppException(
          503,
          'Runner process adapter unavailable',
          'SERVICE_UNAVAILABLE',
        );
      return launchRun(command, childEnv, callbacks, { processes, clock });
    },
    now: () => new Date(),
    uuid: randomUUID,
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (timer) => clearTimeout(timer),
  };
}

@Module({
  imports: [
    ScannerModule,
    DiskUsageModule,
    FileOpsModule,
    ProjectsModule,
    PlatformModule,
    MutationGateModule,
  ],
  controllers: [NpmRunnerController],
  providers: [
    NpmRunnerService,
    { provide: NPM_RUNNER_FS, useFactory: createRunnerFs },
    {
      provide: NPM_RUNNER_PROCESS,
      inject: [PROCESS_SNAPSHOT],
      useFactory: (snapshot: IProcessSnapshot): IWindowsRunnerProcess | null =>
        process.platform === 'win32'
          ? createWindowsRunnerProcess({
              snapshot,
              systemRoot: process.env.SystemRoot,
              now: Date.now,
              sleep: (milliseconds) =>
                new Promise((resolve) => setTimeout(resolve, milliseconds)),
            })
          : null,
    },
    {
      provide: NPM_RUNNER_RUNTIME,
      inject: [
        NPM_RUNNER_FS,
        NPM_RUNNER_PROCESS,
        ScannerService,
        DiskUsageService,
        FileOpsService,
        ProjectsService,
        MutationGateService,
        AuditLogService,
        PathGuardService,
        ConfigService,
      ],
      useFactory: (
        fs: IRunnerFs,
        processes: IWindowsRunnerProcess | null,
        scanner: ScannerService,
        disk: DiskUsageService,
        fileOps: FileOpsService,
        projects: ProjectsService,
        gate: MutationGateService,
        audit: AuditLogService,
        guard: PathGuardService,
        config: ConfigService,
      ) =>
        createNpmRunnerRuntime({
          fs,
          processes,
          scanner,
          disk,
          fileOps,
          projects,
          gate,
          audit,
          guard,
          config,
        }),
    },
  ],
  exports: [NpmRunnerService],
})
export class NpmRunnerModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Before guards/pipes: errors and writes must also be uncacheable.
    consumer
      .apply((_request: Request, response: Response, next: NextFunction) => {
        response.setHeader('Cache-Control', 'no-store');
        next();
      })
      .forRoutes({ path: 'npm-runs{/*path}', method: RequestMethod.ALL });
  }
}
