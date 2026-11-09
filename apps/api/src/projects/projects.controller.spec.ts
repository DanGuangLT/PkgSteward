import { MODULE_METADATA } from '@nestjs/common/constants';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AppModule } from '@/app.module';
import {
  AppException,
  NotFoundException,
} from '@/common/exceptions/app.exception';
import { toPathPlatform } from '@/common/utils/path.util';
import { DiskUsageModule } from '@/disk-usage/disk-usage.module';
import { ScannerModule } from '@/scanner/scanner.module';
import type { IPathGuardService } from '@/core/path-guard/interfaces/path-guard.service.interface';
import type {
  IProjectFs,
  IProjectAnalysisJob,
  IProjectDetail,
  ProjectScanSnapshot,
} from '@/projects/interfaces/projects.types';
import type {
  IProjectRegistry,
  ProjectAnalyzer,
} from '@/projects/interfaces/projects.runtime';
import { ProjectAnalysisIdParamDto } from '@/projects/dto/project-analysis-id-param.dto';
import { ProjectPathQueryDto } from '@/projects/dto/project-path-query.dto';
import { StartProjectAnalysisDto } from '@/projects/dto/start-project-analysis.dto';
import {
  ProjectAdvisoryEntity,
  ProjectAnalysisJobEntity,
  ProjectAnalysisStartEntity,
  ProjectAuditSectionEntity,
  ProjectDeclarationEntity,
  ProjectDependencyEntity,
  ProjectDetailEntity,
  ProjectDiskUsageEntity,
  ProjectOutdatedEntity,
  ProjectOutdatedSectionEntity,
  ProjectScriptEntity,
} from '@/projects/entities/project.entity';
import { analyzeProject } from '@/projects/analysis/project-analysis';
import { ProjectRegistry } from '@/projects/registry/project-registry';
import {
  createProjectRegistry,
  createProjectsRuntime,
  ProjectsModule,
} from '@/projects/projects.module';
import { ProjectsController } from '@/projects/projects.controller';
import { ProjectsService } from '@/projects/projects.service';

const jobId = 'e4261d1d-590f-48a4-a765-d6dedcff17e4';
const timestamp = '2026-11-02T12:30:00.000Z';
const detail = (): IProjectDetail => ({
  path: 'D:\\projects\\demo',
  requestPath: 'D:\\projects\\demo',
  name: null,
  version: null,
  manager: 'npm',
  packageManager: null,
  lockfile: null,
  scanId: jobId,
  inputHash: 'hash',
  readAt: timestamp,
  dependencies: [
    {
      name: 'demo',
      declarations: [{ group: 'dependencies', spec: '^1.0.0' }],
      lockedVersions: [],
    },
  ],
  scripts: [{ name: 'postinstall', command: 'echo inert' }],
  warnings: ['NO_LOCKFILE'],
  diskUsage: { sizeBytes: 0, measuredAt: timestamp },
});
const job = (): IProjectAnalysisJob => ({
  jobId,
  status: 'completed',
  path: detail().path,
  requestPath: detail().requestPath,
  scanId: jobId,
  inputHash: 'hash',
  phase: 'done',
  partial: true,
  stale: false,
  startedAt: timestamp,
  finishedAt: timestamp,
  checkedAt: null,
  outdated: {
    state: 'partial',
    items: [
      {
        name: 'demo',
        registryName: 'demo',
        lockedVersions: [],
        wanted: null,
        latest: '2.0.0',
        behindWanted: null,
        behindLatest: null,
        warning: 'NO_LOCKFILE',
      },
    ],
    warningCodes: ['NO_LOCKFILE'],
    failureCode: null,
    checkedCount: 1,
    totalCount: 1,
  },
  audit: {
    state: 'partial',
    items: [
      {
        id: '42',
        name: 'demo',
        title: '<unsafe>',
        url: null,
        severity: 'unknown',
        range: '*',
        affectedVersions: ['1.0.0'],
        direct: true,
      },
    ],
    warningCodes: ['INVALID_REGISTRY_RESPONSE'],
    failureCode: 'INVALID_REGISTRY_RESPONSE',
    checkedCount: 1,
    totalCount: null,
  },
  warningCodes: ['NO_LOCKFILE'],
  failureCode: null,
});

