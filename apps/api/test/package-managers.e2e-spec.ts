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
import type { Server } from 'node:http';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { JSON_BODY_LIMIT } from '@/config/configure-app';
import { execa } from 'execa';
import { AppException } from '@/common/exceptions/app.exception';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import { TransformInterceptor } from '@/common/interceptors/transform.interceptor';
import type { IApiResponse } from '@/common/interceptors/transform.interceptor';
import { createHostOriginMiddleware } from '@/common/middleware/host-origin.middleware';
import { AppPathsService } from '@/core/app-paths/app-paths.service';
import { AuditLogService } from '@/core/audit-log/audit-log.service';
import { PathGuardService } from '@/core/path-guard/path-guard.service';
import { MutationGateService } from '@/core/mutation-gate/mutation-gate.service';
import { THROTTLER_NAMES } from '@/core/throttler-config.module';
import { ScannerCache } from '@/scanner/cache/scanner-cache';
import { ScannerService } from '@/scanner/scanner.service';
import { DiskUsageService } from '@/disk-usage/disk-usage.service';
import { FileOpsService } from '@/file-ops/file-ops.service';
import { ProjectsService } from '@/projects/projects.service';
import { PackageManagersModule } from '@/package-managers/package-managers.module';
import { PackageManagersService } from '@/package-managers/package-managers.service';
import { PM_FS, PM_RUNTIME } from '@/package-managers/interfaces/pm.runtime';
import type {
  IPmJob,
  IPmJobStart,
} from '@/package-managers/interfaces/pm.types';
import {
  deferred,
  flushPmJobs,
  pmLifecycleFixture,
  pmUuid,
} from '@/package-managers/__fixtures__/pm-lifecycle.fixture';
import { root, key } from '@/npm-runner/__fixtures__/runner-test.fixture';

// Expected RED: module/routes absent. Real HTTP/service/writer with in-memory project IO.
// TEST only; không phải yêu cầu nghiệp vụ. Never use the developer's project files or tools.
jest.mock('execa', () => ({
  execa: jest.fn(() => {
    throw new Error('TEST child forbidden');
  }),
}));
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
    mkdir: blocked(),
    appendFile: blocked(),
  };
});
@Global()
@Module({
  providers: [
    {
      provide: ConfigService,
      useValue: new ConfigService({
        SCAN_ROOT_PATHS: '*',
        NPM_COMMAND_TIMEOUT_MS: '',
      }),
    },
  ],
  exports: [ConfigService],
})
class TestConfigModule {}
const base = '/api/v1/package-managers';
type ErrorBody = { code: string; details?: { reason?: string } };

