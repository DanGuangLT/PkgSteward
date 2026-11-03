import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import { AppException } from '@/common/exceptions/app.exception';
import { IS_DANGEROUS_OPERATION_KEY } from '@/common/decorators/metadata';
import { POLLING_ENDPOINT_KEY } from '@/common/decorators/throttle.decorator';
import { THROTTLER_NAMES } from '@/core/throttler-config.module';
import type { INpmRunnerService } from '@/npm-runner/interfaces/npm-runner.service.interface';
import type {
  IRunJob,
  IRunnerContext,
} from '@/npm-runner/interfaces/npm-runner.types';
import {
  RunJobEntity,
  RunnerContextEntity,
  RunLogPageEntity,
  RunStartEntity,
} from '@/npm-runner/entities/npm-runner.entity';
import { NpmRunnerController } from '@/npm-runner/npm-runner.controller';
import { NpmRunnerService } from '@/npm-runner/npm-runner.service';

const id = '00000000-0000-4000-8000-000000000010';
const path = 'D:\\TEST\\project';
const requestId = '00000000-0000-4000-8000-000000000020';
const job = (): IRunJob => ({
  jobId: id,
  requestId,
  status: 'running',
  requestPath: path,
  path,
  scanId: id,
  action: 'install_all',
  manager: 'npm',
  version: '11.17.0',
  package: null,
  script: null,
  phase: 'preflight',
  startedAt: '2026-11-03T03:00:00.000Z',
  finishedAt: null,
  spawned: false,
  exitCode: null,
  signal: null,
  failureCode: null,
  stopReason: null,
  terminationVerified: false,
  mayHaveChanged: false,
  gateHeld: true,
  auditWritten: false,
  refreshRequired: false,
  warningCodes: [],
  firstCursor: 0,
  endCursor: 0,
  droppedBytes: 0,
});
const context = (): IRunnerContext => ({
  requestPath: path,
  path,
  scanId: id,
  inputHash: 'a'.repeat(64),
  manager: 'npm',
  version: '11.17.0',
  available: true,
  reason: null,
  scripts: [],
  warnings: [],
});