describe('Projects DTO contract', () => {
  it.each([ProjectPathQueryDto, StartProjectAnalysisDto])(
    'validates %p paths without coercing values',
    (Dto) => {
      const validate = (input: object) =>
        validateSync(plainToInstance(Dto, input), {
          whitelist: true,
          forbidNonWhitelisted: true,
          forbidUnknownValues: false,
        });
      for (const input of [
        {},
        { path: '' },
        { path: 1 },
        { path: false },
        { path: null },
        { path: ['D:\\projects\\demo', 'D:\\projects\\other'] },
        { path: '../demo' },
        { path: 'D:relative' },
        { path: 'D:\\projects\\..\\demo' },
        { path: 'D:\\projects\\\0demo' },
        { path: `D:\\${'x'.repeat(32766)}` },
        { path: detail().path, extra: true },
      ])
        expect(validate(input).length).toBeGreaterThan(0);
      expect(validate({ path: detail().path })).toEqual([]);
      expect(validate({ path: 'D:\\dự án\\#&+ demo' })).toEqual([]);
      expect(validate({ path: `D:\\${'x'.repeat(32765)}` })).toEqual([]);
    },
  );

  it('accepts only UUID v4 and rejects additional param properties', () => {
    for (const input of [
      {},
      { jobId: 'bad' },
      { jobId: jobId.replace('48a4', '18a4') },
      { jobId, extra: true },
    ]) {
      const errors = validateSync(
        plainToInstance(ProjectAnalysisIdParamDto, input),
        {
          whitelist: true,
          forbidNonWhitelisted: true,
          forbidUnknownValues: false,
        },
      );
      expect(errors.length).toBeGreaterThan(0);
    }
    expect(
      validateSync(plainToInstance(ProjectAnalysisIdParamDto, { jobId })),
    ).toEqual([]);
  });
});

describe('ProjectsController', () => {
  const service = {
    detail: jest.fn<
      ReturnType<ProjectsService['detail']>,
      Parameters<ProjectsService['detail']>
    >(),
    start: jest.fn<
      ReturnType<ProjectsService['start']>,
      Parameters<ProjectsService['start']>
    >(),
    get: jest.fn<
      ReturnType<ProjectsService['get']>,
      Parameters<ProjectsService['get']>
    >(),
    cancel: jest.fn<
      ReturnType<ProjectsService['cancel']>,
      Parameters<ProjectsService['cancel']>
    >(),
  };
  let controller: ProjectsController;
  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      controllers: [ProjectsController],
      providers: [{ provide: ProjectsService, useValue: service }],
    }).compile();
    controller = module.get(ProjectsController);
  });

  it('returns local detail in a 200 envelope with nested entity instances and known zero disk bytes', async () => {
    service.detail.mockResolvedValue(detail());
    const response = await controller.detail({ path: detail().requestPath });
    expect(response.statusCode).toBe(200);
    expect(response.message).toEqual(expect.any(String));
    expect(response.data).toEqual(detail());
    expect(response.data).toBeInstanceOf(ProjectDetailEntity);
    expect(response.data?.dependencies[0]).toBeInstanceOf(
      ProjectDependencyEntity,
    );
    expect(response.data?.dependencies[0].declarations[0]).toBeInstanceOf(
      ProjectDeclarationEntity,
    );
    expect(response.data?.scripts[0]).toBeInstanceOf(ProjectScriptEntity);
    expect(response.data?.diskUsage).toBeInstanceOf(ProjectDiskUsageEntity);
    expect(service.detail).toHaveBeenCalledWith(detail().requestPath);
    expect(service.start).not.toHaveBeenCalled();
  });

  it('returns an accepted start without reading the snapshot or running a second analysis', async () => {
    service.start.mockResolvedValue({ jobId, status: 'running' });
    const result = await controller.start({ path: detail().path });
    expect(result.statusCode).toBe(202);
    expect(result.data).toBeInstanceOf(ProjectAnalysisStartEntity);
    expect(result.data).toEqual({ jobId, status: 'running' });
    expect(service.start).toHaveBeenCalledTimes(1);
    expect(service.start).toHaveBeenCalledWith({ path: detail().path });
    expect(service.get).not.toHaveBeenCalled();
  });

  it('returns a synchronous snapshot and preserves nulls, unknown severity and partial sections', () => {
    service.get.mockReturnValue(job());
    const response = controller.get({ jobId });
    expect(response).not.toBeInstanceOf(Promise);
    expect(response.statusCode).toBe(200);
    expect(response.data).toEqual(job());
    expect(response.data).toBeInstanceOf(ProjectAnalysisJobEntity);
    expect(response.data?.outdated).toBeInstanceOf(
      ProjectOutdatedSectionEntity,
    );
    expect(response.data?.outdated.items[0]).toBeInstanceOf(
      ProjectOutdatedEntity,
    );
    expect(response.data?.audit).toBeInstanceOf(ProjectAuditSectionEntity);
    expect(response.data?.audit.items[0]).toBeInstanceOf(ProjectAdvisoryEntity);
    expect(service.get).toHaveBeenCalledWith(jobId);
    expect(service.detail).not.toHaveBeenCalled();
  });

  it('returns a 200 snapshot for cancellation', () => {
    service.cancel.mockReturnValue({
      ...job(),
      status: 'cancelled',
      failureCode: 'CANCELLED',
    });
    const response = controller.cancel({ jobId });
    expect(response.statusCode).toBe(200);
    expect(response.data?.status).toBe('cancelled');
    expect(response.data).toBeInstanceOf(ProjectAnalysisJobEntity);
    expect(service.cancel).toHaveBeenCalledWith(jobId);
  });

  it('preserves structural service exceptions rather than wrapping their code or details', async () => {
    const conflict = new AppException(409, 'Analysis running', 'CONFLICT', {
      reason: 'ANALYSIS_RUNNING',
      jobId,
      path: detail().requestPath,
    });
    service.start.mockRejectedValue(conflict);
    await expect(controller.start({ path: detail().path })).rejects.toBe(
      conflict,
    );
  });
});

