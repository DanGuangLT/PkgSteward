import * as nativeFs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { ConfigService } from '@nestjs/config';
import {
  AppException,
  NotFoundException,
} from '@/common/exceptions/app.exception';
import { parseScanRootPaths } from '@/config/scan-roots';
import { pathApi } from '@/common/utils/path.util';
import { createRunnerFs } from '@/npm-runner/runner-input';
import { resolveRunnerTool, runnerIdentity } from '@/npm-runner/runner-tool';
import type { ProjectScanSnapshot } from '@/projects/interfaces/projects.types';
import type { IProjectRegistry } from '@/projects/interfaces/projects.runtime';
import type { IAuditRecord } from '@/core/audit-log/interfaces/audit-log.types';
import { PmRegistry } from '@/package-managers/pm-registry';
import {
  readPmProject,
  commitPmPin,
  cleanupPmTemp,
} from '@/package-managers/pm-project';
import { parsePmPin } from '@/package-managers/pm-policy';
import type {
  IPmFs,
  IPmRuntime,
  IPmProjectDeps,
} from '@/package-managers/interfaces/pm.runtime';

/** Lazy native adapter. Construction opens no handle and writes nothing. */
export function createPmFs(): IPmFs {
  const reader = createRunnerFs();
  return {
    ...reader,
    lstat: (file) => nativeFs.lstat(file),
    async open(file) {
      const handle = await reader.open(file);
      return {
        ...handle,
        async stat() {
          const stat = await handle.stat();
          // createRunnerFs returns native Stats, including nlink; do not spread
          // away prototype methods or silently accept an adapter without it.
          const nlink: unknown = 'nlink' in stat ? stat.nlink : undefined;
          if (typeof nlink !== 'number')
            throw new AppException(
              409,
              'Manifest identity unavailable',
              'CONFLICT',
              { reason: 'CONFIG_UNSUPPORTED' },
            );
          return { ...runnerIdentity(file, stat).stat, nlink };
        },
      };
    },
    async openExclusive(file, flags) {
      const handle = await nativeFs.open(file, flags);
      return {
        stat: () => handle.stat(),
        write: (bytes) => handle.writeFile(bytes),
        sync: () => handle.sync(),
        close: () => handle.close(),
      };
    },
    rename: (from, to) => nativeFs.rename(from, to),
    unlink: (file) => nativeFs.unlink(file),
  };
}

// Structural bindings avoid importing service/module implementations or a
// process adapter. G4 injects the same singleton gate and existing readers.
export interface IPmRuntimeBindings {
  fs: IPmFs;
  scanner: {
    getLatest(): ProjectScanSnapshot | null;
    hasRunningScan(): boolean;
    refreshProject(path: string): Promise<void>;
  };
  disk: { hasRunningMeasurement(): boolean };
  fileOps: { hasRunningPreview(): boolean };
  projects: {
    hasRunningAnalysis(): boolean;
    invalidateAfterMutation(path: string): void;
  };
  gate: {
    assertIdle(): void;
    tryEnter(): symbol | null;
    leave(token: symbol): void;
  };
  guard: { assertAllowed(path: string): Promise<{ realPath: string }> };
  audit: { append(record: IAuditRecord): Promise<void> };
  registry: Pick<IProjectRegistry, 'getPackageMetadata'>;
  config: Pick<ConfigService, 'get'>;
  host?: {
    platform: NodeJS.Platform;
    execPath: string;
    env: Readonly<NodeJS.ProcessEnv>;
  };
}

