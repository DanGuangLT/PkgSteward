import { Inject, Injectable, Optional } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { lstat } from 'node:fs/promises';
import {
  NotFoundException,
  ValidationException,
} from '@/common/exceptions/app.exception';
import { nodeRuntimeNotice } from '@/config/node-runtime';
import { PathGuardService } from '@/core/path-guard/path-guard.service';
import {
  NodeRuntimeOverviewEntity,
  ProjectNodeRuntimeDetailEntity,
} from '@/node-runtime/entities/node-runtime.entity';
import type {
  INodeManagerInfo,
  INodeRuntimeOverview,
  INodeRuntimeSummaryCounts,
  IProjectNodeCompatibility,
  IProjectNodeRuntimeDetail,
} from '@/node-runtime/interfaces/node-runtime.types';
import type { INodeRuntimeService } from '@/node-runtime/interfaces/node-runtime.service.interface';
import {
  evaluateProjectNodeCompatibility,
  sortUniqueSemver,
} from '@/node-runtime/parsers/node-version.parser';
import {
  NODE_MANAGER_PROBE_RUNNER,
  probeAllNodeManagers,
  type ProbeExecRunner,
} from '@/node-runtime/probes/node-manager.probe';
import {
  readProjectNodeConfig,
  type IProjectNodeConfigRead,
} from '@/node-runtime/probes/project-node-reader';
import type { IScanResult } from '@/scanner/interfaces/scanner.types';
import { ScannerService } from '@/scanner/scanner.service';

export const NODE_RUNTIME_PROJECT_READER = Symbol(
  'NODE_RUNTIME_PROJECT_READER',
);
export const NODE_RUNTIME_DIR_CHECKER = Symbol('NODE_RUNTIME_DIR_CHECKER');

export type ProjectConfigReader = (
  projectDir: string,
) => Promise<IProjectNodeConfigRead>;
export type DirectoryChecker = (realPath: string) => Promise<boolean>;

const PROBE_CACHE_TTL_MS = 30_000;
const PROJECT_READ_CONCURRENCY = 8;

async function defaultDirectoryChecker(realPath: string): Promise<boolean> {
  try {
    return (await lstat(realPath)).isDirectory();
  } catch {
    return false;
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

@Injectable()
export class NodeRuntimeService implements INodeRuntimeService {
  private cachedManagers?: {
    expiresAt: number;
    managers: INodeManagerInfo[];
  };
  private inFlightProbe?: Promise<INodeManagerInfo[]>;

  constructor(
    private readonly scanner: ScannerService,
    private readonly pathGuard: PathGuardService,
    @Inject(NODE_MANAGER_PROBE_RUNNER)
    private readonly probeRunner: ProbeExecRunner,
    @Optional()
    @Inject(NODE_RUNTIME_PROJECT_READER)
    private readonly readConfig: ProjectConfigReader = (dir) =>
      readProjectNodeConfig(dir),
    @Optional()
    @Inject(NODE_RUNTIME_DIR_CHECKER)
    private readonly isDirectory: DirectoryChecker = defaultDirectoryChecker,
  ) {}

  private async getManagers(refresh: boolean): Promise<INodeManagerInfo[]> {
    const now = Date.now();
    if (
      !refresh &&
      this.cachedManagers &&
      now < this.cachedManagers.expiresAt
    ) {
      return this.cachedManagers.managers;
    }

    if (!refresh && this.inFlightProbe) {
      return this.inFlightProbe;
    }

    const probePromise = probeAllNodeManagers(this.probeRunner).then(
      (managers) => {
        this.cachedManagers = {
          expiresAt: Date.now() + PROBE_CACHE_TTL_MS,
          managers,
        };
        return managers;
      },
    );

    if (!refresh) {
      this.inFlightProbe = probePromise;
    }

    try {
      return await probePromise;
    } finally {
      if (this.inFlightProbe === probePromise) {
        this.inFlightProbe = undefined;
      }
    }
  }

  private getLatestScanOrNull(): IScanResult | null {
    try {
      return this.scanner.getLatest();
    } catch (error) {
      if (error instanceof NotFoundException) {
        return null;
      }
      throw error;
    }
  }

  private summarizeCounts(
    projects: readonly IProjectNodeCompatibility[],
  ): INodeRuntimeSummaryCounts {
    const counts: INodeRuntimeSummaryCounts = {
      total: projects.length,
      compatible: 0,
      mismatch: 0,
      unknown: 0,
      undeclared: 0,
    };
    for (const project of projects) {
      counts[project.status] += 1;
    }
    return counts;
  }

  async getOverview(refresh = false): Promise<INodeRuntimeOverview> {
    const activeNodeVersion = process.versions.node;
    const activeVersionSupported =
      nodeRuntimeNotice(activeNodeVersion) === null;
    const managers = await this.getManagers(refresh);
    const installedVersions = sortUniqueSemver(
      managers.flatMap((manager) => manager.installedVersions),
    );
    const latest = this.getLatestScanOrNull();

    let projects: IProjectNodeCompatibility[] = [];
    if (latest && latest.projects.length > 0) {
      const checks = await this.pathGuard.checkMany(
        latest.projects.map((scannedProject) => scannedProject.path),
      );
      const allowedProjects = latest.projects.flatMap(
        (scannedProject, index) => {
          const check = checks[index];
          return check?.allowed
            ? [{ scannedProject, realPath: check.path.realPath }]
            : [];
        },
      );
      const evaluated = await mapWithConcurrency(
        allowedProjects,
        PROJECT_READ_CONCURRENCY,
        async ({ scannedProject, realPath }) => {
          if (!(await this.isDirectory(realPath))) return null;

          const config = await this.readConfig(realPath);
          return evaluateProjectNodeCompatibility({
            projectPath: scannedProject.path,
            projectName: scannedProject.name ?? config.packageName,
            activeVersion: activeNodeVersion,
            requirements: config.requirements,
            installedVersions,
            managers,
          });
        },
      );
      projects = evaluated.filter(
        (item): item is IProjectNodeCompatibility => item !== null,
      );
    }

    return plainToInstance(NodeRuntimeOverviewEntity, {
      activeNodeVersion,
      activeVersionSupported,
      checkedAt: new Date().toISOString(),
      scanId: latest?.scanId ?? null,
      managers,
      installedVersions,
      counts: this.summarizeCounts(projects),
      projects,
    });
  }

  async getProjectDetail(rawPath: string): Promise<IProjectNodeRuntimeDetail> {
    const guarded = await this.pathGuard.assertAllowed(rawPath);
    if (!(await this.isDirectory(guarded.realPath))) {
      throw new ValidationException('Project path must be a directory', {
        path: rawPath,
      });
    }

    const activeNodeVersion = process.versions.node;
    const activeVersionSupported =
      nodeRuntimeNotice(activeNodeVersion) === null;
    const [managers, config] = await Promise.all([
      this.getManagers(false),
      this.readConfig(guarded.realPath),
    ]);
    const installedVersions = sortUniqueSemver(
      managers.flatMap((manager) => manager.installedVersions),
    );

    const project = evaluateProjectNodeCompatibility({
      projectPath: guarded.resolvedPath,
      projectName: config.packageName,
      activeVersion: activeNodeVersion,
      requirements: config.requirements,
      installedVersions,
      managers,
    });

    return plainToInstance(ProjectNodeRuntimeDetailEntity, {
      checkedAt: new Date().toISOString(),
      activeNodeVersion,
      activeVersionSupported,
      managers,
      project,
    });
  }
}
