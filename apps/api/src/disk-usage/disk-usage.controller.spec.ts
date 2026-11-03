import 'reflect-metadata';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { instanceToPlain, plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AppException,
  NotFoundException,
} from '@/common/exceptions/app.exception';
import { POLLING_ENDPOINT_KEY } from '@/common/decorators/throttle.decorator';
import { THROTTLER_NAMES } from '@/core/throttler-config.module';
import { DiskUsageController } from '@/disk-usage/disk-usage.controller';
import { DiskUsageService } from '@/disk-usage/disk-usage.service';
import { StartDiskUsageDto } from '@/disk-usage/dto/start-disk-usage.dto';
import { DiskUsageIdParamDto } from '@/disk-usage/dto/disk-usage-id-param.dto';
import {
  DiskUsageJobEntity,
  DiskUsageProgressEntity,
  DiskUsageRowEntity,
  DiskUsageStartEntity,
} from '@/disk-usage/entities/disk-usage.entity';
import type { IDiskUsageJob } from '@/disk-usage/interfaces/disk-usage.types';

const jobId = 'e4261d1d-590f-48a4-a765-d6dedcff17e4';
const measuredAt = '2026-10-27T00:00:00.000Z';
const job = (): IDiskUsageJob => ({
  jobId,
  status: 'completed',
  path: '/fixture',
  view: 'directory',
  metric: 'unique-apparent',
  phase: 'measuring',
  partial: false,
  stopReason: null,
  sizeBytes: 0,
  fileCount: 0,
  children: [
    {
      path: '/fixture/empty',
      name: 'empty',
      kind: 'directory',
      canonicalPath: '/fixture/empty',
      aliases: [],
      state: 'complete',
      sizeBytes: 0,
      fileCount: 0,
      reason: null,
    },
  ],
  progress: {
    visitedDirs: 2,
    visitedEntries: 1,
    skippedCount: 0,
    skippedLinks: 0,
  },
  startedAt: measuredAt,
  finishedAt: measuredAt,
  measuredAt,
  cacheHit: false,
  failureCode: null,
});
const handler = (name: keyof DiskUsageController): object =>
  Object.getOwnPropertyDescriptor(DiskUsageController.prototype, name)!
    .value as object;

