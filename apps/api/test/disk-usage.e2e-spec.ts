import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import request from 'supertest';
import { AppModule } from '@/app.module';
import type { IApiResponse } from '@/common/interceptors/transform.interceptor';
import { loadAppConfig } from '@/config/config-loader';
import { configureApp } from '@/config/configure-app';
import { AppPathsService } from '@/core/app-paths/app-paths.service';
import { DRIVE_DETECTOR } from '@/platform/interfaces/drive-detector.interface';
import {
  DISK_WALKER,
  walkDiskUsage,
} from '@/disk-usage/traversal/disk-usage-walker';
import type {
  DiskWalker,
  IDiskUsageJob,
  IDiskUsageStart,
  IStartDiskUsage,
} from '@/disk-usage/interfaces/disk-usage.types';
import { createTestAppPaths } from './create-test-app-paths';

describe('DiskUsage HTTP flow (e2e)', () => {
  let base: string;
  let root: string;
  let dataDir: string;
  let installDir: string;
  let apps: INestApplication<Server>[];
  const detect = jest.fn(() =>
    Promise.reject(new Error('Drive discovery must not run')),
  );

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'pkgsteward-disk-e2e-'));
    root = join(base, 'allowed');
    dataDir = join(base, 'data');
    installDir = join(base, 'install');
    apps = [];
    detect.mockClear();
    await Promise.all(
      [root, dataDir, installDir, join(base, 'outside')].map((path) =>
        mkdir(path),
      ),
    );
    await mkdir(join(root, 'node_modules'));
    await mkdir(join(root, 'other'));
    await writeFile(join(root, 'hello.txt'), 'hello');
  });

  afterEach(async () => {
    try {
      for (const app of [...apps].reverse()) await app.close();
      expect(detect).not.toHaveBeenCalled();
    } finally {
      jest.restoreAllMocks();
      // Remove only this test's mkdtemp root, after every application has closed.
      if (base) await rm(base, { recursive: true, force: true });
    }
  });

  const openApp = async (walker?: DiskWalker) => {
    const config = new ConfigService(
      loadAppConfig({
        env: {
          ...process.env,
          SCAN_ROOT_PATHS: root,
          MAX_SCAN_DEPTH: 0,
          SCAN_TIMEOUT_MS: '',
          PKGSTEWARD_DATA_DIR: dataDir,
          MODE: 'development',
          EXPORT_SWAGGER_API_JSON: true,
        },
      }),
    );
    const builder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(config)
      .overrideProvider(DRIVE_DETECTOR)
      .useValue({ listFixedDrives: detect })
      .overrideProvider(AppPathsService)
      .useFactory({
        factory: (service: ConfigService) =>
          createTestAppPaths(service, installDir),
        inject: [ConfigService],
      });
    if (walker) builder.overrideProvider(DISK_WALKER).useValue(walker);
    const module = await builder.compile();
    const app = module.createNestApplication<INestApplication<Server>>();
    app.useLogger(['error']);
    apps.push(app);
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    return app;
  };

  const start = async (
    app: INestApplication<Server>,
    input: IStartDiskUsage = { path: root },
  ) => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/disk-usage')
      .send(input)
      .expect(202);
    const body = response.body as IApiResponse<IDiskUsageStart>;
    expect(body.statusCode).toBe(202);
    expect(body.code).toBe('SUCCESS');
    expect(body.path).toBe('/api/v1/disk-usage');
    expect(body.message).toEqual(expect.any(String));
    expect(body.timestamp).toEqual(expect.any(String));
    expect(body.data?.jobId).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i,
    );
    return body.data!;
  };

  const get = async (app: INestApplication<Server>, jobId: string) => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/disk-usage/${jobId}`)
      .expect(200);
    const body = response.body as IApiResponse<IDiskUsageJob>;
    expect(body.statusCode).toBe(200);
    expect(body.code).toBe('SUCCESS');
    expect(body.data?.jobId).toBe(jobId);
    expect(response.headers['cache-control']).toBe('no-store');
    return body.data!;
  };

  const poll = async (app: INestApplication<Server>, jobId: string) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const job = await get(app, jobId);
      if (job.status !== 'running') return job;
      await delay(10);
    }
    throw new Error('Measurement did not reach a terminal status');
  };

  const heldWalker = (): DiskWalker => (initial, signal) =>
    new Promise((resolve) => {
      const finish = () =>
        resolve({
          ...initial,
          status: 'cancelled',
          partial: true,
          stopReason: 'cancelled',
        });
      if (signal.aborted) finish();
      else signal.addEventListener('abort', finish, { once: true });
    });

  it('starts, completes, hits cache with the original measuredAt, then forces a new walk', async () => {
    const walker = jest.fn(walkDiskUsage);
    const app = await openApp(walker);
    const first = await start(app);
    const measured = await poll(app, first.jobId);
    expect(measured).toMatchObject({
      status: 'completed',
      path: await realpath(root),
      view: 'directory',
      metric: 'unique-apparent',
      sizeBytes: 5,
      fileCount: 1,
      partial: false,
      cacheHit: false,
      stopReason: null,
      failureCode: null,
    });
    expect(new Date(measured.measuredAt!).toISOString()).toBe(
      measured.measuredAt,
    );
    const cached = await start(app);
    expect(cached.status).toBe('completed');
    expect(cached.jobId).not.toBe(first.jobId);
    expect(await get(app, cached.jobId)).toMatchObject({
      cacheHit: true,
      measuredAt: measured.measuredAt,
      sizeBytes: 5,
    });
    expect(walker).toHaveBeenCalledTimes(1);
    const forced = await start(app, { path: root, force: true });
    expect((await poll(app, forced.jobId)).cacheHit).toBe(false);
    expect(walker).toHaveBeenCalledTimes(2);
  });

  it('shares same-target starts, exposes conflict details and cancels idempotently', async () => {
    const app = await openApp(heldWalker());
    const started = await start(app);
    expect(await start(app)).toEqual(started);
    const conflict = await request(app.getHttpServer())
      .post('/api/v1/disk-usage')
      .send({ path: join(root, 'other') })
      .expect(409);
    expect(conflict.body).toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
      details: { jobId: started.jobId, path: await realpath(root) },
    });
    const cancel = () =>
      request(app.getHttpServer())
        .post(`/api/v1/disk-usage/${started.jobId}/cancel`)
        .expect(200);
    const first = (await cancel()).body as IApiResponse<IDiskUsageJob>;
    expect(first).toMatchObject({
      statusCode: 200,
      code: 'SUCCESS',
      data: { status: 'cancelled', partial: true, stopReason: 'cancelled' },
    });
    expect(((await cancel()).body as IApiResponse<IDiskUsageJob>).data).toEqual(
      first.data,
    );
    expect(await get(app, started.jobId)).toEqual(first.data);
  });

  it('polls more than 20 times in 10s without 429 while start and cancel retain global limits', async () => {
    const app = await openApp(heldWalker());
    const started = await start(app);
    const debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    const info = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    for (let i = 0; i < 24; i++)
      expect((await get(app, started.jobId)).status).toBe('running');
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining(`GET /api/v1/disk-usage/${started.jobId}`),
    );
    expect(info).not.toHaveBeenCalledWith(
      expect.stringContaining(`GET /api/v1/disk-usage/${started.jobId}`),
    );
    for (let i = 0; i < 24; i++) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/disk-usage')
        .send({ path: root });
      if (response.status === 429) {
        expect(response.body).toMatchObject({
          statusCode: 429,
          code: 'RATE_LIMITED',
        });
        return;
      }
      expect(response.status).toBe(202);
    }
    throw new Error('Start must retain the global short-term rate limit');
  });

  it('retains the global short-term rate limit for cancel', async () => {
    const app = await openApp(heldWalker());
    const started = await start(app);
    for (let i = 0; i < 24; i++) {
      const response = await request(app.getHttpServer()).post(
        `/api/v1/disk-usage/${started.jobId}/cancel`,
      );
      if (response.status === 429) {
        expect(response.body).toMatchObject({
          statusCode: 429,
          code: 'RATE_LIMITED',
        });
        return;
      }
      expect(response.status).toBe(200);
    }
    throw new Error('Cancel must retain the global short-term rate limit');
  });

  it('rejects invalid JSON contract fields before starting a measurement', async () => {
    const walker = jest.fn(walkDiskUsage);
    const app = await openApp(walker);
    for (const input of [
      {},
      { path: '' },
      { path: 1 },
      { path: 'a'.repeat(32769) },
      { path: root, view: 'invalid' },
      { path: root, force: 'false' },
      { path: root, force: 'true' },
      { path: root, view: null },
      { path: root, force: null },
      { path: root, extra: true },
    ]) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/disk-usage')
        .send(input)
        .expect(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    expect(walker).not.toHaveBeenCalled();
  });

  it('rejects package view on other basenames, files and malformed paths', async () => {
    const app = await openApp();
    for (const input of [
      { path: root, view: 'packages' },
      { path: join(root, 'hello.txt') },
      { path: '../relative' },
      { path: `${root}\0bad` },
    ]) {
      await request(app.getHttpServer())
        .post('/api/v1/disk-usage')
        .send(input)
        .expect(400)
        .expect(({ body }) =>
          expect(body).toMatchObject({ code: 'VALIDATION_ERROR' }),
        );
    }
  });

  it('returns 403 outside the allowlist and 404 for a missing allowed path', async () => {
    const app = await openApp();
    await request(app.getHttpServer())
      .post('/api/v1/disk-usage')
      .send({ path: join(base, 'outside') })
      .expect(403)
      .expect(({ body }) => expect(body).toMatchObject({ code: 'FORBIDDEN' }));
    await request(app.getHttpServer())
      .post('/api/v1/disk-usage')
      .send({ path: join(root, 'missing') })
      .expect(404)
      .expect(({ body }) => expect(body).toMatchObject({ code: 'NOT_FOUND' }));
  });

  it('validates UUID v4 and returns 404 for an unknown job on both dynamic routes', async () => {
    const app = await openApp();
    for (const method of ['get', 'post'] as const) {
      const suffix = method === 'post' ? '/cancel' : '';
      for (const id of ['invalid', 'e4261d1d-590f-18a4-a765-d6dedcff17e4']) {
        await request(app.getHttpServer())
          [method](`/api/v1/disk-usage/${id}${suffix}`)
          .expect(400)
          .expect(({ body }) =>
            expect(body).toMatchObject({ code: 'VALIDATION_ERROR' }),
          );
      }
      await request(app.getHttpServer())
        [method](
          `/api/v1/disk-usage/e4261d1d-590f-48a4-a765-d6dedcff17e4${suffix}`,
        )
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject({ code: 'NOT_FOUND' }),
        );
    }
  });

  it('exposes partial snapshots without caching them', async () => {
    const walker: DiskWalker = (initial) =>
      Promise.resolve({
        ...initial,
        status: 'completed',
        phase: 'measuring',
        sizeBytes: 5,
        fileCount: 1,
        partial: true,
        stopReason: 'identity_limit',
      });
    const measured = jest.fn(walker);
    const app = await openApp(measured);
    const first = await start(app);
    const partial = await poll(app, first.jobId);
    expect(partial).toMatchObject({
      status: 'completed',
      partial: true,
      stopReason: 'identity_limit',
      cacheHit: false,
    });
    // Completed jobs always carry measuredAt, even when partial (lower bound).
    expect(typeof partial.measuredAt).toBe('string');
    const next = await start(app);
    await poll(app, next.jobId);
    expect(measured).toHaveBeenCalledTimes(2);
  });
});
