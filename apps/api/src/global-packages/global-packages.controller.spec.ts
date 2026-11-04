import 'reflect-metadata';
import { HttpStatus, RequestMethod } from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { instanceToPlain } from 'class-transformer';
import { AppException } from '@/common/exceptions/app.exception';
import { IS_DANGEROUS_OPERATION_KEY } from '@/common/decorators/metadata';
import { POLLING_ENDPOINT_KEY } from '@/common/decorators/throttle.decorator';
import { THROTTLER_NAMES } from '@/core/throttler-config.module';
import { GlobalPackagesController } from '@/global-packages/global-packages.controller';
import { GlobalPackagesService } from '@/global-packages/global-packages.service';
import type { IGlobalPackagesService } from '@/global-packages/interfaces/global-packages.service.interface';
import type { IGlobalJob } from '@/global-packages/interfaces/global-packages.types';
import {
  GlobalJobEntity,
  GlobalJobStartEntity,
  GlobalLogPageEntity,
  GlobalSnapshotEntity,
} from '@/global-packages/entities/global-packages.entity';
import {
  TEST_JOB_ID,
  TEST_REQUEST_ID,
  testConsent,
  testPreview,
  testRequest,
} from '@/global-packages/__fixtures__/global-lifecycle';

const job = (): IGlobalJob => ({
  jobId: TEST_JOB_ID,
  requestId: TEST_REQUEST_ID,
  previewId: null,
  status: 'completed',
  kind: 'inventory',
  manager: null,
  managerVersion: null,
  action: null,
  package: null,
  currentVersion: null,
  targetVersion: null,
  phase: 'done',
  startedAt: '2026-11-04T00:00:00.000Z',
  finishedAt: '2026-11-04T00:00:01.000Z',
  mutationSpawned: false,
  mayHaveChanged: false,
  exitCode: null,
  signal: null,
  stopReason: null,
  terminationVerified: true,
  gateHeld: false,
  auditWritten: false,
  refreshRequired: false,
  failureCode: null,
  warningCodes: [],
  firstCursor: 0,
  endCursor: 0,
  droppedBytes: 0,
  preview: null,
  versions: null,
});
const routes = [
  ['getSnapshot', RequestMethod.GET, '/', HttpStatus.OK],
  ['inventory', RequestMethod.POST, 'inventory', HttpStatus.ACCEPTED],
  ['versions', RequestMethod.POST, 'versions', HttpStatus.ACCEPTED],
  ['preview', RequestMethod.POST, 'preview', HttpStatus.ACCEPTED],
  ['getLatest', RequestMethod.GET, 'jobs/latest', HttpStatus.OK],
  ['getJob', RequestMethod.GET, 'jobs/:id', HttpStatus.OK],
  ['getLogs', RequestMethod.GET, 'jobs/:id/logs', HttpStatus.OK],
  ['execute', RequestMethod.POST, 'execute', HttpStatus.ACCEPTED],
  ['cancel', RequestMethod.POST, 'jobs/:id/cancel', HttpStatus.OK],
] as const;

