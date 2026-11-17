import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { AppException } from '@/common/exceptions/app.exception';
import { IS_DANGEROUS_OPERATION_KEY } from '@/common/decorators/metadata';
import { POLLING_ENDPOINT_KEY } from '@/common/decorators/throttle.decorator';
import { THROTTLER_NAMES } from '@/core/throttler-config.module';
import type { INpmRunnerService } from '@/npm-runner/interfaces/npm-runner.service.interface';
import type {
  IRecoveryClearRequest,
  IRecoveryClearResult,
  IRunJob,
  IRunLogPage,
  IRunRequest,
  IRunStart,
  IRunnerContext,
  ITerminalClaimBody,
  ITerminalInputAckBody,
  ITerminalInputBody,
  ITerminalResizeBody,
  ITerminalResizeResult,
  RunLatestResult,
} from '@/npm-runner/interfaces/npm-runner.types';
import type { ITerminalOutputPage } from '@/npm-runner/terminal/terminal-buffer';
import type {
  ITerminalInputAck,
  ITerminalWriter,
} from '@/npm-runner/terminal/terminal-control';
import {
  RecoveryClearResultEntity,
  RunJobEntity,
  RunLatestHoldEntity,
  RunnerContextEntity,
  RunLogPageEntity,
  RunStartEntity,
  TerminalInputAckEntity,
  TerminalOutputPageEntity,
  TerminalResizeResultEntity,
  TerminalWriterEntity,
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
  let moduleRef: TestingModule;
  let controller: NpmRunnerController;
  beforeEach(async () => {
    service = {
      context: jest.fn<Promise<IRunnerContext>, [string]>(() =>
        Promise.resolve(context()),
      ),
      start: jest.fn<Promise<IRunStart>, [IRunRequest]>(() =>
        Promise.resolve({ jobId: id, requestId, status: 'running' }),
      ),
      latest: jest.fn<RunLatestResult, []>(job),
      clearRecovery: jest.fn<
        Promise<IRecoveryClearResult>,
        [IRecoveryClearRequest]
      >(() => Promise.resolve({ cleared: true, recoveryHold: null })),
      get: jest.fn<IRunJob, [string]>(job),
      logs: jest.fn<IRunLogPage, [string, number]>(() => ({
        jobId: id,
        firstCursor: 0,
        nextCursor: 0,
        endCursor: 0,
        truncated: false,
        droppedBytes: 0,
        chunks: [],
      })),
      cancel: jest.fn<Promise<IRunJob>, [string]>(() =>
        Promise.resolve({ ...job(), status: 'stopping' }),
      ),
      terminalOutput: jest.fn<ITerminalOutputPage, [string, number, number]>(
        () => ({
          jobId: id,
          generation: 1,
          firstCursor: 0,
          nextCursor: 0,
          endCursor: 0,
          gap: false,
          truncated: false,
          parserReset: false,
          droppedBytes: 0,
          chunks: [],
        }),
      ),
      claimTerminal: jest.fn<ITerminalWriter, [string, ITerminalClaimBody]>(
        () => ({
          tabId: requestId,
          token: requestId,
          writerGeneration: 1,
        }),
      ),
      terminalInput: jest.fn<
        Promise<ITerminalInputAck>,
        [string, ITerminalInputBody]
      >(() =>
        Promise.resolve({
          jobId: id,
          generation: 1,
          writerGeneration: 1,
          sequence: 1,
          status: 'delivered',
          receivedAt: 1000,
        }),
      ),
      terminalInputAck: jest.fn<
        ITerminalInputAck,
        [string, ITerminalInputAckBody]
      >(() => ({
        jobId: id,
        generation: 1,
        writerGeneration: 1,
        sequence: 1,
        status: 'delivered',
        receivedAt: 1000,
      })),
      terminalResize: jest.fn<
        ITerminalResizeResult,
        [string, ITerminalResizeBody]
      >(() => ({ queued: true })),
    };
    moduleRef = await Test.createTestingModule({
      controllers: [NpmRunnerController],
      providers: [{ provide: NpmRunnerService, useValue: service }],
    }).compile();
    controller = moduleRef.get(NpmRunnerController);
  });

  afterEach(() => moduleRef.close());

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
    expect(
      controller.terminalOutput({ id }, { generation: 1, cursor: 0 }).data,
    ).toBeInstanceOf(TerminalOutputPageEntity);
    expect(
      controller.terminalClaim(
        { id },
        { requestId, generation: 1, tabId: requestId, takeover: false },
      ).data,
    ).toBeInstanceOf(TerminalWriterEntity);
    expect(
      (
        await controller.terminalInput(
          { id },
          {
            requestId,
            generation: 1,
            tabId: requestId,
            token: requestId,
            writerGeneration: 1,
            sequence: 1,
            text: 'y\r',
          },
        )
      ).data,
    ).toBeInstanceOf(TerminalInputAckEntity);
    expect(
      controller.terminalInputAck(
        { id },
        {
          requestId,
          generation: 1,
          tabId: requestId,
          token: requestId,
          writerGeneration: 1,
          sequence: 1,
        },
      ).data,
    ).toBeInstanceOf(TerminalInputAckEntity);
    expect(
      controller.terminalResize(
        { id },
        {
          requestId,
          generation: 1,
          tabId: requestId,
          token: requestId,
          writerGeneration: 1,
          cols: 80,
          rows: 24,
        },
      ).data,
    ).toBeInstanceOf(TerminalResizeResultEntity);

    service.latest.mockReturnValue({
      recoveryHold: {
        active: true,
        reason: 'UNRESOLVED_NATIVE_SESSION',
        journalPath: 'D:\\TEST\\data\\native-project-terminal-session.json',
      },
      job: null,
    });
    expect(controller.latest().data).toBeInstanceOf(RunLatestHoldEntity);

    const clearResult = await controller.clearRecovery({ confirm: true });
    expect(clearResult.statusCode).toBe(200);
    expect(clearResult.data).toBeInstanceOf(RecoveryClearResultEntity);
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

  it('registers latest before the UUID route, and marks only the polling endpoints', () => {
    const names = Object.getOwnPropertyNames(NpmRunnerController.prototype);
    expect(names.indexOf('latest')).toBeLessThan(names.indexOf('get'));
    for (const name of [
      'context',
      'start',
      'latest',
      'clearRecovery',
      'get',
      'logs',
      'cancel',
      'terminalOutput',
      'terminalClaim',
      'terminalInput',
      'terminalInputAck',
      'terminalResize',
    ] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(
        NpmRunnerController.prototype,
        name,
      );
      const handler: unknown = descriptor?.value;
      if (typeof handler !== 'function')
        throw new Error(`Missing ${name} handler`);
      const polls = ['latest', 'get', 'logs', 'terminalOutput'].includes(name);
      expect(Reflect.getMetadata(POLLING_ENDPOINT_KEY, handler)).toBe(
        polls ? true : undefined,
      );
      expect(
        Boolean(Reflect.getMetadata(IS_DANGEROUS_OPERATION_KEY, handler)),
      ).toBe(
        ['start', 'clearRecovery', 'cancel', 'terminalInput'].includes(name),
      );
      for (const throttle of THROTTLER_NAMES) {
        expect(Reflect.getMetadata(`THROTTLER:SKIP${throttle}`, handler)).toBe(
          polls ? true : undefined,
        );
      }
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
        [
          'start',
          'clearRecovery',
          'cancel',
          'terminalClaim',
          'terminalInput',
          'terminalInputAck',
          'terminalResize',
        ].includes(name)
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
      expect(Object.keys(doc.paths)).toHaveLength(12);
      for (const [route, item] of Object.entries(doc.paths)) {
        const isPost =
          route === '/npm-runs' ||
          route.endsWith('/recovery/clear') ||
          route.endsWith('/cancel') ||
          route.endsWith('/terminal-claim') ||
          route.endsWith('/terminal-input') ||
          route.endsWith('/terminal-input-ack') ||
          route.endsWith('/terminal-resize');
        const operation = isPost ? item.post : item.get;
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
        'RunTerminalMetaEntity',
        'TerminalOutputChunkEntity',
        'TerminalOutputPageEntity',
        'TerminalWriterEntity',
        'TerminalInputAckEntity',
        'TerminalResizeResultEntity',
        'RunRecoveryHoldEntity',
        'RunLatestHoldEntity',
        'RecoveryClearResultEntity',
      ]) {
        expect(doc.components?.schemas?.[entity]).toBeDefined();
      }
    } finally {
      await app.close();
    }
  });
});
