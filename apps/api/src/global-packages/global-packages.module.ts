import { Module, RequestMethod } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { win32 } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import {
  AppException,
  NotFoundException,
} from '@/common/exceptions/app.exception';
import { AppPathsModule } from '@/core/app-paths/app-paths.module';
import { AppPathsService } from '@/core/app-paths/app-paths.service';
import { AuditLogModule } from '@/core/audit-log/audit-log.module';
import { AuditLogService } from '@/core/audit-log/audit-log.service';
import { MutationGateModule } from '@/core/mutation-gate/mutation-gate.module';
import { MutationGateService } from '@/core/mutation-gate/mutation-gate.service';
import { ScannerModule } from '@/scanner/scanner.module';
import { ScannerService } from '@/scanner/scanner.service';
import { PlatformModule } from '@/platform/platform.module';
import { PROCESS_SNAPSHOT } from '@/platform/interfaces/process-snapshot.interface';
import type { IProcessSnapshot } from '@/platform/interfaces/process-snapshot.interface';
import { createWindowsRunnerProcess } from '@/platform/windows/windows-runner-process';
import type { IWindowsRunnerProcess } from '@/platform/windows/windows-runner-process';
import type { GlobalManager } from '@/global-packages/interfaces/global-packages.types';
import type {
  GlobalProbeSpawn,
  IGlobalServiceRuntime,
} from '@/global-packages/interfaces/global-packages.runtime';
import {
  GLOBAL_PACKAGES_FS,
  GLOBAL_PACKAGES_PROCESS,
  GLOBAL_PACKAGES_RUNTIME,
} from '@/global-packages/interfaces/global-packages.runtime';
import type { IGlobalDirectoryAccess } from '@/global-packages/discovery/global-location';
import { createGlobalProbeSpawn } from '@/global-packages/discovery/global-location';
import type {
  IRunnerFs,
  IRunnerTool,
} from '@/npm-runner/interfaces/npm-runner.types';
import { createRunnerFs } from '@/npm-runner/toolchain/runner-input';
import { resolveRunnerTool } from '@/npm-runner/toolchain/runner-tool';
import { launchRun } from '@/npm-runner/execution/runner-process';
import type { IRunProcess } from '@/npm-runner/execution/runner-process';
import { GlobalPackagesController } from '@/global-packages/global-packages.controller';
import { GlobalPackagesService } from '@/global-packages/global-packages.service';

export interface IGlobalRuntimeBindings {
  fs: IRunnerFs;
  processes: IWindowsRunnerProcess | null;
  scanner: {
    getLatest(): { projects: readonly { path: string }[] } | null;
  };
  paths: IGlobalServiceRuntime['paths'];
  gate: IGlobalServiceRuntime['gate'];
  audit: IGlobalServiceRuntime['audit'];
  config: Pick<ConfigService, 'get'>;
  host?: {
    platform: NodeJS.Platform;
    execPath: string;
    env: Readonly<NodeJS.ProcessEnv>;
  };
  fetcher?: typeof fetch;
  launchProcess?: typeof launchRun;
}

