import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PackageManagersModule } from '@/package-managers/package-managers.module';
import { PackageManagersService } from '@/package-managers/package-managers.service';
import { PM_FS, PM_RUNTIME } from '@/package-managers/interfaces/pm.runtime';
import { pmLifecycleFixture } from '@/package-managers/__fixtures__/pm-lifecycle.fixture';
import type { IPmRuntime } from '@/package-managers/interfaces/pm.runtime';
import { MutationGateService } from '@/core/mutation-gate/mutation-gate.service';
import { ScannerService } from '@/scanner/scanner.service';
import { DiskUsageService } from '@/disk-usage/disk-usage.service';
import { FileOpsService } from '@/file-ops/file-ops.service';
import { ProjectsService } from '@/projects/projects.service';
import { PathGuardService } from '@/core/path-guard/path-guard.service';
import { AuditLogService } from '@/core/audit-log/audit-log.service';
import { ConfigService } from '@nestjs/config';
import { ProjectRegistry } from '@/projects/registry/project-registry';
import type { IPmFs } from '@/package-managers/interfaces/pm.runtime';
import type { IProjectRegistry } from '@/projects/interfaces/projects.runtime';

// Expected RED: module absent; lazy bindings, same gate, static registry, no process module.
describe('M9 module bindings', () => {
  it.each([
    'pinning/pm-preview.ts',
    'execution/pm-job.ts',
    'package-managers.service.ts',
    'package-managers.controller.ts',
    'package-managers.module.ts',
  ])('keeps %s free of child-process imports and launches', (file) => {
    const source = readFileSync(join(__dirname, file), 'utf8');
    expect(source).not.toMatch(
      /(?:from|import\s*\()\s*['"](?:execa|(?:node:)?child_process)['"]/,
    );
    expect(source).not.toMatch(
      /\b(?:spawn|spawnSync|execFile|execSync|fork)\s*\(/,
    );
  });
  it('imports only readers and safety infrastructure, not the process adapters', () => {
    const imports = Reflect.getMetadata('imports', PackageManagersModule) as {
      name: string;
    }[];
    const names = imports.map((item) => item.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'ScannerModule',
        'DiskUsageModule',
        'FileOpsModule',
        'ProjectsModule',
        'MutationGateModule',
        'AuditLogModule',
        'PathGuardModule',
      ]),
    );
    for (const forbidden of [
      'GlobalPackagesModule',
      'NpmRunnerModule',
      'PlatformModule',
    ])
      expect(names).not.toContain(forbidden);
  });
  it('factory construction does not read/fetch/write and binds the shared singleton gate', () => {
    const f = pmLifecycleFixture();
    type Factory = {
      provide: symbol;
      inject: unknown[];
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
        registry: IProjectRegistry,
      ) => IPmRuntime;
    };
    const providers = Reflect.getMetadata(
      'providers',
      PackageManagersModule,
    ) as (Factory | typeof PackageManagersService)[];
    const provider = providers.find(
      (entry): entry is Factory =>
        typeof entry !== 'function' && entry.provide === PM_RUNTIME,
    )!;
    expect(provider.inject).toEqual([
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
    ]);
    const runtime = provider.useFactory(
      f.fs,
      {} as ScannerService,
      {} as DiskUsageService,
      {} as FileOpsService,
      {} as ProjectsService,
      f.gate,
      {} as PathGuardService,
      {} as AuditLogService,
      new ConfigService({ SCAN_ROOT_PATHS: '*', NPM_COMMAND_TIMEOUT_MS: '' }),
      {
        getPackageMetadata: f.getPackageMetadata,
      } as unknown as IProjectRegistry,
    );
    new PackageManagersService(runtime);
    expect(f.open).not.toHaveBeenCalled();
    expect(f.rename).not.toHaveBeenCalled();
    expect(f.getPackageMetadata).not.toHaveBeenCalled();
    const token = runtime.gate.tryEnter();
    expect(f.gate.isBusy()).toBe(true);
    expect(f.gate.tryEnter()).toBeNull();
    runtime.gate.leave(token!);
    expect(f.gate.isBusy()).toBe(false);
  });
});
