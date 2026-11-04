import 'reflect-metadata';
import {
  ClassSerializerInterceptor,
  Global,
  Logger,
  Module,
  ValidationPipe,
} from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { appendFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { join } from 'node:path';
import request from 'supertest';
import { execa } from 'execa';
import { AppException } from '@/common/exceptions/app.exception';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import { TransformInterceptor } from '@/common/interceptors/transform.interceptor';
import type { IApiResponse } from '@/common/interceptors/transform.interceptor';
import { createHostOriginMiddleware } from '@/common/middleware/host-origin.middleware';
import { PathGuardService } from '@/core/path-guard/path-guard.service';
import { AppPathsService } from '@/core/app-paths/app-paths.service';
import { AuditLogService } from '@/core/audit-log/audit-log.service';
import type { IAuditRecord } from '@/core/audit-log/interfaces/audit-log.types';
import { MutationGateService } from '@/core/mutation-gate/mutation-gate.service';
import { THROTTLER_NAMES } from '@/core/throttler-config.module';
import { ScannerService } from '@/scanner/scanner.service';
import { ScannerCache } from '@/scanner/scanner-cache';
import { GlobalPackagesModule } from '@/global-packages/global-packages.module';
import { GlobalPackagesService } from '@/global-packages/global-packages.service';
import { GLOBAL_PACKAGES_RUNTIME } from '@/global-packages/interfaces/global-packages.runtime';
import type {
  IGlobalJob,
  IGlobalJobStart,
  IGlobalLogPage,
  IGlobalPreview,
  IGlobalSnapshot,
} from '@/global-packages/interfaces/global-packages.types';
import { flushJobs } from '@/global-packages/__fixtures__/global-lifecycle';
import { globalHttpFixture } from '@/../test/mocks/global-packages';

jest.mock('execa', () => ({ execa: jest.fn() }));
jest.mock('node:fs/promises', () => {
  const blocked = () =>
    jest.fn(() => {
      throw new Error('TEST native filesystem forbidden');
    });
  return {
    lstat: blocked(),
    stat: blocked(),
    realpath: blocked(),
    readdir: blocked(),
    opendir: blocked(),
    access: blocked(),
    readFile: blocked(),
    open: blocked(),
    writeFile: blocked(),
    rm: blocked(),
    unlink: blocked(),
    rename: blocked(),
    copyFile: blocked(),
    readlink: blocked(),
    mkdir: jest.fn(() => Promise.resolve(undefined)),
    appendFile: jest.fn(() => Promise.resolve(undefined)),
  };
});

@Global()
@Module({
  providers: [
    { provide: ConfigService, useValue: new ConfigService() },
    { provide: AppPathsService, useValue: {} },
    { provide: PathGuardService, useValue: {} },
    { provide: AuditLogService, useValue: {} },
  ],
  exports: [ConfigService, AppPathsService, PathGuardService, AuditLogService],
})
class GlobalTestAdaptersModule {}

const base = '/api/v1/global-packages';
const uuid = (number: number) =>
  `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
type ErrorBody = {
  statusCode: number;
  code: string;
  details?: { reason?: string };
};

describe('Global packages HTTP PC (real Nest/service/adapters, mocked IO)', () => {
  let f: ReturnType<typeof globalHttpFixture>;
  let apps: INestApplication<Server>[];
  let serial: number;
  beforeEach(() => {
    f = globalHttpFixture();
    apps = [];
    serial = 1000;
    jest.mocked(execa).mockClear();
    jest.mocked(appendFile).mockClear();
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('TEST real network forbidden'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(async () => {
    try {
      for (const app of apps.reverse()) {
        // Deliberately retained fake children are stopped by each lifecycle test.
        jest
          .spyOn(app.get(GlobalPackagesService), 'onModuleDestroy')
          .mockResolvedValue();
        await app.close();
      }
      expect(execa).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      jest.restoreAllMocks();
    }
  });

  const open = async (limit = 100) => {
    const module = await Test.createTestingModule({
      imports: [
        GlobalTestAdaptersModule,
        ThrottlerModule.forRoot(
          THROTTLER_NAMES.map((name) => ({ name, ttl: 60_000, limit })),
        ),
        GlobalPackagesModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_INTERCEPTOR, useClass: ClassSerializerInterceptor },
        { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    })
      .overrideProvider(GLOBAL_PACKAGES_RUNTIME)
      .useValue(f.runtime)
      .overrideProvider(ConfigService)
      .useValue(f.config)
      .overrideProvider(AppPathsService)
      .useValue(f.appPaths)
      .overrideProvider(AuditLogService)
      .useValue({
        append: (record: IAuditRecord) =>
          appendFile(
            join(f.appPaths.dataDir, 'logs', 'dangerous-operations.jsonl'),
            `${JSON.stringify(record)}\n`,
            'utf8',
          ),
      })
      .overrideProvider(MutationGateService)
      .useValue(f.gate)
      .overrideProvider(ScannerCache)
      .useValue({})
      .overrideProvider(ScannerService)
      .useValue({ getLatest: () => null })
      .compile();
    f.runtime.audit = {
      append: (record) => module.get(AuditLogService).append(record),
    };
    const app = module.createNestApplication<INestApplication<Server>>();
    apps.push(app);
    app.setGlobalPrefix('api/v1');
    app.use(
      createHostOriginMiddleware({
        allowedOrigins: ['http://localhost:24680'],
      }),
    );
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        exceptionFactory: () =>
          new AppException(400, 'Invalid request', 'VALIDATION_ERROR'),
      }),
    );
    await app.listen(0, '127.0.0.1');
    return app;
  };
  const latest = async (app: INestApplication<Server>) => {
    const response = await request(app.getHttpServer())
      .get(`${base}/jobs/latest`)
      .expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    return (response.body as IApiResponse<IGlobalJob | null>).data;
  };
  const snapshot = async (app: INestApplication<Server>) => {
    const response = await request(app.getHttpServer()).get(base).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    return (response.body as IApiResponse<IGlobalSnapshot | null>).data;
  };
  const readyPreview = async (
    app: INestApplication<Server>,
  ): Promise<IGlobalPreview> => {
    const response = await request(app.getHttpServer())
      .post(`${base}/preview`)
      .send({
        requestId: uuid(++serial),
        manager: 'npm',
        package: 'test-tool',
        action: 'remove',
      })
      .expect(202);
    expect(response.headers['cache-control']).toBe('no-store');
    await flushJobs();
    const job = await latest(app);
    expect(job).toMatchObject({ status: 'completed', mutationSpawned: false });
    expect(job?.preview?.previewId).toBe(
      (response.body as IApiResponse<IGlobalJobStart>).data?.previewId,
    );
    if (!job?.preview) throw new Error('TEST expected ready preview');
    return job.preview;
  };
  const consent = (preview: IGlobalPreview) => ({
    requestId: uuid(++serial),
    previewId: preview.previewId,
    confirm: true,
    acknowledgedRisks: ['MACHINE_WIDE'],
    confirmText: preview.confirmText,
  });
  const assertError = (
    response: request.Response,
    statusCode: number,
    code: string,
    reason?: string,
  ) => {
    expect(response.status).toBe(statusCode);
    expect(response.body as ErrorBody).toMatchObject({
      statusCode,
      code,
      ...(reason ? { details: { reason } } : {}),
    });
    expect(response.headers['cache-control']).toBe('no-store');
  };

  it('GETs do no IO; inventory → preview → exact consent → one mutation → completed/stale plus audit JSONL', async () => {
    const app = await open();
    expect(await snapshot(app)).toBeNull();
    expect(await latest(app)).toBeNull();
    expect(f.probe).not.toHaveBeenCalled();
    expect(f.fs.lstat).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .post(`${base}/inventory`)
      .send({ requestId: uuid(++serial) })
      .expect(202);
    await flushJobs();
    expect(await latest(app)).toMatchObject({
      kind: 'inventory',
      status: 'completed',
    });
    expect((await snapshot(app))?.stale).toBe(false);
    const preview = await readyPreview(app);
    expect(f.gate.isBusy()).toBe(false);
    const body = consent(preview);
    const response = await request(app.getHttpServer())
      .post(`${base}/execute`)
      .send(body)
      .expect(202);
    expect((response.body as IApiResponse<IGlobalJobStart>).statusCode).toBe(
      202,
    );
    await flushJobs();
    expect(f.child.launch).toHaveBeenCalledTimes(1);
    expect(f.child.launch.mock.calls[0][0].args).toEqual(
      expect.arrayContaining(['uninstall', '--global', '--', 'test-tool']),
    );
    const probes = f.probe.mock.calls.length;
    const reads = f.fs.lstat.mock.calls.length;
    const running = await latest(app);
    await request(app.getHttpServer())
      .get(`${base}/jobs/${running!.jobId}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`${base}/jobs/${running!.jobId}/logs?cursor=0`)
      .expect(200);
    await snapshot(app);
    expect(f.probe.mock.calls).toHaveLength(probes);
    expect(f.fs.lstat.mock.calls).toHaveLength(reads);
    await f.removeAndExit();
    expect(await latest(app)).toMatchObject({
      status: 'completed',
      mutationSpawned: true,
      terminationVerified: true,
      gateHeld: false,
      auditWritten: true,
    });
    expect((await snapshot(app))?.stale).toBe(true);
    const path = join(f.appPaths.dataDir, 'logs', 'dangerous-operations.jsonl');
    const lines = jest
      .mocked(appendFile)
      .mock.calls.filter(([file]) => typeof file === 'string' && file === path)
      .map(([, data]) =>
        typeof data === 'string'
          ? data
          : Buffer.from(data as Uint8Array).toString('utf8'),
      );
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const records = lines.flatMap((line) =>
      line
        .trim()
        .split('\n')
        .map((row) => JSON.parse(row) as unknown),
    );
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: 'global-packages.remove',
          phase: 'intent',
        }),
        expect.objectContaining({
          operation: 'global-packages.remove',
          phase: 'result',
        }),
      ]),
    );
    expect(lines.join('')).not.toMatch(/TEST_SECRET|rawConfig|environment/);
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { confirm: false },
    { acknowledgedRisks: [] },
    { confirmText: 'remove global npm test-tool' },
    { confirmText: 'REMOVE GLOBAL npm test-tool ' },
  ])(
    'wrong consent %j returns VALIDATION_ERROR before any new probe or spawn',
    async (patch) => {
      const app = await open();
      const preview = await readyPreview(app);
      const probes = f.probe.mock.calls.length;
      const response = await request(app.getHttpServer())
        .post(`${base}/execute`)
        .send({ ...consent(preview), ...patch });
      assertError(response, 400, 'VALIDATION_ERROR');
      expect(f.probe.mock.calls).toHaveLength(probes);
      expect(f.child.launch).not.toHaveBeenCalled();
      expect(f.gate.isBusy()).toBe(false);
    },
  );

  it('loads version options only on the explicit versions route', async () => {
    const app = await open();
    await snapshot(app);
    expect(f.fetcher).not.toHaveBeenCalled();
    const response = await request(app.getHttpServer())
      .post(`${base}/versions`)
      .send({
        requestId: uuid(++serial),
        manager: 'npm',
        package: 'test-tool',
      })
      .expect(202);
    expect(response.headers['cache-control']).toBe('no-store');
    await flushJobs();
    expect(await latest(app)).toMatchObject({
      status: 'completed',
      kind: 'versions',
      versions: {
        manager: 'npm',
        package: 'test-tool',
        tags: { latest: '2.0.0' },
      },
    });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(f.fetcher.mock.calls[0][0]).toBe(
      'https://registry.npmjs.org/test-tool',
    );
    expect(f.child.launch).not.toHaveBeenCalled();
    expect(f.gate.isBusy()).toBe(false);
  });

  it('expired previews return 409 PREVIEW_EXPIRED before acquiring the gate or probing', async () => {
    const app = await open();
    const preview = await readyPreview(app);
    f.clock.advance(300_000);
    const probes = f.probe.mock.calls.length;
    const response = await request(app.getHttpServer())
      .post(`${base}/execute`)
      .send(consent(preview));
    assertError(response, 409, 'CONFLICT', 'PREVIEW_EXPIRED');
    expect(f.probe.mock.calls).toHaveLength(probes);
    expect(f.child.launch).not.toHaveBeenCalled();
  });

  it('changed preview facts return 409 PREVIEW_CHANGED with zero mutation', async () => {
    const app = await open();
    const preview = await readyPreview(app);
    f.changeFacts();
    const response = await request(app.getHttpServer())
      .post(`${base}/execute`)
      .send(consent(preview));
    assertError(response, 409, 'CONFLICT', 'PREVIEW_CHANGED');
    await flushJobs();
    expect(f.child.launch).not.toHaveBeenCalled();
  });

  it('replays an identical execute and rejects consumed preview reuse without a second mutation', async () => {
    const app = await open();
    const preview = await readyPreview(app);
    const body = consent(preview);
    const start = await request(app.getHttpServer())
      .post(`${base}/execute`)
      .send(body)
      .expect(202);
    await flushJobs();
    const replay = await request(app.getHttpServer())
      .post(`${base}/execute`)
      .send(body)
      .expect(202);
    expect((replay.body as IApiResponse<IGlobalJobStart>).data?.jobId).toBe(
      (start.body as IApiResponse<IGlobalJobStart>).data?.jobId,
    );
    const mismatch = await request(app.getHttpServer())
      .post(`${base}/execute`)
      .send({ ...body, confirmText: 'TEST changed' });
    assertError(mismatch, 409, 'CONFLICT', 'REQUEST_MISMATCH');
    await f.removeAndExit();
    const consumed = await request(app.getHttpServer())
      .post(`${base}/execute`)
      .send(consent(preview));
    assertError(consumed, 409, 'CONFLICT', 'PREVIEW_CONSUMED');
    expect(f.child.launch).toHaveBeenCalledTimes(1);
  });

  it('returns RUNNING for a second M7 activity and when another module owns the mutation gate', async () => {
    const app = await open();
    const preview = await readyPreview(app);
    const token = f.gate.tryEnter();
    const blocked = await request(app.getHttpServer())
      .post(`${base}/execute`)
      .send(consent(preview));
    assertError(blocked, 409, 'CONFLICT', 'RUNNING');
    expect(f.child.launch).not.toHaveBeenCalled();
    // Read-only M7 activities remain available while another module holds the gate.
    await readyPreview(app);
    f.gate.leave(token!);
    await request(app.getHttpServer())
      .post(`${base}/execute`)
      .send(consent(preview))
      .expect(202);
    await flushJobs();
    const busy = await request(app.getHttpServer())
      .post(`${base}/inventory`)
      .send({ requestId: uuid(++serial) });
    assertError(busy, 409, 'CONFLICT', 'RUNNING');
    await f.removeAndExit();
  });

  it('keeps latest/status/log polls unthrottled and debug-marked while GET snapshot stays throttled', async () => {
    const app = await open(2);
    await readyPreview(app);
    const job = await latest(app);
    const probes = f.probe.mock.calls.length;
    for (let count = 0; count < 5; count++) {
      await latest(app);
      await request(app.getHttpServer())
        .get(`${base}/jobs/${job!.jobId}`)
        .expect(200);
      const log = await request(app.getHttpServer())
        .get(`${base}/jobs/${job!.jobId}/logs?cursor=0`)
        .expect(200);
      expect((log.body as IApiResponse<IGlobalLogPage>).data?.chunks).toEqual(
        [],
      );
    }
    expect(f.probe.mock.calls).toHaveLength(probes);
    await snapshot(app);
    await snapshot(app);
    const response = await request(app.getHttpServer()).get(base);
    assertError(response, 429, 'RATE_LIMITED');
  });

  it('validates UUID/cursor/extra fields and keeps errors uncacheable', async () => {
    const app = await open();
    const preview = await readyPreview(app);
    const job = await latest(app);
    for (const suffix of [
      'jobs/bad-id',
      `jobs/${job!.jobId}/logs?cursor=-1`,
      `jobs/${job!.jobId}/logs?cursor=9007199254740992`,
    ]) {
      const response = await request(app.getHttpServer()).get(
        `${base}/${suffix}`,
      );
      assertError(response, 400, 'VALIDATION_ERROR');
    }
    const missing = await request(app.getHttpServer()).get(
      `${base}/jobs/${uuid(9999)}`,
    );
    assertError(missing, 404, 'NOT_FOUND');
    const extra = await request(app.getHttpServer())
      .post(`${base}/execute`)
      .send({ ...consent(preview), argv: ['--force'] });
    assertError(extra, 400, 'VALIDATION_ERROR');
    expect(f.child.launch).not.toHaveBeenCalled();
  });

  it('applies Host/Origin guards before activity admission', async () => {
    const app = await open();
    await request(app.getHttpServer())
      .get(`${base}/jobs/latest`)
      .set('Host', 'evil.example:24681')
      .expect(403);
    await request(app.getHttpServer())
      .post(`${base}/inventory`)
      .set('Origin', 'https://evil.example')
      .send({ requestId: uuid(++serial) })
      .expect(403);
    expect(f.probe).not.toHaveBeenCalled();
    expect(f.child.launch).not.toHaveBeenCalled();
    expect(f.gate.isBusy()).toBe(false);
  });

  it('cancel returns 200 and never launches another mutation', async () => {
    const app = await open();
    const preview = await readyPreview(app);
    await request(app.getHttpServer())
      .post(`${base}/execute`)
      .send(consent(preview))
      .expect(202);
    await flushJobs();
    const job = await latest(app);
    const response = await request(app.getHttpServer())
      .post(`${base}/jobs/${job!.jobId}/cancel`)
      .send({})
      .expect(200);
    expect((response.body as IApiResponse<IGlobalJob>).statusCode).toBe(200);
    f.child.exit({ exitCode: null, signal: 'SIGTERM' });
    await flushJobs();
    expect(await latest(app)).toMatchObject({
      status: 'cancelled',
      gateHeld: false,
    });
    await request(app.getHttpServer())
      .post(`${base}/jobs/${job!.jobId}/cancel`)
      .send({})
      .expect(200);
    expect(f.child.launch).toHaveBeenCalledTimes(1);
    expect(f.child.stop).toHaveBeenCalledTimes(1);
  });

  it('rejects non-Windows activity starts with 503 SERVICE_UNAVAILABLE and no spawn', async () => {
    f.runtime.platform = 'linux';
    const app = await open();
    const response = await request(app.getHttpServer())
      .post(`${base}/inventory`)
      .send({ requestId: uuid(++serial) });
    assertError(response, 503, 'SERVICE_UNAVAILABLE');
    expect(f.probe).not.toHaveBeenCalled();
    expect(f.child.launch).not.toHaveBeenCalled();
  });
});