describe('Projects production wiring', () => {
  it('registers ProjectsModule in AppModule and depends on Scanner/DiskUsage only in the forward direction', () => {
    const appImports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      AppModule,
    ) as unknown[];
    const projectImports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      ProjectsModule,
    ) as unknown[];
    const scannerImports = (Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      ScannerModule,
    ) ?? []) as unknown[];
    expect(appImports).toContain(ProjectsModule);
    expect(projectImports).toContain(ScannerModule);
    expect(projectImports).toContain(DiskUsageModule);
    expect(scannerImports).not.toContain(ProjectsModule);
  });

  it('creates a registry instance for the shared provider rather than a per-request transport', () => {
    expect(createProjectRegistry()).toBeInstanceOf(ProjectRegistry);
  });

  const makeRuntime = (timeout: number | string | undefined = undefined) => {
    const fs: IProjectFs = {
      lstat: jest.fn<
        ReturnType<IProjectFs['lstat']>,
        Parameters<IProjectFs['lstat']>
      >(),
      realpath: jest.fn<
        ReturnType<IProjectFs['realpath']>,
        Parameters<IProjectFs['realpath']>
      >(),
      readChunks: jest.fn<
        ReturnType<IProjectFs['readChunks']>,
        Parameters<IProjectFs['readChunks']>
      >(),
    };
    const registry: IProjectRegistry = {
      getPackageMetadata: jest.fn<
        ReturnType<IProjectRegistry['getPackageMetadata']>,
        Parameters<IProjectRegistry['getPackageMetadata']>
      >(),
      getBulkAdvisories: jest.fn<
        ReturnType<IProjectRegistry['getBulkAdvisories']>,
        Parameters<IProjectRegistry['getBulkAdvisories']>
      >(),
    };
    const analyze: ProjectAnalyzer = analyzeProject;
    const scanner = {
      getLatest: jest.fn<ProjectScanSnapshot | null | undefined, []>(() => ({
        scanId: jobId,
        projects: [],
      })),
    };
    const gate = { assertIdle: jest.fn<void, []>() };
    const disk = {
      peekCompletedSize: jest.fn(() => ({
        sizeBytes: 0,
        measuredAt: timestamp,
      })),
    };
    const guard = {
      assertAllowed: jest.fn<
        ReturnType<IPathGuardService['assertAllowed']>,
        Parameters<IPathGuardService['assertAllowed']>
      >(),
    };
    const config = new ConfigService({ NPM_COMMAND_TIMEOUT_MS: timeout });
    const runtime = createProjectsRuntime(
      fs,
      registry,
      analyze,
      scanner,
      gate,
      disk,
      guard,
      config,
    );
    return { runtime, fs, registry, analyze, scanner, gate, disk, guard };
  };

  it('passes injected adapters through, uses canonical guard paths, and delegates disk peeks and the start gate', async () => {
    const { runtime, fs, registry, analyze, scanner, gate, disk, guard } =
      makeRuntime();
    expect(runtime.input.fs).toBe(fs);
    expect(runtime.registry).toBe(registry);
    expect(runtime.analyze).toBe(analyze);
    expect(runtime.lifecycle.getLatest()).toEqual({
      scanId: jobId,
      projects: [],
    });
    expect(scanner.getLatest).toHaveBeenCalledTimes(1);
    runtime.lifecycle.assertIdle();
    expect(gate.assertIdle).toHaveBeenCalledTimes(1);
    expect(
      runtime.lifecycle.peekCompletedSize('D:\\canonical\\node_modules'),
    ).toEqual({ sizeBytes: 0, measuredAt: timestamp });
    expect(disk.peekCompletedSize).toHaveBeenCalledWith(
      'D:\\canonical\\node_modules',
    );
    guard.assertAllowed.mockResolvedValue({
      realPath: 'D:\\canonical',
    } as Awaited<ReturnType<IPathGuardService['assertAllowed']>>);
    expect(await runtime.input.assertAllowed('D:\\alias')).toBe(
      'D:\\canonical',
    );
    expect(guard.assertAllowed).toHaveBeenCalledWith('D:\\alias');
    expect(runtime.input.now()).toBeInstanceOf(Date);
    expect(runtime.lifecycle.now()).toBeInstanceOf(Date);
    expect(runtime.input.platform).toBe(toPathPlatform());
  });

  it.each([undefined, ''])(
    'maps empty/unset timeout %p to no deadline',
    (timeout) => {
      expect(makeRuntime(timeout).runtime.lifecycle.timeoutMs).toBeUndefined();
    },
  );

  it('reads the configured entire-job deadline', () => {
    expect(makeRuntime(1200).runtime.lifecycle.timeoutMs).toBe(1200);
  });

  it.each([null, undefined])(
    'normalizes absent scan %p to NOT_FOUND instead of leaking a reader TypeError',
    (snapshot) => {
      const { runtime, scanner } = makeRuntime();
      scanner.getLatest.mockReturnValue(snapshot);
      expect(() => runtime.lifecycle.getLatest()).toThrow(NotFoundException);
    },
  );

  it('preserves an existing NOT_FOUND from the scan service', () => {
    const { runtime, scanner } = makeRuntime();
    const missing = new AppException(404, 'No scan available', 'NOT_FOUND');
    scanner.getLatest.mockImplementation(() => {
      throw missing;
    });
    expect(() => runtime.lifecycle.getLatest()).toThrow(missing);
  });
});

