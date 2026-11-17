import { Module, RequestMethod } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AuditLogService } from '@/core/audit-log/audit-log.service';
import { AppPathsModule } from '@/core/app-paths/app-paths.module';
import { AppPathsService } from '@/core/app-paths/app-paths.service';
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
import type {
  INativeRecoveryRuntime,
  INativeRunnerRuntime,
  INpmRunnerRuntime,
} from '@/npm-runner/interfaces/npm-runner.runtime';
import type {
  IRunRecoveryHold,
  IRunnerFs,
  RunFailureCode,
} from '@/npm-runner/interfaces/npm-runner.types';
import {
  createNativeRecoveryStore,
  createNodeRecoveryFs,
} from '@/npm-runner/native-session/native-recovery';
import type { IRunJob } from '@/npm-runner/interfaces/npm-runner.types';
import type { ProjectScanSnapshot } from '@/projects/interfaces/projects.types';
import {
  NotFoundException,
  AppException,
} from '@/common/exceptions/app.exception';
import { parseScanRootPaths } from '@/config/environment/scan-roots';
import { createRunnerFs } from '@/npm-runner/toolchain/runner-input';
import { resolveRunnerTool } from '@/npm-runner/toolchain/runner-tool';
import { launchRun } from '@/npm-runner/execution/runner-process';
import { launchTerminalRun } from '@/npm-runner/terminal/terminal-worker-process';
import { createWindowsNativeConsole } from '@/platform/windows/windows-native-console';
import {
  createNativeSession,
  type INativeSessionSnapshot,
} from '@/npm-runner/native-session/native-session';
import {
  spawnNativeNode,
  type NativeNodeSpawn,
} from '@/npm-runner/native-session/native-console-supervisor';
import { NpmRunnerController } from '@/npm-runner/npm-runner.controller';
import { NpmRunnerService } from '@/npm-runner/npm-runner.service';

export interface INativeRuntimeBindings {
  appInstallDir: string;
  snapshot: IProcessSnapshot;
  persist(snapshot: INativeSessionSnapshot): Promise<void>;
  spawn?: NativeNodeSpawn;
  apiPid?: number;
  onProcessExit?: (listener: () => void) => () => void;
  handshakeTimeoutMs?: number;
}

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
  > & {
    invalidateAllAfterMutation?: () => void;
  };
  gate: Pick<MutationGateService, 'tryEnter' | 'leave'>;
  audit: Pick<AuditLogService, 'append'>;
  guard: Pick<PathGuardService, 'assertAllowed'>;
  config: ConfigService;
  host?: {
    platform: NodeJS.Platform;
    execPath: string;
    env: Readonly<NodeJS.ProcessEnv>;
  };
  terminalAvailable?: boolean;
  native?: INativeRuntimeBindings;
  recovery?: INativeRecoveryRuntime;
}

const NODE_PTY_MODULE: string = 'node-pty';

export function canResolveNodePty(
  resolve: (id: string) => string = (id) => require.resolve(id),
): boolean {
  try {
    resolve(NODE_PTY_MODULE);
    return true;
  } catch {
    return false;
  }
}

const defaultOnProcessExit = (listener: () => void): (() => void) => {
  process.on('exit', listener);
  return () => {
    process.off('exit', listener);
  };
};

