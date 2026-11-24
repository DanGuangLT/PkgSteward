import {
  NotFoundException,
  ValidationException,
} from '@/common/exceptions/app.exception';
import type {
  IGuardedPath,
  PathCheckResult,
} from '@/core/path-guard/interfaces/path-guard.types';
import type { PathGuardService } from '@/core/path-guard/path-guard.service';
import type { ScannerService } from '@/scanner/scanner.service';
import type { IScanResult } from '@/scanner/interfaces/scanner.types';
import { NodeRuntimeService } from '@/node-runtime/node-runtime.service';
import type { ProbeExecRunner } from '@/node-runtime/probes/node-manager.probe';
import type { ProjectConfigReader } from '@/node-runtime/node-runtime.service';

describe('NodeRuntimeService', () => {
  const makeGuarded = (dir: string): IGuardedPath => ({
    inputPath: dir,
    resolvedPath: dir,
    realPath: dir,
    isSymbolicLink: false,
  });

  it('returns clean overview with scanId=null and empty projects when no scan is cached', async () => {
    const scanner = {
      getLatest: jest.fn(() => {
        throw new NotFoundException('Latest scan');
      }),
    } as unknown as ScannerService;

    const pathGuard = {
      check: jest.fn(),
      assertAllowed: jest.fn(),
    } as unknown as PathGuardService;

    const probeRunner: ProbeExecRunner = jest.fn(() =>
      Promise.resolve({
        exitCode: 1,
        stdout: '',
        failed: true,
        timedOut: false,
      }),
    );

    const service = new NodeRuntimeService(
      scanner,
      pathGuard,
      probeRunner,
      jest.fn(),
      jest.fn(() => Promise.resolve(true)),
    );

    const overview = await service.getOverview(false);

    expect(overview.scanId).toBeNull();
    expect(overview.projects).toEqual([]);
    expect(overview.counts).toEqual({
      total: 0,
      compatible: 0,
      mismatch: 0,
      unknown: 0,
      undeclared: 0,
    });
    expect(overview.managers.every((m) => !m.detected)).toBe(true);
    expect(overview.activeNodeVersion).toBe(process.versions.node);
  });

  it('caches manager probes for 30s TTL and bypasses cache on refresh=true', async () => {
    const latest: IScanResult = {
      scanId: 'scan-1',
      status: 'completed',
      partial: false,
      roots: ['D:\\Projects'],
      maxDepth: 0,
      startedAt: '2026-11-24T00:00:00.000Z',
      finishedAt: '2026-11-24T00:00:01.000Z',
      skippedCount: 0,
      orphanNodeModules: [],
      projects: [
        {
          path: 'D:\\Projects\\allowed-a',
          name: 'allowed-a',
          packageManager: 'pnpm',
          hasLockfile: true,
          lastActivityAt: '2026-11-24T00:00:00.000Z',
          nodeModules: {
            exists: true,
            path: 'D:\\Projects\\allowed-a\\node_modules',
            sizeBytes: null,
            sizeMeasuredAt: null,
          },
        },
        {
          path: 'D:\\Projects\\gone-b',
          name: 'gone-b',
          packageManager: 'npm',
          hasLockfile: true,
          lastActivityAt: '2026-11-24T00:00:00.000Z',
          nodeModules: {
            exists: false,
            path: 'D:\\Projects\\gone-b\\node_modules',
            sizeBytes: null,
            sizeMeasuredAt: null,
          },
        },
      ],
    };

    const scanner = {
      getLatest: jest.fn(() => latest),
    } as unknown as ScannerService;

    const pathGuard = {
      check: jest.fn((p: string): Promise<PathCheckResult> => {
        if (p.endsWith('allowed-a')) {
          return Promise.resolve({ allowed: true, path: makeGuarded(p) });
        }
        return Promise.resolve({
          allowed: false,
          code: 'NOT_FOUND',
          message: 'missing',
        });
      }),
      assertAllowed: jest.fn(),
    } as unknown as PathGuardService;

    const probeRunner = jest.fn<
      ReturnType<ProbeExecRunner>,
      Parameters<ProbeExecRunner>
    >((file) => {
      if (file === 'nvm') {
        return Promise.resolve({
          exitCode: 0,
          stdout: '* 24.19.0\n  20.18.1\n',
          failed: false,
          timedOut: false,
        });
      }
      return Promise.resolve({
        exitCode: 1,
        stdout: '',
        failed: true,
        timedOut: false,
      });
    });

    const readConfig: ProjectConfigReader = jest.fn(() =>
      Promise.resolve({
        packageName: 'allowed-a',
        requirements: [
          {
            source: '.nvmrc' as const,
            raw: '20.18.1',
            normalizedRange: '20.18.1',
            suggestedVersion: '20.18.1',
          },
        ],
      }),
    );

    const service = new NodeRuntimeService(
      scanner,
      pathGuard,
      probeRunner,
      readConfig,
      jest.fn(() => Promise.resolve(true)),
    );

    const first = await service.getOverview(false);
    expect(probeRunner).toHaveBeenCalledTimes(3);
    expect(first.scanId).toBe('scan-1');
    expect(first.projects).toHaveLength(1);
    expect(first.counts.total).toBe(1);
    expect(first.installedVersions).toEqual(['24.19.0', '20.18.1']);

    await service.getOverview(false);
    expect(probeRunner).toHaveBeenCalledTimes(3);

    await service.getOverview(true);
    expect(probeRunner).toHaveBeenCalledTimes(6);
  });

  it('enforces PathGuardService and directory validation on getProjectDetail', async () => {
    const scanner = {
      getLatest: jest.fn(),
    } as unknown as ScannerService;

    const pathGuard = {
      check: jest.fn(),
      assertAllowed: jest.fn((rawPath: string) => {
        if (rawPath.includes('file.txt')) {
          return Promise.resolve(makeGuarded(rawPath));
        }
        if (rawPath.includes('valid')) {
          return Promise.resolve(makeGuarded(rawPath));
        }
        return Promise.reject(new NotFoundException('Path', rawPath));
      }),
    } as unknown as PathGuardService;

    const probeRunner: ProbeExecRunner = jest.fn(() =>
      Promise.resolve({
        exitCode: 1,
        stdout: '',
        failed: true,
        timedOut: false,
      }),
    );

    const readConfig: ProjectConfigReader = jest.fn(() =>
      Promise.resolve({
        packageName: 'valid-app',
        requirements: [
          {
            source: 'package.json#engines.node' as const,
            raw: '>=22.18',
            normalizedRange: '>=22.18.0',
            suggestedVersion: '22.18.0',
          },
        ],
      }),
    );

    const isDir = jest.fn((p: string) =>
      Promise.resolve(!p.includes('file.txt')),
    );

    const service = new NodeRuntimeService(
      scanner,
      pathGuard,
      probeRunner,
      readConfig,
      isDir,
    );

    await expect(
      service.getProjectDetail('D:\\Projects\\missing'),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.getProjectDetail('D:\\Projects\\file.txt'),
    ).rejects.toThrow(ValidationException);

    const detail = await service.getProjectDetail('D:\\Projects\\valid');
    expect(detail.project.name).toBe('valid-app');
    expect(detail.project.requirements).toHaveLength(1);
  });
});