export function createPmRuntime(bindings: IPmRuntimeBindings): IPmRuntime {
  const host = bindings.host ?? {
    platform: process.platform,
    execPath: process.execPath,
    env: process.env,
  };
  const platform = host.platform === 'win32' ? 'win32' : 'posix';
  const execPath = host.execPath;
  const env = Object.freeze({ ...host.env });
  const roots = parseScanRootPaths(
    bindings.config.get<string>('SCAN_ROOT_PATHS'),
    platform,
  );
  const configured: unknown = bindings.config.get('NPM_COMMAND_TIMEOUT_MS');
  const timeout =
    configured === '' || configured === undefined || configured === null
      ? undefined
      : Number(configured);
  const timeoutMs =
    timeout !== undefined && Number.isFinite(timeout) && timeout > 0
      ? timeout
      : undefined;
  const getScanSnapshot = (): ProjectScanSnapshot | null => {
    try {
      const scan = bindings.scanner.getLatest();
      return scan
        ? { scanId: scan.scanId, projects: structuredClone(scan.projects) }
        : null;
    } catch (error) {
      if (error instanceof NotFoundException) return null;
      throw error;
    }
  };
  const projectDeps = (signal: AbortSignal): IPmProjectDeps => ({
    platform,
    fs: bindings.fs,
    signal,
    scanRoots: roots.kind === 'paths' ? roots.paths : ['*'],
    assertAllowed: async (file) =>
      (await bindings.guard.assertAllowed(file)).realPath,
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
        bindings.fs,
      ),
    now: () => new Date(),
    uuid: randomUUID,
  });
  const declaredPin = (pin: string | null) =>
    pin !== null && parsePmPin(pin).parsedPin ? pin : null;
  return {
    projectDeps,
    readProject(path, signal) {
      bindings.gate.assertIdle();
      return readPmProject(path, projectDeps(signal));
    },
    commit: (facts, edit, signal, beforeRename) =>
      commitPmPin(facts, edit, signal, {
        ...projectDeps(signal),
        beforeRename,
      }),
    cleanupTemp: (temp) =>
      cleanupPmTemp(temp, projectDeps(new AbortController().signal)),
    registry: new PmRegistry(bindings.registry),
    timeoutMs,
    gate: {
      tryEnter: () => bindings.gate.tryEnter(),
      leave: (token) => bindings.gate.leave(token),
    },
    readers: {
      hasRunningScan: () => bindings.scanner.hasRunningScan(),
      hasRunningMeasurement: () => bindings.disk.hasRunningMeasurement(),
      hasRunningPreview: () => bindings.fileOps.hasRunningPreview(),
      hasRunningAnalysis: () => bindings.projects.hasRunningAnalysis(),
    },
    async invalidate(path) {
      let failed = false;
      try {
        await bindings.scanner.refreshProject(path);
      } catch {
        failed = true;
      }
      try {
        bindings.projects.invalidateAfterMutation(path);
      } catch {
        failed = true;
      }
      if (failed)
        throw new AppException(
          503,
          'Project refresh incomplete',
          'SERVICE_UNAVAILABLE',
          { reason: 'CACHE_INVALIDATION_FAILED' },
        );
    },
    audit: {
      write: (job, phase, details, operation = 'project-pin') =>
        bindings.audit.append({
          operation: `package-managers.${operation}`,
          operationId: job.jobId,
          phase,
          targets: [pathApi(platform).join(job.path, 'package.json')],
          method: 'manifest-pin',
          risk: {
            level: details.risk.level,
            codes: details.risk.reasons.map((item) => item.code),
          },
          result:
            phase === 'intent'
              ? 'pending'
              : JSON.stringify({
                  status: job.status,
                  old: declaredPin(details.oldPin),
                  target: declaredPin(details.targetPin),
                  observed: declaredPin(details.observedPin),
                  mutationStarted: job.mutationStarted,
                  fileCommitted: job.fileCommitted,
                  mayHaveChanged: job.mayHaveChanged,
                  cancelRequested: job.cancelRequested,
                  refreshRequired: job.refreshRequired,
                  cleanupRequired: job.cleanupRequired,
                }),
          errorCode: phase === 'intent' ? null : job.failureCode,
        }),
    },
    now: () => new Date(),
    monotonicNow: () => performance.now(),
    uuid: randomUUID,
    setTimer: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimer: (timer) => clearTimeout(timer),
  };
}