describe('DiskUsageController contract', () => {
  const service = {
    start: jest.fn(() =>
      Promise.resolve({ jobId, status: 'completed' as const }),
    ),
    get: jest.fn(job),
    cancel: jest.fn(job),
  };
  const controller = new DiskUsageController(
    service as unknown as DiskUsageService,
  );
  afterEach(() => jest.clearAllMocks());

  it('delegates start/poll/cancel and returns 202/200 envelopes, including a cache hit', async () => {
    const input = { path: '/fixture', view: 'directory' as const, force: true };
    const started = await controller.start(input);
    expect(started).toMatchObject({
      statusCode: 202,
      message: expect.any(String) as unknown,
      data: { jobId, status: 'completed' },
    });
    expect(started.data).toBeInstanceOf(DiskUsageStartEntity);
    const polled = controller.get({ jobId });
    expect(polled).toMatchObject({
      statusCode: 200,
      message: expect.any(String) as unknown,
    });
    expect(instanceToPlain(polled.data)).toEqual(job());
    expect(polled.data).toBeInstanceOf(DiskUsageJobEntity);
    expect(polled.data?.progress).toBeInstanceOf(DiskUsageProgressEntity);
    expect(polled.data?.children[0]).toBeInstanceOf(DiskUsageRowEntity);
    const cancelled = controller.cancel({ jobId });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.data).toBeInstanceOf(DiskUsageJobEntity);
    expect(instanceToPlain(cancelled.data)).toEqual(job());
    expect(service.start).toHaveBeenCalledWith(input);
    expect(service.get).toHaveBeenCalledWith(jobId);
    expect(service.cancel).toHaveBeenCalledWith(jobId);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler('start'))).toBe(202);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler('cancel'))).toBe(
      200,
    );
  });

  it('preserves application errors and conflict details for the shared filter', async () => {
    const conflict = new AppException(409, 'Measurement running', 'CONFLICT', {
      jobId,
      path: '/fixture',
    });
    service.start.mockRejectedValueOnce(conflict);
    await expect(async () => controller.start({ path: '/other' })).rejects.toBe(
      conflict,
    );
    const missing = new NotFoundException('Measurement', jobId);
    service.get.mockImplementationOnce(() => {
      throw missing;
    });
    expect(() => controller.get({ jobId })).toThrow(missing);
  });

  it('marks only polling for debug logging and skips every named throttle', () => {
    expect(Reflect.getMetadata(POLLING_ENDPOINT_KEY, handler('get'))).toBe(
      true,
    );
    for (const name of THROTTLER_NAMES) {
      expect(Reflect.getMetadata(`THROTTLER:SKIP${name}`, handler('get'))).toBe(
        true,
      );
      for (const route of ['start', 'cancel'] as const) {
        expect(
          Reflect.getMetadata(`THROTTLER:SKIP${name}`, handler(route)),
        ).toBeUndefined();
        expect(
          Reflect.getMetadata(POLLING_ENDPOINT_KEY, handler(route)),
        ).toBeUndefined();
      }
    }
  });

  it('accepts only a nonempty bounded string path, enum view and real boolean force', async () => {
    for (const value of [
      { path: '/fixture' },
      { path: 'a'.repeat(32768), view: 'packages', force: false },
      { path: '/fixture', force: true },
    ]) {
      expect(
        await validate(plainToInstance(StartDiskUsageDto, value), {
          whitelist: true,
          forbidNonWhitelisted: true,
        }),
      ).toEqual([]);
    }
    for (const value of [
      {},
      { path: '' },
      { path: 42 },
      { path: 'a'.repeat(32769) },
      { path: '/fixture', view: 'other' },
      { path: '/fixture', force: 'false' },
      { path: '/fixture', force: 'true' },
      { path: '/fixture', force: 1 },
      { path: '/fixture', view: null },
      { path: '/fixture', force: null },
      { path: '/fixture', extra: true },
    ]) {
      expect(
        (
          await validate(plainToInstance(StartDiskUsageDto, value), {
            whitelist: true,
            forbidNonWhitelisted: true,
          })
        ).length,
      ).toBeGreaterThan(0);
    }
  });

  it('requires a UUID v4 jobId on poll and cancel', async () => {
    expect(
      await validate(plainToInstance(DiskUsageIdParamDto, { jobId })),
    ).toEqual([]);
    for (const value of [
      {},
      { jobId: 'invalid' },
      { jobId: 'e4261d1d-590f-18a4-a765-d6dedcff17e4' },
    ]) {
      expect(
        (await validate(plainToInstance(DiskUsageIdParamDto, value))).length,
      ).toBeGreaterThan(0);
    }
  });

  it('documents every operation, envelope, error code, conflict details and nullable nested field', async () => {
    const module = await Test.createTestingModule({
      controllers: [DiskUsageController],
      providers: [{ provide: DiskUsageService, useValue: service }],
    }).compile();
    const app = module.createNestApplication();
    try {
      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      const operations = [
        doc.paths['/disk-usage']?.post,
        doc.paths['/disk-usage/{jobId}']?.get,
        doc.paths['/disk-usage/{jobId}/cancel']?.post,
      ];
      operations.forEach((operation, index) => {
        expect(operation?.summary).toEqual(expect.any(String));
        expect(operation?.responses[index === 0 ? '202' : '200']).toMatchObject(
          {
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
          },
        );
        for (const code of ['400', '404', '429'])
          expect(operation?.responses[code]).toBeDefined();
      });
      expect(operations[0]?.responses['403']).toBeDefined();
      expect(operations[0]?.responses['409']).toMatchObject({
        content: {
          'application/json': {
            schema: {
              properties: {
                details: {
                  required: ['jobId', 'path'],
                  properties: {
                    jobId: { type: 'string', format: 'uuid' },
                    path: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      });
      expect(doc.components?.schemas?.DiskUsageJobEntity).toMatchObject({
        properties: {
          sizeBytes: { type: 'number', nullable: true },
          fileCount: { type: 'number', nullable: true },
          measuredAt: { type: 'string', nullable: true },
          partial: { type: 'boolean' },
          status: {
            enum: ['running', 'completed', 'cancelled', 'timed_out', 'failed'],
          },
          stopReason: {
            nullable: true,
            enum: [
              'cancelled',
              'row_limit',
              'identity_limit',
              'numeric_limit',
              null,
            ],
          },
          failureCode: {
            nullable: true,
            enum: ['NOT_FOUND', 'FORBIDDEN', 'INTERNAL_SERVER_ERROR', null],
          },
        },
      });
      expect(doc.components?.schemas?.DiskUsageRowEntity).toMatchObject({
        properties: {
          canonicalPath: { type: 'string', nullable: true },
          sizeBytes: { type: 'number', nullable: true },
          fileCount: { type: 'number', nullable: true },
        },
      });
    } finally {
      await app.close();
    }
  });
});