describe('M9 HTTP preview/confirm (mock IO, zero children)', () => {
  let f: ReturnType<typeof pmLifecycleFixture>;
  let apps: INestApplication<Server>[];
  let serial: number;
  beforeEach(() => {
    f = pmLifecycleFixture();
    apps = [];
    serial = 1000;
    jest.mocked(execa).mockClear();
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('TEST network forbidden'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(async () => {
    try {
      for (const app of apps.reverse()) await app.close();
      expect(execa).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      jest.restoreAllMocks();
    }
  });
  const open = async (limit = 100) => {
    const module = await Test.createTestingModule({
      imports: [
        TestConfigModule,
        ThrottlerModule.forRoot(
          THROTTLER_NAMES.map((name) => ({ name, ttl: 60_000, limit })),
        ),
        PackageManagersModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_INTERCEPTOR, useClass: ClassSerializerInterceptor },
        { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    })
      .overrideProvider(PM_RUNTIME)
      .useValue(f.runtime)
      .overrideProvider(PM_FS)
      .useValue(f.fs)
      .overrideProvider(ScannerCache)
      .useValue({})
      .overrideProvider(ScannerService)
      .useValue({})
      .overrideProvider(DiskUsageService)
      .useValue({})
      .overrideProvider(FileOpsService)
      .useValue({})
      .overrideProvider(ProjectsService)
      .useValue({})
      .overrideProvider(AppPathsService)
      .useValue({ cacheDir: 'D:\\TEST\\cache', dataDir: 'D:\\TEST\\data' })
      .overrideProvider(PathGuardService)
      .useValue({})
      .overrideProvider(AuditLogService)
      .useValue({})
      .overrideProvider(MutationGateService)
      .useValue(f.gate)
      .compile();
    const app = module.createNestApplication<INestApplication<Server>>();
    apps.push(app);
    app.setGlobalPrefix('api/v1');
    // Same order as configureApp: Host/Origin guard before the body parser.
    app.use(
      createHostOriginMiddleware({
        allowedOrigins: ['http://localhost:24680'],
      }),
    );
    (app as unknown as NestExpressApplication).useBodyParser('json', {
      limit: JSON_BODY_LIMIT,
    });
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
    return (response.body as IApiResponse<IPmJob | null>).data;
  };
  const preview = async (
    app: INestApplication<Server>,
    targetVersion = 'latest',
  ) => {
    const response = await request(app.getHttpServer())
      .post(`${base}/project/preview`)
      .send({
        requestId: pmUuid(++serial),
        path: root,
        manager: 'npm',
        targetVersion,
      })
      .expect(202);
    await flushPmJobs();
    const job = await latest(app);
    if (!job?.preview) throw new Error('TEST preview missing');
    expect(job.preview.previewId).toBe(
      (response.body as IApiResponse<IPmJobStart>).data?.previewId,
    );
    return {
      requestId: pmUuid(++serial),
      previewId: job.preview.previewId,
      confirm: true as const,
      acknowledgedRisks: job.preview.risk.reasons.map((reason) => reason.code),
    };
  };
  it('boots without IO, GET is static, unknown jobs/routes have D7 envelopes', async () => {
    const app = await open();
    expect(f.open).not.toHaveBeenCalled();
    expect(await latest(app)).toBeNull();
    const context = await request(app.getHttpServer())
      .get(`${base}/project`)
      .query({ path: root })
      .expect(200);
    expect(context.headers['cache-control']).toBe('no-store');
    expect(f.getPackageMetadata).not.toHaveBeenCalled();
    expect(f.rename).not.toHaveBeenCalled();
    const missing = await request(app.getHttpServer())
      .get(`${base}/jobs/${pmUuid(999)}`)
      .expect(404);
    expect((missing.body as ErrorBody).code).toBe('NOT_FOUND');
    await request(app.getHttpServer())
      .get(`${base}/jobs/${pmUuid(999)}/logs`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`${base}/global/execute`)
      .send({})
      .expect(404);
  });
  it('confirms one atomic edit, recovers lost POST and refuses altered/consumed replay', async () => {
    const app = await open();
    const input = await preview(app);
    const response = await request(app.getHttpServer())
      .post(`${base}/project/execute`)
      .send(input)
      .expect(202);
    expect(response.headers['cache-control']).toBe('no-store');
    const start = (response.body as IApiResponse<IPmJobStart>).data!;
    await flushPmJobs();
    expect(await latest(app)).toMatchObject({
      jobId: start.jobId,
      requestId: input.requestId,
      phase: 'done',
      status: 'completed',
      fileCommitted: true,
      auditWritten: true,
      gateHeld: false,
    });
    await request(app.getHttpServer())
      .post(`${base}/project/execute`)
      .send(input)
      .expect(202);
    expect(f.rename).toHaveBeenCalledTimes(1);
    const altered = await request(app.getHttpServer())
      .post(`${base}/project/execute`)
      .send({ ...input, confirmText: 'other' })
      .expect(409);
    expect((altered.body as ErrorBody).details?.reason).toBe(
      'REQUEST_MISMATCH',
    );
    const consumed = await request(app.getHttpServer())
      .post(`${base}/project/execute`)
      .send({ ...input, requestId: pmUuid(++serial) })
      .expect(409);
    expect((consumed.body as ErrorBody).details?.reason).toBe(
      'PREVIEW_CONSUMED',
    );
    const jobResponse = await request(app.getHttpServer())
      .get(`${base}/jobs/${start.jobId}`)
      .expect(200);
    expect(JSON.stringify(jobResponse.body)).not.toMatch(
      /inputHash|manifestIdentity|metadata|readChunks|stdout|exitCode/,
    );
  });
  it.each(['scan', 'file', 'tag', 'ttl', 'reader', 'risk'] as const)(
    'returns preflight 409 for changed %s, with no write',
    async (change) => {
      const app = await open();
      const input = await preview(app);
      if (change === 'scan') f.scan.scanId = pmUuid(888);
      if (change === 'file')
        f.put(f.manifest, '{"name":"TEST-new","packageManager":"npm@11.16.0"}');
      if (change === 'tag')
        f.getPackageMetadata.mockResolvedValue({
          versions: ['11.16.0', '11.17.0', '11.18.0'],
          distTags: { latest: '11.18.0' },
          deprecatedVersions: [],
        });
      if (change === 'ttl') f.advance(300_000);
      if (change === 'reader') f.readers.hasRunningScan.mockReturnValue(true);
      if (change === 'risk')
        f.put(`${root}\\.git\\HEAD`, 'TEST inert activity');
      if (change === 'risk') {
        // A fresh stat-only activity change, without modifying the manifest bytes.
        const stat = f.stats.get(key(`${root}\\.git\\HEAD`))!;
        f.stats.set(key(`${root}\\.git\\HEAD`), {
          ...stat,
          mtimeMs: f.runtime.now().getTime(),
        });
      }
      const response = await request(app.getHttpServer())
        .post(`${base}/project/execute`)
        .send(input)
        .expect(409);
      expect((response.body as ErrorBody).code).toBe('CONFLICT');
      expect(response.headers['cache-control']).toBe('no-store');
      await flushPmJobs();
      expect(f.rename).not.toHaveBeenCalled();
    },
  );
  it('keeps the provisional job pollable/cancellable during slow preflight and rejects racing admission', async () => {
    const app = await open();
    const input = await preview(app);
    const catalog =
      deferred<Awaited<ReturnType<typeof f.getPackageMetadata>>>();
    const entered = deferred<void>();
    f.getPackageMetadata.mockImplementationOnce(() => {
      entered.resolve();
      return catalog.promise;
    });
    const execute = request(app.getHttpServer())
      .post(`${base}/project/execute`)
      .send(input)
      .then((response) => response);
    await entered.promise;
    const pending = await latest(app);
    expect(pending).toMatchObject({
      requestId: input.requestId,
      gateHeld: true,
    });
    const busy = await request(app.getHttpServer())
      .post(`${base}/versions`)
      .send({ requestId: pmUuid(++serial), path: root, manager: 'npm' })
      .expect(409);
    expect((busy.body as ErrorBody).details?.reason).toBe('RUNNING');
    await request(app.getHttpServer())
      .post(`${base}/jobs/${pending!.jobId}/cancel`)
      .send({})
      .expect(200);
    expect(f.gate.isBusy()).toBe(true);
    catalog.resolve({
      versions: ['11.17.0'],
      distTags: { latest: '11.17.0' },
      deprecatedVersions: [],
    });
    expect((await execute).status).toBe(202);
    await flushPmJobs();
    expect(await latest(app)).toMatchObject({
      status: 'cancelled',
      phase: 'done',
      gateHeld: false,
      fileCommitted: false,
    });
    expect(f.rename).not.toHaveBeenCalled();
    expect(f.audit.write.mock.calls.some((call) => call[3] === 'cancel')).toBe(
      true,
    );
  });
  it('enforces DTO/consent/Host/Origin and prefix no-store before validation', async () => {
    const app = await open();
    for (const body of [
      { requestId: pmUuid(1), path: root, manager: 'npm', argv: [] },
      { requestId: 'invalid', path: root, manager: 'npm' },
      { requestId: pmUuid(1), path: null, manager: 'npm' },
      { requestId: pmUuid(1), path: 'relative', manager: 'npm' },
      {
        requestId: pmUuid(1),
        path: 'D:\\' + 'x'.repeat(32768),
        manager: 'npm',
      },
    ]) {
      const response = await request(app.getHttpServer())
        .post(`${base}/versions`)
        .send(body)
        .expect(400);
      expect((response.body as ErrorBody).code).toBe('VALIDATION_ERROR');
      expect(response.headers['cache-control']).toBe('no-store');
    }
    const input = await preview(app);
    await request(app.getHttpServer())
      .post(`${base}/project/execute`)
      .send({ ...input, confirm: 'true' })
      .expect(400);
    await request(app.getHttpServer())
      .post(`${base}/project/execute`)
      .send({ ...input, path: root })
      .expect(400);
    await request(app.getHttpServer())
      .get(`${base}/jobs/latest`)
      .set('Host', 'evil.example')
      .expect(403);
    await request(app.getHttpServer())
      .post(`${base}/versions`)
      .set('Origin', 'https://evil.example')
      .send({})
      .expect(403);
    expect(f.rename).not.toHaveBeenCalled();
  });
  it('exempts only status polls from every configured throttler', async () => {
    const app = await open(1);
    for (let i = 0; i < 4; i++) {
      await latest(app);
      await request(app.getHttpServer())
        .get(`${base}/jobs/${pmUuid(999)}`)
        .expect(404);
    }
    await request(app.getHttpServer())
      .get(`${base}/project`)
      .query({ path: root })
      .expect(200);
    const limited = await request(app.getHttpServer())
      .get(`${base}/project`)
      .query({ path: root })
      .expect(429);
    expect((limited.body as ErrorBody).code).toBe('RATE_LIMITED');
    expect(limited.headers['cache-control']).toBe('no-store');
    expect(app.get(PackageManagersService).getLatest()).toBeNull();
  });
  it('rejects an oversized JSON body before job admission with D7 PAYLOAD_TOO_LARGE', async () => {
    const app = await open();
    const response = await request(app.getHttpServer())
      .post(`${base}/versions`)
      .send({ padding: 'x'.repeat(10 * 1024 * 1024) })
      .expect(413);
    expect((response.body as ErrorBody).code).toBe('PAYLOAD_TOO_LARGE');
    expect(app.get(PackageManagersService).getLatest()).toBeNull();
    expect(f.getPackageMetadata).not.toHaveBeenCalled();
    expect(f.rename).not.toHaveBeenCalled();
  });
});
