import 'reflect-metadata';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { instanceToPlain, plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IS_DANGEROUS_OPERATION_KEY } from '@/common/decorators/metadata';
import { POLLING_ENDPOINT_KEY } from '@/common/decorators/throttle.decorator';
import { AppException } from '@/common/exceptions/app.exception';
import { THROTTLER_NAMES } from '@/core/throttler-config.module';
import { CleanupPreviewDto } from '@/file-ops/dto/cleanup-preview.dto';
import { DeleteExecuteDto } from '@/file-ops/dto/delete-execute.dto';
import { DeletePreviewDto } from '@/file-ops/dto/delete-preview.dto';
import {
  OperationIdParamDto,
  PreviewIdParamDto,
} from '@/file-ops/dto/file-ops-id-param.dto';
import { PreviewSummaryDto } from '@/file-ops/dto/preview-summary.dto';
import { TreeQueryDto } from '@/file-ops/dto/tree-query.dto';
import {
  FileOpsOperationEntity,
  FileOpsPreviewEntity,
  FileOpsTargetEntity,
  FileTreeLevelEntity,
  OperationStartEntity,
  PreviewStartEntity,
  PreviewSummaryEntity,
  TargetResultEntity,
} from '@/file-ops/entities/file-ops.entity';
import { FileOpsController } from '@/file-ops/file-ops.controller';
import { FileOpsService } from '@/file-ops/file-ops.service';
import type {
  IFileOpsOperation,
  IFileOpsPreview,
  IFileTreeLevel,
  IPreviewSummary,
} from '@/file-ops/interfaces/file-ops.types';

// TEST fixtures only; not business requirements.
const previewId = 'e4261d1d-590f-48a4-a765-d6dedcff17e4';
const operationId = '9b1f4a52-6c0e-4d7b-8f3a-2a1c5e7d9b10';
const at = '2026-11-01T00:00:00.000Z';
const preview = (): IFileOpsPreview => ({
  previewId,
  source: 'delete',
  status: 'completed',
  scanId: 'TEST-scan',
  progress: { measuredTargets: 1, totalTargets: 1 },
  targets: [
    {
      path: 'D:\\TEST-app\\node_modules',
      kind: 'node_modules',
      method: 'permanent',
      valid: true,
      failureCode: null,
      owner: { path: 'D:\\TEST-app', name: null },
      nestedProjects: [],
      hasLockfile: true,
      lastActivityAt: at,
      size: {
        status: 'done',
        apparentBytes: 120,
        sizeBytes: 100,
        reclaimableBytes: 70,
        sharedBytes: 30,
        fileCount: 2,
      },
      risk: {
        level: 'medium',
        reasons: [
          { code: 'RECENTLY_ACTIVE', level: 'medium', message: 'TEST recent' },
        ],
      },
      defaultSelected: true,
    },
  ],
  risk: { level: 'low', reasons: [] },
  confirmText: null,
  operationId: null,
  startedAt: at,
  finishedAt: at,
  failureCode: null,
});
const operation = (): IFileOpsOperation => ({
  operationId,
  previewId,
  status: 'completed',
  currentPath: null,
  results: [
    {
      path: 'D:\\TEST-app\\node_modules',
      kind: 'node_modules',
      method: 'permanent',
      status: 'failed',
      errorCode: 'FILE_IN_USE',
      mayBePartial: true,
      reclaimableBytes: 70,
    },
  ],
  startedAt: at,
  finishedAt: at,
});
const summary = (): IPreviewSummary => ({
  paths: ['D:\\TEST-app\\node_modules'],
  risk: { level: 'low', reasons: [] },
  confirmText: null,
  totals: { targetCount: 1, reclaimableBytes: 70, recycleBytes: 0 },
});
const tree = (): IFileTreeLevel => ({
  path: 'D:\\TEST-app',
  owner: { path: 'D:\\TEST-app', name: 'TEST-app' },
  entries: [
    {
      name: 'src',
      path: 'D:\\TEST-app\\src',
      type: 'directory',
      sizeBytes: null,
      selectable: true,
    },
  ],
  truncated: false,
});
const handler = (name: keyof FileOpsController): object =>
  Object.getOwnPropertyDescriptor(FileOpsController.prototype, name)!
    .value as object;