describe('Projects Swagger contract', () => {
  let app: INestApplication;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('documents the four envelopes, required nullable fields, section states and conflict alternatives', async () => {
    const module = await Test.createTestingModule({
      controllers: [ProjectsController],
      providers: [{ provide: ProjectsService, useValue: {} }],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    expect(doc.paths['/projects']?.get?.responses['200']).toBeDefined();
    expect(
      doc.paths['/projects/analyses']?.post?.responses['202'],
    ).toBeDefined();
    expect(
      doc.paths['/projects/analyses/{jobId}']?.get?.responses['200'],
    ).toBeDefined();
    expect(
      doc.paths['/projects/analyses/{jobId}/cancel']?.post?.responses['200'],
    ).toBeDefined();
    const schemas = doc.components?.schemas;
    const detail = schemas?.ProjectDetailEntity as { required?: string[] };
    expect(detail.required).toEqual(
      expect.arrayContaining([
        'name',
        'version',
        'packageManager',
        'lockfile',
        'diskUsage',
      ]),
    );
    expect(detail).toMatchObject({
      properties: { name: { nullable: true }, diskUsage: { nullable: true } },
    });
    const job = schemas?.ProjectAnalysisJobEntity as { required?: string[] };
    expect(job.required).toEqual(
      expect.arrayContaining(['checkedAt', 'finishedAt', 'failureCode']),
    );
    expect(job).toMatchObject({
      properties: {
        checkedAt: { nullable: true },
        finishedAt: { nullable: true },
        failureCode: { nullable: true },
      },
    });
    expect(schemas?.ProjectOutdatedEntity).toMatchObject({
      properties: {
        wanted: { nullable: true },
        latest: { nullable: true },
        behindWanted: { nullable: true },
        behindLatest: { nullable: true },
      },
    });
    expect(schemas?.ProjectAuditSectionEntity).toMatchObject({
      properties: {
        state: {
          enum: ['pending', 'running', 'complete', 'partial', 'unavailable'],
        },
        totalCount: { nullable: true },
        failureCode: { nullable: true },
      },
    });
    const start = doc.paths['/projects/analyses']?.post;
    for (const status of ['400', '403', '404', '409', '429'])
      expect(start?.responses[status]).toBeDefined();
    // Gate conflicts cannot be documented as always carrying a followable job.
    expect(JSON.stringify(start?.responses['409'])).toContain(
      'ANALYSIS_RUNNING',
    );
    expect(JSON.stringify(start?.responses['409'])).toContain(
      'PROJECT_NOT_SCANNED',
    );
    for (const path of Object.values(doc.paths)) {
      const operation = path.get ?? path.post;
      expect(operation?.summary).toEqual(expect.any(String));
    }
  });
});