describe('GlobalPackagesController HTTP contract', () => {
  let service: jest.Mocked<IGlobalPackagesService>;
  let controller: GlobalPackagesController;
  let waitForPreflight: jest.Mock<Promise<void>, [string]>;
  beforeEach(() => {
    waitForPreflight = jest.fn(() => Promise.resolve());
    const accepted = {
      jobId: TEST_JOB_ID,
      requestId: TEST_REQUEST_ID,
      previewId: null,
      status: 'running' as const,
    };
    service = {
      getSnapshot: jest.fn(() => ({
        revision: 'TEST-1',
        asOf: '2026-11-04T00:00:00.000Z',
        stale: false,
        managers: [],
      })),
      inventory: jest.fn(() => Promise.resolve(accepted)),
      versions: jest.fn(() => Promise.resolve(accepted)),
      preview: jest.fn(() => Promise.resolve(accepted)),
      execute: jest.fn(() => Promise.resolve(accepted)),
      waitForPreflight,
      getLatest: jest.fn(job),
      getJob: jest.fn(job),
      getLogs: jest.fn(() => ({
        jobId: TEST_JOB_ID,
        firstCursor: 0,
        nextCursor: 0,
        endCursor: 0,
        truncated: false,
        droppedBytes: 0,
        chunks: [],
      })),
      cancel: jest.fn(() => Promise.resolve(job())),
    };
    controller = new GlobalPackagesController(service);
  });

  it('delegates all inputs exactly and wraps starts/reads/cancel with typed entities', async () => {
    const inventory = { requestId: TEST_REQUEST_ID };
    const versions = {
      ...inventory,
      manager: 'npm' as const,
      package: 'test-tool',
    };
    const preview = testRequest();
    const execute = testConsent();
    for (const [method, body] of [
      ['inventory', inventory],
      ['versions', versions],
      ['preview', preview],
      ['execute', execute],
    ] as const) {
      // Each method is called separately to retain its precise DTO type.
      const result =
        method === 'inventory'
          ? await controller.inventory(inventory)
          : method === 'versions'
            ? await controller.versions(versions)
            : method === 'preview'
              ? await controller.preview(preview)
              : await controller.execute(execute);
      expect(result.statusCode).toBe(202);
      expect(result.message).toEqual(expect.any(String));
      expect(result.data).toBeInstanceOf(GlobalJobStartEntity);
      expect(service[method].mock.calls).toEqual([[body]]);
    }
    expect(controller.getSnapshot().data).toBeInstanceOf(GlobalSnapshotEntity);
    expect(controller.getLatest().data).toBeInstanceOf(GlobalJobEntity);
    expect(controller.getJob({ id: TEST_JOB_ID }).data).toBeInstanceOf(
      GlobalJobEntity,
    );
    expect(service.getJob.mock.calls).toEqual([[TEST_JOB_ID]]);
    const logs = controller.getLogs({ id: TEST_JOB_ID }, { cursor: 12 });
    expect(logs.statusCode).toBe(200);
    expect(logs.data).toBeInstanceOf(GlobalLogPageEntity);
    expect(service.getLogs.mock.calls).toEqual([[TEST_JOB_ID, 12]]);
    const cancelled = await controller.cancel({ id: TEST_JOB_ID });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.data).toBeInstanceOf(GlobalJobEntity);
    expect(service.cancel.mock.calls).toEqual([[TEST_JOB_ID]]);
    expect(waitForPreflight.mock.calls).toEqual([[TEST_JOB_ID]]);
  });

  it('preserves null reads and recursively excludes private service facts', () => {
    service.getSnapshot.mockReturnValue(null);
    service.getLatest.mockReturnValue(null);
    expect(controller.getSnapshot()).toMatchObject({
      statusCode: 200,
      data: null,
    });
    expect(controller.getLatest()).toMatchObject({
      statusCode: 200,
      data: null,
    });
    service.getJob.mockReturnValue({
      ...job(),
      environment: { TEST_SECRET: 'TEST-private' },
      preview: { ...testPreview(), facts: { rawConfig: 'TEST-private' } },
    } as IGlobalJob);
    const data = controller.getJob({ id: TEST_JOB_ID }).data;
    const plain: unknown = instanceToPlain(data);
    expect(JSON.stringify(plain)).not.toMatch(
      /TEST-private|environment|rawConfig/,
    );
    expect(plain).toMatchObject({
      preview: { confirmText: testPreview().confirmText },
    });
    expect(plain).not.toHaveProperty('chunks');
  });

  it('passes application errors through without changing code/status/details', async () => {
    const error = new AppException(409, 'TEST busy', 'CONFLICT', {
      reason: 'RUNNING',
    });
    service.inventory.mockRejectedValue(error);
    await expect(
      controller.inventory({ requestId: TEST_REQUEST_ID }),
    ).rejects.toBe(error);
    service.getJob.mockImplementation(() => {
      throw error;
    });
    expect(() => controller.getJob({ id: TEST_JOB_ID })).toThrow(error);
  });

  it.each(routes)(
    '%s has the pinned verb/path/status and only the required markers',
    (method, verb, path, status) => {
      const handler: unknown = Object.getOwnPropertyDescriptor(
        GlobalPackagesController.prototype,
        method,
      )?.value;
      if (typeof handler !== 'function')
        throw new Error(`TEST missing ${method}`);
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(verb);
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler) ?? 200).toBe(
        status,
      );
      expect(
        Boolean(Reflect.getMetadata(IS_DANGEROUS_OPERATION_KEY, handler)),
      ).toBe(method === 'execute' || method === 'cancel');
      const poll = ['getLatest', 'getJob', 'getLogs'].includes(method);
      expect(Boolean(Reflect.getMetadata(POLLING_ENDPOINT_KEY, handler))).toBe(
        poll,
      );
      for (const name of THROTTLER_NAMES)
        expect(
          Boolean(Reflect.getMetadata(`THROTTLER:SKIP${name}`, handler)),
        ).toBe(poll);
    },
  );

  it('declares latest before the parameter route and documents all endpoints with Swagger', async () => {
    const methods = Object.getOwnPropertyNames(
      GlobalPackagesController.prototype,
    );
    expect(methods.indexOf('getLatest')).toBeLessThan(
      methods.indexOf('getJob'),
    );
    const module = await Test.createTestingModule({
      controllers: [GlobalPackagesController],
      providers: [{ provide: GlobalPackagesService, useValue: service }],
    }).compile();
    const app = module.createNestApplication();
    try {
      app.setGlobalPrefix('api/v1');
      await app.init();
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      for (const [, verb, path, status] of routes) {
        const suffix = path === '/' ? '' : `/${path.replace(':id', '{id}')}`;
        const entry = document.paths[`/api/v1/global-packages${suffix}`];
        const operation = verb === RequestMethod.GET ? entry?.get : entry?.post;
        expect(operation?.summary).toEqual(expect.any(String));
        expect(operation?.responses[String(status)]).toBeDefined();
      }
    } finally {
      await app.close();
    }
  });
});
