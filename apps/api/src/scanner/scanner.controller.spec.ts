import 'reflect-metadata';
import { HTTP_CODE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'node:path';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { plainToInstance, instanceToPlain } from 'class-transformer';
import { validate } from 'class-validator';
import { NotFoundException } from '@/common/exceptions/app.exception';
import { POLLING_ENDPOINT_KEY } from '@/common/decorators/throttle.decorator';
import { THROTTLER_NAMES } from '@/core/throttler-config.module';
import { PathGuardService } from '@/core/path-guard/path-guard.service';
import { DRIVE_DETECTOR } from '@/platform/interfaces/drive-detector.interface';
import { SCAN_WALKER } from '@/scanner/scan-walker';
import { ScannerCache } from '@/scanner/scanner-cache';
import type { IScanResult } from '@/scanner/interfaces/scanner.types';
import { ScanIdParamDto } from '@/scanner/dto/scan-id-param.dto';
import {
  ScanJobEntity,
  ScanStartEntity,
  ScanProgressEntity,
  ScanResultEntity,
  ScannedProjectEntity,
  NodeModulesEntity,
  OrphanNodeModulesEntity,
} from '@/scanner/entities/scan.entity';
import { ScannerController } from '@/scanner/scanner.controller';
import { ScannerService } from '@/scanner/scanner.service';
import { MutationGateService } from '@/core/mutation-gate/mutation-gate.service';
import { DiskUsageService } from '@/disk-usage/disk-usage.service';

const scanId = 'e4261d1d-590f-48a4-a765-d6dedcff17e4';
const startedAt = '2026-10-21T00:00:00.000Z';
const handler = (name: keyof ScannerController): object =>
  Object.getOwnPropertyDescriptor(ScannerController.prototype, name)!
    .value as object;
const job = {
  scanId,
  status: 'running' as const,
  partial: false,
  startedAt,
  progress: { visitedDirs: 2, foundProjects: 1, skippedCount: 0 },
};

describe('ScannerController', () => {
  const service = {
    startScan: jest.fn(() => ({ scanId, status: 'running' })),
    getScan: jest.fn(() => job),
    cancelScan: jest.fn(() => ({ ...job, status: 'cancelled' })),
    getLatest: jest.fn(() => ({ scanId, status: 'completed' })),
  };
  const controller = new ScannerController(
    service as unknown as ScannerService,
  );

  afterEach(() => jest.clearAllMocks());

  it('returns start, poll, latest and cancel envelopes with their HTTP codes', () => {
    expect(controller.startScan()).toEqual({
      statusCode: 202,
      message: 'Scan started successfully',
      data: { scanId, status: 'running' },
    });
    expect(controller.getScan({ scanId })).toEqual({
      statusCode: 200,
      message: 'Scan retrieved successfully',
      data: job,
    });
    expect(controller.getLatest()).toMatchObject({
      statusCode: 200,
      message: 'Latest scan retrieved successfully',
      data: { scanId, status: 'completed' },
    });
    expect(controller.cancelScan({ scanId })).toMatchObject({
      statusCode: 200,
      message: 'Scan cancellation processed successfully',
      data: { scanId, status: 'cancelled' },
    });
    expect(service.startScan).toHaveBeenCalledTimes(1);
    expect(service.getScan).toHaveBeenCalledWith(scanId);
    expect(service.cancelScan).toHaveBeenCalledWith(scanId);
    expect(service.getLatest).toHaveBeenCalledTimes(1);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler('startScan'))).toBe(
      202,
    );
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler('cancelScan'))).toBe(
      200,
    );
  });

  it('lets application exceptions reach the shared filter', () => {
    const error = new NotFoundException('Scan', scanId);
    service.getScan.mockImplementationOnce(() => {
      throw error;
    });
    expect(() => controller.getScan({ scanId })).toThrow(error);
  });

  it('registers latest before the dynamic route and bypasses every throttle only for polling', () => {
    const methods = Object.getOwnPropertyNames(ScannerController.prototype);
    expect(methods.indexOf('getLatest')).toBeLessThan(
      methods.indexOf('getScan'),
    );
    expect(Reflect.getMetadata(PATH_METADATA, handler('getLatest'))).toBe(
      'latest',
    );
    expect(Reflect.getMetadata(PATH_METADATA, handler('getScan'))).toBe(
      ':scanId',
    );
    expect(Reflect.getMetadata(POLLING_ENDPOINT_KEY, handler('getScan'))).toBe(
      true,
    );
    for (const name of THROTTLER_NAMES) {
      expect(
        Reflect.getMetadata(`THROTTLER:SKIP${name}`, handler('getScan')),
      ).toBe(true);
      for (const route of [
        handler('startScan'),
        handler('getLatest'),
        handler('cancelScan'),
      ]) {
        expect(
          Reflect.getMetadata(`THROTTLER:SKIP${name}`, route),
        ).toBeUndefined();
        expect(
          Reflect.getMetadata(POLLING_ENDPOINT_KEY, route),
        ).toBeUndefined();
      }
    }
  });

  it('validates a required UUID v4 scan id', async () => {
    expect(await validate(plainToInstance(ScanIdParamDto, { scanId }))).toEqual(
      [],
    );
    for (const value of [
      {},
      { scanId: 'latest' },
      { scanId: 'e4261d1d-590f-18a4-a765-d6dedcff17e4' },
    ]) {
      expect(await validate(plainToInstance(ScanIdParamDto, value))).toEqual([
        expect.objectContaining({
          property: 'scanId',
          constraints: expect.objectContaining({
            isUuid: expect.any(String) as unknown,
          }) as unknown,
        }),
      ]);
    }
  });

  it('returns service entities with nested metadata, ISO strings and null sizes without exposing job dependencies', async () => {
    const result: IScanResult = {
      scanId,
      status: 'completed',
      partial: false,
      roots: ['/fixture'],
      maxDepth: 0,
      startedAt,
      finishedAt: startedAt,
      skippedCount: 0,
      projects: [
        {
          path: '/fixture/app',
          name: null,
          packageManager: null,
          hasLockfile: false,
          lastActivityAt: startedAt,
          nodeModules: {
            path: '/fixture/app/node_modules',
            exists: false,
            sizeBytes: null,
            sizeMeasuredAt: null,
          },
        },
      ],
      orphanNodeModules: [
        {
          path: '/fixture/old/node_modules',
          sizeBytes: null,
          sizeMeasuredAt: null,
          mtime: startedAt,
        },
      ],
    };
    const module = await Test.createTestingModule({
      providers: [
        ScannerService,
        MutationGateService,
        {
          provide: DiskUsageService,
          useValue: { peekCompletedSize: () => null },
        },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            SCAN_ROOT_PATHS: resolve('/fixture'),
            SCAN_TIMEOUT_MS: 10000,
          }),
        },
        {
          provide: PathGuardService,
          useValue: {
            isInsideProtectedTree: () => Promise.resolve(false),
            createProtectedTreeMatcher: () => Promise.resolve(() => false),
          },
        },
        { provide: DRIVE_DETECTOR, useValue: { listFixedDrives: jest.fn() } },
        {
          provide: SCAN_WALKER,
          useValue: () =>
            Promise.resolve({
              roots: [],
              projects: [],
              orphanNodeModules: [],
              progress: job.progress,
            }),
        },
        {
          provide: ScannerCache,
          useValue: {
            load: () => Promise.resolve({ result }),
            save: () => Promise.resolve(),
            flush: () => Promise.resolve(),
          },
        },
      ],
    }).compile();
    try {
      await module.init();
      const actual = module.get(ScannerService);
      const entity = actual.getLatest();
      expect(entity).toBeInstanceOf(ScanResultEntity);
      expect(entity.projects[0]).toBeInstanceOf(ScannedProjectEntity);
      expect(entity.projects[0].nodeModules).toBeInstanceOf(NodeModulesEntity);
      expect(entity.orphanNodeModules[0]).toBeInstanceOf(
        OrphanNodeModulesEntity,
      );
      expect(instanceToPlain(entity)).toEqual(result);
      const started = actual.startScan();
      expect(started).toBeInstanceOf(ScanStartEntity);
      expect(Object.keys(started).sort()).toEqual(['scanId', 'status']);
      const polled = actual.getScan(started.scanId);
      expect(polled).toBeInstanceOf(ScanJobEntity);
      expect(polled.progress).toBeInstanceOf(ScanProgressEntity);
      expect(Object.keys(polled).sort()).toEqual([
        'finishedAt',
        'partial',
        'progress',
        'scanId',
        'startedAt',
        'status',
      ]);
      expect(actual.cancelScan(started.scanId)).toBeInstanceOf(ScanJobEntity);
    } finally {
      await module.close();
    }
  });

  it('documents every operation, response envelope and nested result schema', async () => {
    const module = await Test.createTestingModule({
      controllers: [ScannerController],
      providers: [{ provide: ScannerService, useValue: service }],
    }).compile();
    const app = module.createNestApplication();
    try {
      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      const routes = [
        doc.paths['/scans']?.post,
        doc.paths['/scans/latest']?.get,
        doc.paths['/scans/{scanId}']?.get,
        doc.paths['/scans/{scanId}/cancel']?.post,
      ];
      routes.forEach((operation, index) => {
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
                  properties: {
                    data: {
                      $ref: expect.stringContaining(
                        '#/components/schemas/Scan',
                      ) as unknown,
                    },
                  },
                },
              },
            },
          },
        );
      });
      expect(routes[1]?.responses['404']).toBeDefined();
      for (const operation of routes.slice(2)) {
        expect(operation?.responses['400']).toBeDefined();
        expect(operation?.responses['404']).toBeDefined();
      }
      expect(doc.components?.schemas?.ScanJobEntity).toMatchObject({
        properties: {
          partial: { type: 'boolean' },
          status: {
            enum: ['running', 'completed', 'cancelled', 'timed_out', 'failed'],
          },
        },
      });
      expect(doc.components?.schemas?.ScanResultEntity).toMatchObject({
        properties: {
          status: { enum: ['completed', 'timed_out'] },
          partial: { type: 'boolean' },
        },
      });
      expect(doc.components?.schemas?.NodeModulesEntity).toMatchObject({
        properties: {
          sizeBytes: { type: 'number', nullable: true },
          sizeMeasuredAt: {
            type: 'string',
            nullable: true,
            format: 'date-time',
          },
        },
      });
      expect(doc.components?.schemas?.OrphanNodeModulesEntity).toMatchObject({
        properties: {
          sizeBytes: { type: 'number', nullable: true },
          sizeMeasuredAt: {
            type: 'string',
            nullable: true,
            format: 'date-time',
          },
        },
      });
      expect(doc.components?.schemas?.NodeModulesEntity).not.toHaveProperty(
        'properties.sizeBytes.enum',
      );
      expect(
        doc.components?.schemas?.OrphanNodeModulesEntity,
      ).not.toHaveProperty('properties.sizeBytes.enum');
    } finally {
      await app.close();
    }
  });
});