describe('NpmRunnerController contract', () => {
  let service: jest.Mocked<INpmRunnerService>;
  let controller: NpmRunnerController;
  beforeEach(() => {
    service = {
      context: jest.fn(() => Promise.resolve(context())),
      start: jest.fn(() =>
        Promise.resolve({ jobId: id, requestId, status: 'running' as const }),
      ),
      latest: jest.fn(job),
      get: jest.fn(job),
      logs: jest.fn(() => ({
        jobId: id,
        firstCursor: 0,
        nextCursor: 0,
        endCursor: 0,
        truncated: false,
        droppedBytes: 0,
        chunks: [],
      })),
      cancel: jest.fn(() =>
        Promise.resolve({ ...job(), status: 'stopping' as const }),
      ),
    };
    controller = new NpmRunnerController(service as NpmRunnerService);
  });

  it('wraps context/start/latest/get/logs in the unchanged envelope and Swagger entities', async () => {
    const read = await controller.context({ path });
    expect(read.statusCode).toBe(200);
    expect(read.data).toBeInstanceOf(RunnerContextEntity);
    expect(service.context.mock.calls[0]).toEqual([path]);
    const body = {
      path,
      requestId,
      inputHash: 'a'.repeat(64),
      action: 'install_all' as const,
    };
    const start = await controller.start(body);
    expect(start.statusCode).toBe(202);
    expect(start.data).toBeInstanceOf(RunStartEntity);
    expect(service.start.mock.calls[0][0]).toEqual(body);
    expect(controller.latest().data).toBeInstanceOf(RunJobEntity);
    expect(controller.get({ id }).data).toBeInstanceOf(RunJobEntity);
    expect(service.get.mock.calls[0]).toEqual([id]);
    expect(controller.logs({ id }, { cursor: 12 }).data).toBeInstanceOf(
      RunLogPageEntity,
    );
    expect(service.logs.mock.calls[0]).toEqual([id, 12]);
    expect(controller.get({ id }).data).not.toHaveProperty('chunks');
  });

  it.each([
    ['stopping', true, 202],
    ['completed', false, 200],
    ['failed', false, 200],
    ['termination_failed', true, 202],
  ] as const)(
    'sets cancel HTTP status for %s / held=%s',
    async (status, gateHeld, code) => {
      service.cancel.mockResolvedValue({ ...job(), status, gateHeld });
      const setStatus = jest.fn<Response, [number]>().mockReturnThis();
      const response = { status: setStatus } as unknown as Response;
      const result = await controller.cancel({ id }, response);
      expect(setStatus.mock.calls[0]).toEqual([code]);
      expect(result.statusCode).toBe(code);
      expect(result.data).toBeInstanceOf(RunJobEntity);
      expect(service.cancel.mock.calls[0]).toEqual([id]);
    },
  );

  it('preserves application error codes and conflict details for the global filter', async () => {
    const conflict = new AppException(409, 'TEST busy', 'CONFLICT', {
      reason: 'RUNNING',
      jobId: id,
      requestPath: path,
    });
    service.start.mockRejectedValue(conflict);
    await expect(
      controller.start({
        path,
        requestId,
        inputHash: 'a'.repeat(64),
        action: 'install_all',
      }),
    ).rejects.toBe(conflict);
  });

  it('registers latest before the UUID route, and marks only the three polls', () => {
    const names = Object.getOwnPropertyNames(NpmRunnerController.prototype);
    expect(names.indexOf('latest')).toBeLessThan(names.indexOf('get'));
    for (const name of [
      'context',
      'start',
      'latest',
      'get',
      'logs',
      'cancel',
    ] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(
        NpmRunnerController.prototype,
        name,
      );
      const handler: unknown = descriptor?.value;
      if (typeof handler !== 'function')
        throw new Error(`Missing ${name} handler`);
      const polls = ['latest', 'get', 'logs'].includes(name);
      expect(Reflect.getMetadata(POLLING_ENDPOINT_KEY, handler)).toBe(
        polls ? true : undefined,
      );
      expect(
        Boolean(Reflect.getMetadata(IS_DANGEROUS_OPERATION_KEY, handler)),
      ).toBe(['start', 'cancel'].includes(name));
      for (const throttle of THROTTLER_NAMES) {
        expect(Reflect.getMetadata(`THROTTLER:SKIP${throttle}`, handler)).toBe(
          polls ? true : undefined,
        );
      }
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
        ['start', 'cancel'].includes(name)
          ? RequestMethod.POST
          : RequestMethod.GET,
      );
    }
    const latest = Object.getOwnPropertyDescriptor(
      NpmRunnerController.prototype,
      'latest',
    )?.value as object;
    expect(Reflect.getMetadata(PATH_METADATA, latest)).toBe('latest');
  });

  it('documents every route with entities, success/error envelopes and cancel 200/202', async () => {
    const module = await Test.createTestingModule({
      controllers: [NpmRunnerController],
      providers: [{ provide: NpmRunnerService, useValue: service }],
    }).compile();
    const app = module.createNestApplication();
    try {
      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      expect(Object.keys(doc.paths)).toHaveLength(6);
      for (const [route, item] of Object.entries(doc.paths)) {
        const operation =
          route.endsWith('/cancel') || route === '/npm-runs'
            ? item.post
            : item.get;
        expect(operation?.summary).toBeTruthy();
        expect(operation?.responses['400']).toBeDefined();
        expect(operation?.responses['404']).toBeDefined();
        expect(operation?.responses['429']).toBeDefined();
        expect(
          operation?.responses[route === '/npm-runs' ? '202' : '200'],
        ).toBeDefined();
        const response =
          operation?.responses[route === '/npm-runs' ? '202' : '200'];
        if (!response || !('content' in response))
          throw new Error('Missing Swagger response content');
        const schema = response.content?.['application/json'].schema;
        if (!schema || !('properties' in schema))
          throw new Error('Missing Swagger envelope');
        expect(schema.required).toEqual([
          'statusCode',
          'message',
          'code',
          'data',
          'timestamp',
          'path',
        ]);
        expect(schema.properties?.data).toHaveProperty('$ref');
      }
      expect(
        doc.paths['/npm-runs/{id}/cancel'].post?.responses['202'],
      ).toBeDefined();
      for (const entity of [
        'RunnerContextEntity',
        'RunStartEntity',
        'RunJobEntity',
        'RunLogPageEntity',
      ]) {
        expect(doc.components?.schemas?.[entity]).toBeDefined();
      }
    } finally {
      await app.close();
    }
  });
});