const strict = { whitelist: true, forbidNonWhitelisted: true };
const path = 'D:\\TEST-app\\node_modules';

async function isValid<T extends object>(
  dto: new () => T,
  value: object,
): Promise<boolean> {
  return (await validate(plainToInstance(dto, value), strict)).length === 0;
}

describe('FileOpsController contract', () => {
  const service = {
    getTree: jest.fn(() => Promise.resolve(tree())),
    startCleanupPreview: jest.fn(() => ({
      previewId,
      status: 'running' as const,
    })),
    startDeletePreview: jest.fn(() => ({
      previewId,
      status: 'running' as const,
    })),
    getPreview: jest.fn(preview),
    cancelPreview: jest.fn(preview),
    summarizePreview: jest.fn(summary),
    startExecute: jest.fn(() =>
      Promise.resolve({ operationId, status: 'running' as const }),
    ),
    getOperation: jest.fn(operation),
    cancelOperation: jest.fn(operation),
  };
  const controller = new FileOpsController(
    service as unknown as FileOpsService,
  );
  afterEach(() => jest.clearAllMocks());

  it('delegates tree and preview routes with their status codes and entities', async () => {
    const level = await controller.getTree({ path: 'D:\\TEST-app' });
    expect(level.statusCode).toBe(200);
    expect(level.data).toBeInstanceOf(FileTreeLevelEntity);
    expect(instanceToPlain(level.data)).toEqual(tree());
    expect(service.getTree).toHaveBeenCalledWith('D:\\TEST-app');

    const filters = { olderThanDays: 30 };
    const cleanup = controller.startCleanupPreview(filters);
    expect(cleanup).toMatchObject({
      statusCode: 202,
      data: { previewId, status: 'running' },
    });
    expect(cleanup.data).toBeInstanceOf(PreviewStartEntity);
    expect(service.startCleanupPreview).toHaveBeenCalledWith(filters);

    const started = controller.startDeletePreview({ paths: [path] });
    expect(started.statusCode).toBe(202);
    expect(started.data).toBeInstanceOf(PreviewStartEntity);
    expect(service.startDeletePreview).toHaveBeenCalledWith({ paths: [path] });

    const polled = controller.getPreview({ previewId });
    expect(polled.statusCode).toBe(200);
    expect(polled.data).toBeInstanceOf(FileOpsPreviewEntity);
    expect(polled.data?.targets[0]).toBeInstanceOf(FileOpsTargetEntity);
    expect(instanceToPlain(polled.data)).toEqual(preview());
    expect(service.getPreview).toHaveBeenCalledWith(previewId);

    const cancelled = controller.cancelPreview({ previewId });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.data).toBeInstanceOf(FileOpsPreviewEntity);
    expect(service.cancelPreview).toHaveBeenCalledWith(previewId);

    const summarized = controller.summarizePreview(
      { previewId },
      { paths: [path] },
    );
    expect(summarized.statusCode).toBe(200);
    expect(summarized.data).toBeInstanceOf(PreviewSummaryEntity);
    expect(instanceToPlain(summarized.data)).toEqual(summary());
    expect(service.summarizePreview).toHaveBeenCalledWith(previewId, [path]);
  });

  it('delegates execute and operation routes with their status codes and entities', async () => {
    const input = { previewId, paths: [path], confirm: true as const };
    const started = await controller.startExecute(input);
    expect(started).toMatchObject({
      statusCode: 202,
      data: { operationId, status: 'running' },
    });
    expect(started.data).toBeInstanceOf(OperationStartEntity);
    expect(service.startExecute).toHaveBeenCalledWith(input);

    const polled = controller.getOperation({ operationId });
    expect(polled.statusCode).toBe(200);
    expect(polled.data).toBeInstanceOf(FileOpsOperationEntity);
    expect(polled.data?.results[0]).toBeInstanceOf(TargetResultEntity);
    expect(instanceToPlain(polled.data)).toEqual(operation());
    expect(service.getOperation).toHaveBeenCalledWith(operationId);

    const cancelled = controller.cancelOperation({ operationId });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.data).toBeInstanceOf(FileOpsOperationEntity);
    expect(service.cancelOperation).toHaveBeenCalledWith(operationId);
  });

  it('declares the documented status code on every write route', () => {
    for (const route of [
      'startCleanupPreview',
      'startDeletePreview',
      'startExecute',
    ] as const) {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler(route))).toBe(202);
    }
    for (const route of [
      'cancelPreview',
      'summarizePreview',
      'cancelOperation',
    ] as const) {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler(route))).toBe(200);
    }
  });

  it('preserves application errors and their details for the shared filter', async () => {
    const changed = new AppException(409, 'Changed', 'TARGET_CHANGED', {
      paths: [path],
    });
    service.startExecute.mockRejectedValueOnce(changed);
    await expect(
      controller.startExecute({ previewId, paths: [path], confirm: true }),
    ).rejects.toBe(changed);
    service.getOperation.mockImplementationOnce(() => {
      throw changed;
    });
    expect(() => controller.getOperation({ operationId })).toThrow(changed);
  });

  it('marks only execute as dangerous and only the two polls as polling', () => {
    const routes = [
      'getTree',
      'startCleanupPreview',
      'startDeletePreview',
      'getPreview',
      'cancelPreview',
      'summarizePreview',
      'startExecute',
      'getOperation',
      'cancelOperation',
    ] as const;
    const polls: readonly string[] = ['getPreview', 'getOperation'];
    for (const route of routes) {
      expect(
        Reflect.hasMetadata(IS_DANGEROUS_OPERATION_KEY, handler(route)),
      ).toBe(route === 'startExecute');
      expect(Reflect.getMetadata(POLLING_ENDPOINT_KEY, handler(route))).toBe(
        polls.includes(route) ? true : undefined,
      );
      for (const name of THROTTLER_NAMES) {
        expect(
          Reflect.getMetadata(`THROTTLER:SKIP${name}`, handler(route)),
        ).toBe(polls.includes(route) ? true : undefined);
      }
    }
  });

  it('bounds delete and summary path lists', async () => {
    for (const dto of [DeletePreviewDto, PreviewSummaryDto]) {
      for (const paths of [
        [path],
        ['a'.repeat(32767)],
        Array.from({ length: 1000 }, (_, index) => `TEST-${index}`),
      ]) {
        expect(await isValid(dto, { paths })).toBe(true);
      }
      for (const value of [
        {},
        { paths: null },
        { paths: 'D:\\TEST-app' },
        { paths: [] },
        { paths: [''] },
        { paths: [42] },
        { paths: [null] },
        { paths: ['a'.repeat(32768)] },
        { paths: Array.from({ length: 1001 }, (_, index) => `TEST-${index}`) },
        { paths: [path], extra: true },
      ]) {
        expect(await isValid(dto, value)).toBe(false);
      }
    }
  });

  it('accepts only known cleanup filters with real numbers', async () => {
    for (const value of [
      {},
      { includeKinds: ['node_modules', 'orphan_node_modules', 'build_cache'] },
      { olderThanDays: 0, minSizeBytes: 0 },
      { olderThanDays: 30, minSizeBytes: Number.MAX_SAFE_INTEGER },
      { projectPaths: [path] },
    ]) {
      expect(await isValid(CleanupPreviewDto, value)).toBe(true);
    }
    for (const value of [
      { includeKinds: [] },
      { includeKinds: ['project'] },
      { includeKinds: 'node_modules' },
      { includeKinds: null },
      { olderThanDays: null },
      { olderThanDays: NaN },
      { olderThanDays: '30' },
      { olderThanDays: -1 },
      { olderThanDays: 1.5 },
      { minSizeBytes: null },
      { minSizeBytes: Number.MAX_SAFE_INTEGER + 1 },
      { projectPaths: [] },
      { projectPaths: [''] },
      { projectPaths: null },
      { projectPaths: ['a'.repeat(32768)] },
      { extra: true },
    ]) {
      expect(await isValid(CleanupPreviewDto, value)).toBe(false);
    }
  });

  it('requires a literal confirm true and typed confirmation fields on execute', async () => {
    const base = { previewId, paths: [path], confirm: true };
    for (const value of [
      base,
      { ...base, acknowledgedRisks: [] },
      { ...base, acknowledgedRisks: ['NO_LOCKFILE'], confirmText: 'DELETE 1' },
    ]) {
      expect(await isValid(DeleteExecuteDto, value)).toBe(true);
    }
    for (const value of [
      { paths: [path], confirm: true },
      { ...base, previewId: 'invalid' },
      { ...base, previewId: 'e4261d1d-590f-18a4-a765-d6dedcff17e4' },
      { ...base, paths: [] },
      { previewId, paths: [path] },
      { ...base, confirm: false },
      { ...base, confirm: 'true' },
      { ...base, confirm: 1 },
      { ...base, confirm: null },
      { ...base, acknowledgedRisks: null },
      { ...base, acknowledgedRisks: 'NO_LOCKFILE' },
      { ...base, acknowledgedRisks: [42] },
      { ...base, confirmText: null },
      { ...base, confirmText: 42 },
      { ...base, confirmText: 'a'.repeat(1025) },
      { ...base, extra: true },
    ]) {
      expect(await isValid(DeleteExecuteDto, value)).toBe(false);
    }
  });

  it('requires a bounded tree path and UUID v4 identifiers', async () => {
    expect(await isValid(TreeQueryDto, { path })).toBe(true);
    for (const value of [
      {},
      { path: '' },
      { path: [path] },
      { path: 'a'.repeat(32768) },
    ]) {
      expect(await isValid(TreeQueryDto, value)).toBe(false);
    }
    expect(await isValid(PreviewIdParamDto, { previewId })).toBe(true);
    expect(await isValid(OperationIdParamDto, { operationId })).toBe(true);
    for (const value of ['invalid', 'e4261d1d-590f-18a4-a765-d6dedcff17e4']) {
      expect(await isValid(PreviewIdParamDto, { previewId: value })).toBe(
        false,
      );
      expect(await isValid(OperationIdParamDto, { operationId: value })).toBe(
        false,
      );
    }
  });

  it('documents every operation, envelope, error code and nullable field', async () => {
    const module = await Test.createTestingModule({
      controllers: [FileOpsController],
      providers: [{ provide: FileOpsService, useValue: service }],
    }).compile();
    const app = module.createNestApplication();
    try {
      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      const operations: [string, 'get' | 'post', string, string[]][] = [
        ['/file-ops/tree', 'get', '200', ['400', '403', '404', '429']],
        ['/file-ops/cleanup/preview', 'post', '202', ['400', '404', '409']],
        ['/file-ops/delete/preview', 'post', '202', ['400', '404', '409']],
        ['/file-ops/previews/{previewId}', 'get', '200', ['400', '404']],
        ['/file-ops/previews/{previewId}/cancel', 'post', '200', ['400']],
        [
          '/file-ops/previews/{previewId}/summary',
          'post',
          '200',
          ['400', '404', '409'],
        ],
        ['/file-ops/delete/execute', 'post', '202', ['400', '404', '409']],
        ['/file-ops/operations/{operationId}', 'get', '200', ['400', '404']],
        ['/file-ops/operations/{operationId}/cancel', 'post', '200', ['404']],
      ];
      for (const [route, method, success, errors] of operations) {
        const operation = doc.paths[route]?.[method];
        expect(operation?.summary).toEqual(expect.any(String));
        expect(operation?.responses[success]).toMatchObject({
          content: {
            'application/json': {
              schema: {
                required: expect.arrayContaining([
                  'statusCode',
                  'message',
                  'code',
                  'data',
                  'timestamp',
                  'path',
                ]) as unknown,
              },
            },
          },
        });
        for (const code of [...errors, '429'])
          expect(operation?.responses[code]).toBeDefined();
      }
      expect(JSON.stringify(doc.paths['/file-ops/delete/execute'])).toContain(
        'TARGET_CHANGED',
      );
      expect(doc.components?.schemas?.FileOpsPreviewEntity).toMatchObject({
        properties: {
          operationId: { type: 'string', nullable: true },
          confirmText: { type: 'string', nullable: true },
          failureCode: { type: 'string', nullable: true },
        },
      });
      expect(doc.components?.schemas?.FileOpsOperationEntity).toMatchObject({
        properties: {
          currentPath: { type: 'string', nullable: true },
          status: {
            enum: ['running', 'stopping', 'completed', 'cancelled', 'failed'],
          },
        },
      });
      expect(doc.components?.schemas?.TargetResultEntity).toMatchObject({
        properties: {
          errorCode: { type: 'string', nullable: true },
          reclaimableBytes: { type: 'number', nullable: true },
        },
      });
    } finally {
      await app.close();
    }
  });
});