export function createGlobalPackagesRuntime(
  bindings: IGlobalRuntimeBindings,
): IGlobalServiceRuntime {
  const { fs, scanner, gate, audit, config } = bindings;
  const host = bindings.host ?? {
    platform: process.platform,
    execPath: process.execPath,
    env: process.env,
  };
  const environment = Object.freeze({ ...host.env });
  const processes = host.platform === 'win32' ? bindings.processes : null;
  const paths = { ...bindings.paths };
  const timeout = config.get<unknown>('NPM_COMMAND_TIMEOUT_MS');
  const launchProcess = bindings.launchProcess ?? launchRun;
  const tools = new Map<string, IRunnerTool>();
  const retainedProbes = new Set<IRunProcess>();
  let unknownLaunch = false;
  let verification: Promise<boolean> | null = null;
  const key = (path: string) => win32.resolve(path).toLowerCase();
  const clock = {
    now: Date.now,
    setTimeout: (callback: () => void, milliseconds: number) =>
      setTimeout(callback, milliseconds),
    clearTimeout: (handle: unknown) =>
      clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const unavailable = (reason?: string): AppException =>
    new AppException(
      503,
      'Global packages process adapter unavailable',
      'SERVICE_UNAVAILABLE',
      reason ? { reason } : undefined,
    );
  const requireWindows = () => {
    if (!processes) throw unavailable();
    return processes;
  };
  const scannedProjectPaths = (): readonly string[] => {
    try {
      return scanner.getLatest()?.projects.map((project) => project.path) ?? [];
    } catch (error) {
      if (error instanceof NotFoundException) return [];
      throw error;
    }
  };
  const resolveTool = async (manager: GlobalManager, signal: AbortSignal) => {
    requireWindows();
    signal.throwIfAborted();
    const tool = await resolveRunnerTool(
      manager,
      {
        platform: 'win32',
        execPath: host.execPath,
        env: environment,
        signal,
        projectPaths: scannedProjectPaths(),
      },
      fs,
    );
    signal.throwIfAborted();
    if (!tool.entry) throw unavailable('TOOL_LAYOUT_UNSUPPORTED');
    tools.set(key(tool.entry), tool);
    return tool;
  };
  const probe: GlobalProbeSpawn = async (file, args, options) => {
    const adapter = requireWindows();
    options.signal.throwIfAborted();
    const entry = args[0];
    const manager =
      entry && /[\\/]npm-cli\.js$/i.test(entry)
        ? 'npm'
        : entry && /[\\/]pnpm\.(?:mjs|cjs|js)$/i.test(entry)
          ? 'pnpm'
          : null;
    if (
      !manager ||
      !Number.isFinite(options.timeout) ||
      options.timeout <= 0 ||
      !Number.isSafeInteger(options.maxBuffer.stdout) ||
      options.maxBuffer.stdout < 0 ||
      !Number.isSafeInteger(options.maxBuffer.stderr) ||
      options.maxBuffer.stderr < 0
    )
      throw unavailable('TOOL_LAYOUT_UNSUPPORTED');
    const tool = await resolveTool(manager, options.signal);
    if (key(tool.file) !== key(file) || key(tool.entry!) !== key(entry))
      throw unavailable('TOOL_LAYOUT_UNSUPPORTED');
    let retained: IRunProcess | null = null;
    const spawn = createGlobalProbeSpawn(
      tool,
      { processes: adapter, clock },
      {
        launch: launchProcess,
        retain: (child) => {
          retained = child;
          retainedProbes.add(child);
        },
        launchFailed: () => {
          // No handle means no identity-based proof is possible.
          unknownLaunch = true;
        },
      },
    );
    const result = await spawn(file, args, options);
    if (result.terminationVerified && retained) retainedProbes.delete(retained);
    return result;
  };
  const verifyProbeTermination = (): Promise<boolean> => {
    if (verification) return verification;
    const work = async () => {
      for (const child of retainedProbes) {
        try {
          if ((await child.stop()) === 'verified') retainedProbes.delete(child);
        } catch {
          // The retained handle remains available for the next explicit cleanup attempt.
        }
      }
      return !unknownLaunch && retainedProbes.size === 0;
    };
    verification = work().finally(() => {
      verification = null;
    });
    return verification;
  };
  return {
    fs,
    platform: host.platform,
    execPath: host.execPath,
    environment,
    paths,
    scannedProjectPaths,
    resolveTool,
    makeDirectory: async (path) => {
      await mkdir(path, { recursive: true });
    },
    probe,
    fetcher: bindings.fetcher ?? fetch,
    launch: (command, callbacks) => {
      const adapter = requireWindows();
      callbacks.signal.throwIfAborted();
      const tool = tools.get(key(command.args[0] ?? ''));
      if (!tool || key(tool.file) !== key(command.file))
        throw unavailable('TOOL_LAYOUT_UNSUPPORTED');
      return launchProcess(
        {
          file: command.file,
          args: [...command.args],
          cwd: command.cwd,
          manager: tool.manager,
          version: tool.version,
        },
        command.env,
        callbacks,
        { processes: adapter, clock },
      );
    },
    verifyProbeTermination,
    timeoutMs: typeof timeout === 'number' ? timeout : undefined,
    gate: {
      tryEnter: () => gate.tryEnter(),
      leave: (token) => gate.leave(token),
    },
    audit: { append: (record) => audit.append(record) },
    now: () => new Date(),
    monotonicNow: () => performance.now(),
    uuid: randomUUID,
    setTimer: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimer: (handle) => clock.clearTimeout(handle),
  };
}

@Module({
  imports: [
    ScannerModule,
    PlatformModule,
    MutationGateModule,
    AppPathsModule,
    AuditLogModule,
  ],
  controllers: [GlobalPackagesController],
  providers: [
    GlobalPackagesService,
    {
      provide: GLOBAL_PACKAGES_FS,
      useFactory: (): IRunnerFs & IGlobalDirectoryAccess => ({
        ...createRunnerFs(),
        readdir: (path) => readdir(path),
      }),
    },
    {
      provide: GLOBAL_PACKAGES_PROCESS,
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
      provide: GLOBAL_PACKAGES_RUNTIME,
      inject: [
        GLOBAL_PACKAGES_FS,
        GLOBAL_PACKAGES_PROCESS,
        ScannerService,
        AppPathsService,
        MutationGateService,
        AuditLogService,
        ConfigService,
      ],
      useFactory: (
        fs: IRunnerFs,
        processes: IWindowsRunnerProcess | null,
        scanner: ScannerService,
        appPaths: AppPathsService,
        gate: MutationGateService,
        audit: AuditLogService,
        config: ConfigService,
      ): IGlobalServiceRuntime => {
        const install = appPaths.appInstallDir;
        const parent = win32.dirname(install);
        const sourceCheckoutDir =
          'sourceCheckoutDir' in appPaths &&
          typeof appPaths.sourceCheckoutDir === 'string'
            ? appPaths.sourceCheckoutDir
            : win32.basename(install) === 'api' &&
                win32.basename(parent) === 'apps'
              ? win32.dirname(parent)
              : null;
        return createGlobalPackagesRuntime({
          fs,
          processes,
          scanner,
          gate,
          audit,
          config,
          paths: {
            cacheDir: appPaths.cacheDir,
            appInstallDir: install,
            sourceCheckoutDir,
            dataDir: appPaths.dataDir,
          },
        });
      },
    },
  ],
})
export class GlobalPackagesModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply((_request: Request, response: Response, next: NextFunction) => {
        response.setHeader('Cache-Control', 'no-store');
        next();
      })
      .forRoutes({
        path: 'global-packages{/*path}',
        method: RequestMethod.ALL,
      });
  }
}