export function createNativeRunnerAdapter(deps: {
  fs: IRunnerFs;
  processes: IWindowsRunnerProcess | null;
  platform: string;
  execPath: string;
  systemRoot: string | undefined;
  clock: {
    setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
    clearTimeout(handle: unknown): void;
  };
  native: INativeRuntimeBindings;
}): INativeRunnerRuntime {
  const nativeConsole =
    deps.platform === 'win32' && deps.processes
      ? createWindowsNativeConsole({
          fs: deps.fs,
          snapshot: deps.native.snapshot,
          processes: deps.processes,
          platform: deps.platform,
          execPath: deps.execPath,
          systemRoot: deps.systemRoot,
          appInstallDir: deps.native.appInstallDir,
        })
      : null;
  return {
    capability: () =>
      nativeConsole ? nativeConsole.capability() : Promise.resolve(false),
    preflight: (shell) =>
      nativeConsole
        ? nativeConsole.preflight(shell)
        : Promise.resolve({ status: 'unavailable' }),
    createSession: (input) => {
      if (!nativeConsole)
        throw new AppException(
          503,
          'Runner process adapter unavailable',
          'SERVICE_UNAVAILABLE',
        );
      const native = deps.native;
      return createNativeSession(
        {
          platform: nativeConsole,
          spawn: native.spawn ?? spawnNativeNode,
          writeIntent: () => input.writeIntent(),
          ...(input.beforeInit
            ? { beforeInit: () => input.beforeInit!() }
            : {}),
          persist: (snapshot) => native.persist(snapshot),
          callbacks: input.callbacks,
          onProcessExit: native.onProcessExit ?? defaultOnProcessExit,
          setTimer: (callback, ms) => deps.clock.setTimeout(callback, ms),
          clearTimer: (handle) => deps.clock.clearTimeout(handle),
        },
        {
          identity: input.identity,
          fingerprint: input.fingerprint,
          apiPid: deps.native.apiPid ?? process.pid,
          preflight: input.preflight,
          init: input.init,
          initialTimeoutMs: input.initialTimeoutMs,
          handshakeTimeoutMs:
            input.handshakeTimeoutMs ?? deps.native.handshakeTimeoutMs,
        },
      );
    },
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
  const terminalEnabled = bindings.terminalAvailable ?? canResolveNodePty();
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
      writeRecoveryIntent: (operationId, hold: Readonly<IRunRecoveryHold>) =>
        audit.append({
          operation: 'npm-runner.recovery-clear',
          operationId,
          phase: 'intent',
          targets: [hold.journalPath],
          method: 'recovery:clear',
          risk: { level: 'high', codes: [] },
          result: 'pending',
          errorCode: null,
        }),
      writeRecoveryResult: (
        operationId,
        hold: Readonly<IRunRecoveryHold>,
        outcome,
        errorCode: RunFailureCode | null = null,
      ) =>
        audit.append({
          operation: 'npm-runner.recovery-clear',
          operationId,
          phase: 'result',
          targets: [hold.journalPath],
          method: 'recovery:clear',
          risk: { level: 'high', codes: [] },
          result: outcome,
          errorCode,
        }),
    },
    invalidation: {
      refreshProject: (path) => scanner.refreshProject(path),
      clearDiskUsage: () => disk.clearCache(),
      staleAnalysis: (path) => projects.invalidateAfterMutation(path),
      ...(projects.invalidateAllAfterMutation
        ? { staleAllAnalyses: () => projects.invalidateAllAfterMutation!() }
        : {}),
    },
    ...(bindings.native
      ? {
          native: createNativeRunnerAdapter({
            fs,
            processes,
            platform: host.platform,
            execPath,
            systemRoot: host.env.SystemRoot,
            clock,
            native: bindings.native,
          }),
        }
      : {}),
    ...(bindings.recovery ? { recovery: bindings.recovery } : {}),
    launch: (command, childEnv, callbacks) => {
      if (!processes)
        throw new AppException(
          503,
          'Runner process adapter unavailable',
          'SERVICE_UNAVAILABLE',
        );
      return launchRun(command, childEnv, callbacks, { processes, clock });
    },
    launchTerminal: terminalEnabled
      ? (command, childEnv, callbacks, identity, initialSize) => {
          if (!processes)
            throw new AppException(
              503,
              'Runner process adapter unavailable',
              'SERVICE_UNAVAILABLE',
            );
          return launchTerminalRun(
            command,
            childEnv,
            callbacks,
            { processes, clock },
            identity,
            initialSize,
          );
        }
      : undefined,
    now: () => new Date(),
    uuid: randomUUID,
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (timer) => clearTimeout(timer),
  };
}

@Module({
  imports: [
    AppPathsModule,
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
        PROCESS_SNAPSHOT,
        AppPathsService,
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
        snapshot: IProcessSnapshot,
        appPaths: AppPathsService,
        scanner: ScannerService,
        disk: DiskUsageService,
        fileOps: FileOpsService,
        projects: ProjectsService,
        gate: MutationGateService,
        audit: AuditLogService,
        guard: PathGuardService,
        config: ConfigService,
      ) => {
        const platform = process.platform === 'win32' ? 'win32' : 'posix';
        const recoveryConsole = createWindowsNativeConsole({
          fs,
          snapshot,
          processes: processes ?? {
            capture: () => Promise.resolve({ status: 'unknown' }),
            descendants: () => Promise.resolve({ status: 'unknown' }),
            stopTree: () => Promise.resolve('unconfirmed'),
            verifyGone: () => Promise.resolve('unconfirmed'),
          },
          platform: process.platform,
          execPath: process.execPath,
          systemRoot: process.env.SystemRoot,
          appInstallDir: appPaths.appInstallDir,
        });
        const recovery = createNativeRecoveryStore({
          dataDir: appPaths.dataDir,
          platform,
          fs: createNodeRecoveryFs(),
          console: recoveryConsole,
        });
        return createNpmRunnerRuntime({
          fs,
          processes,
          scanner,
          disk,
          fileOps,
          projects: {
            hasRunningAnalysis: () => projects.hasRunningAnalysis(),
            invalidateAfterMutation: (path) =>
              projects.invalidateAfterMutation(path),
            invalidateAllAfterMutation: () =>
              projects.invalidateAllAfterMutation(),
          },
          gate,
          audit,
          guard,
          config,
          native: {
            appInstallDir: appPaths.appInstallDir,
            snapshot,
            persist: (sessionSnapshot) => recovery.persist(sessionSnapshot),
          },
          recovery,
        });
      },
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
