import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
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
  ScanJobEntity,
  ScanResultEntity,
  ScanStartEntity,
} from '@/scanner/entities/scan.entity';
import type {
  IScanJob,
  IScanResult,
  IScanStart,
  IWalkSnapshot,
  ScanWalker,
} from '@/scanner/interfaces/scanner.types';
import { SCAN_WALKER } from '@/scanner/scan-walker';
import { ScannerService } from '@/scanner/scanner.service';
import { createTestAppPaths } from './create-test-app-paths';

describe('Scanner HTTP flow and cache (e2e)', () => {
  let base: string;
  let root: string;
  let dataDir: string;
  let installDir: string;
  let apps: INestApplication<Server>[];
  const detect = jest.fn(() =>
    Promise.reject(new Error('Drive discovery must not run')),
  );

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'pkgsteward-scanner-e2e-'));
    root = join(base, 'scan');
    dataDir = join(base, 'data');
    installDir = join(base, 'install');
    apps = [];
    detect.mockClear();
    await Promise.all(
      [root, dataDir, installDir].map((directory) => mkdir(directory)),
    );
    const packages = [
      ['', '{"name":"monorepo"}'],
      ['app', '{"name":"app"}'],
      ['packages/child', '{"name":"child"}'],
      ['unnamed', '{}'],
      ['broken', '{'],
      ['.hidden', '{"name":"hidden"}'],
      ['dist/generated', '{"name":"generated"}'],
      ['app/node_modules/vendor', '{"name":"vendor"}'],
    ];
    for (const [directory, content] of packages) {
      await mkdir(join(root, directory), { recursive: true });
      await writeFile(join(root, directory, 'package.json'), content);
    }
    await mkdir(join(root, 'old', 'node_modules'), { recursive: true });
    await writeFile(join(root, 'app', 'pnpm-lock.yaml'), 'lockfileVersion: 9');
  });

  afterEach(async () => {
    try {
      for (const app of [...apps].reverse()) await app.close();
      expect(detect).not.toHaveBeenCalled();
    } finally {
      // Only the mkdtemp directory owned by this test is removed, after closing apps.
      if (base) await rm(base, { recursive: true, force: true });
    }
  });

  const openApp = async (
    options: {
      depth?: number;
      roots?: string;
      walker?: ScanWalker;
      timeout?: number;
    } = {},
  ) => {
    const config = new ConfigService(
      loadAppConfig({
        env: {
          ...process.env,
          SCAN_ROOT_PATHS: options.roots ?? root,
          MAX_SCAN_DEPTH: options.depth ?? 0,
          SCAN_TIMEOUT_MS: options.timeout ?? 10000,
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
    if (options.walker)
      builder.overrideProvider(SCAN_WALKER).useValue(options.walker);
    const module = await builder.compile();
    const app = module.createNestApplication<INestApplication<Server>>();
    app.useLogger(['error']);
    apps.push(app);
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    return app;
  };

  const closeApp = async (app: INestApplication<Server>) => {
    await app.close();
    apps.splice(apps.indexOf(app), 1);
  };

  const start = async (app: INestApplication<Server>) => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/scans')
      .expect(202);
    expect(response.body).toMatchObject({
      statusCode: 202,
      code: 'SUCCESS',
      path: '/api/v1/scans',
      timestamp: expect.any(String) as unknown,
    });
    return (response.body as IApiResponse<IScanStart>).data!;
  };

  const poll = async (app: INestApplication<Server>, scanId: string) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/scans/${scanId}`)
        .expect(200);
      expect(response.body).toMatchObject({
        statusCode: 200,
        code: 'SUCCESS',
        path: `/api/v1/scans/${scanId}`,
        timestamp: expect.any(String) as unknown,
        data: {
          progress: {
            visitedDirs: expect.any(Number) as unknown,
            foundProjects: expect.any(Number) as unknown,
            skippedCount: expect.any(Number) as unknown,
          },
        },
      });
      const job = (response.body as IApiResponse<IScanJob>).data!;
      if (job.status !== 'running') return job;
      await delay(10);
    }
    throw new Error('Scan did not reach a terminal status');
  };

  const latest = async (app: INestApplication<Server>) => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/scans/latest')
      .expect(200);
    return (response.body as IApiResponse<IScanResult>).data!;
  };

  const completed = async (app: INestApplication<Server>) => {
    const scan = await start(app);
    expect((await poll(app, scan.scanId)).status).toBe('completed');
    return latest(app);
  };

  const heldWalker = (): ScanWalker => (_roots, _depth, signal) =>
    new Promise<IWalkSnapshot>((resolve) => {
      const finish = () =>
        resolve({
          roots: [],
          projects: [],
          orphanNodeModules: [],
          progress: { visitedDirs: 0, foundProjects: 0, skippedCount: 0 },
        });
      if (signal.aborted) finish();
      else signal.addEventListener('abort', finish, { once: true });
    });

  it('scans real monorepo projects and orphans, prunes excluded children and preserves metadata/nulls', async () => {
    const app = await openApp();
    await request(app.getHttpServer())
      .get('/api/v1/scans/latest')
      .expect(404)
      .expect(({ body }) => expect(body).toMatchObject({ code: 'NOT_FOUND' }));
    const result = await completed(app);
    expect(result).toMatchObject({
      status: 'completed',
      partial: false,
      roots: [await realpath(root)],
      maxDepth: 0,
      skippedCount: 0,
    });
    expect(result.projects.map((project) => project.name).sort()).toEqual(
      [null, null, 'app', 'child', 'monorepo'].sort(),
    );
    const project = result.projects.find((item) => item.name === 'app')!;
    expect(project).toMatchObject({
      packageManager: 'pnpm',
      hasLockfile: true,
      nodeModules: {
        exists: true,
        path: join(root, 'app', 'node_modules'),
        sizeBytes: null,
      },
    });
    expect(result.projects.find((item) => item.name === 'child')).toMatchObject(
      {
        packageManager: null,
        hasLockfile: false,
        nodeModules: { exists: false, sizeBytes: null },
      },
    );
    expect(result.orphanNodeModules).toEqual([
      {
        path: join(root, 'old', 'node_modules'),
        sizeBytes: null,
        mtime: expect.any(String) as unknown,
      },
    ]);
    for (const value of [
      result.startedAt,
      result.finishedAt,
      ...result.projects.map((item) => item.lastActivityAt),
      result.orphanNodeModules[0].mtime,
    ]) {
      expect(new Date(value).toISOString()).toBe(value);
    }
    const service = app.get(ScannerService);
    expect(service.getLatest()).toBeInstanceOf(ScanResultEntity);
    expect(service.getScan(result.scanId)).toBeInstanceOf(ScanJobEntity);
    const next = service.startScan();
    expect(next).toBeInstanceOf(ScanStartEntity);
    expect((await poll(app, next.scanId)).status).toBe('completed');
  });

  it('validates UUIDs on both dynamic routes and returns NOT_FOUND for unknown jobs', async () => {
    const app = await openApp();
    for (const method of ['get', 'post'] as const) {
      const suffix = method === 'post' ? '/cancel' : '';
      await request(app.getHttpServer())
        [method](`/api/v1/scans/invalid${suffix}`)
        .expect(400)
        .expect(({ body }) => {
          expect(body).toMatchObject({
            code: 'VALIDATION_ERROR',
            details: [
              { field: 'scanId', messages: expect.any(Array) as unknown },
            ],
          });
        });
      await request(app.getHttpServer())
        [method](`/api/v1/scans/e4261d1d-590f-48a4-a765-d6dedcff17e4${suffix}`)
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject({ code: 'NOT_FOUND' }),
        );
    }
  });

  it('shares one running job for concurrent starts and cancels idempotently', async () => {
    const walker = jest.fn(heldWalker());
    const app = await openApp({ walker });
    const scans = await Promise.all([start(app), start(app)]);
    expect(scans[0]).toEqual(scans[1]);
    expect(walker).toHaveBeenCalledTimes(1);
    // Polling must bypass all configured throttlers, including short-term.
    for (let i = 0; i < 24; i++)
      await request(app.getHttpServer())
        .get(`/api/v1/scans/${scans[0].scanId}`)
        .expect(200);
    const cancel = () =>
      request(app.getHttpServer())
        .post(`/api/v1/scans/${scans[0].scanId}/cancel`)
        .expect(200);
    const first = await cancel();
    expect(first.body).toMatchObject({
      statusCode: 200,
      code: 'SUCCESS',
      data: {
        status: 'cancelled',
        partial: true,
        finishedAt: expect.any(String) as unknown,
      },
    });
    expect(((await cancel()).body as IApiResponse<IScanJob>).data).toEqual(
      (first.body as IApiResponse<IScanJob>).data,
    );
    await request(app.getHttpServer()).get('/api/v1/scans/latest').expect(404);
  });

  it('times out through the real service and publishes a partial latest result', async () => {
    const app = await openApp({ walker: heldWalker(), timeout: 1000 });
    const scan = await start(app);
    expect(await poll(app, scan.scanId)).toMatchObject({
      status: 'timed_out',
      partial: true,
      finishedAt: expect.any(String) as unknown,
    });
    expect(await latest(app)).toMatchObject({
      scanId: scan.scanId,
      status: 'timed_out',
      partial: true,
    });
  });

  it('loads latest from disk after restart without restoring the old job slot', async () => {
    const first = await openApp();
    const result = await completed(first);
    await closeApp(first);
    const cache = JSON.parse(
      await readFile(join(dataDir, 'cache', 'last-scan.json'), 'utf8'),
    ) as { schemaVersion: number };
    expect(cache.schemaVersion).toBe(1);
    const second = await openApp();
    expect(await latest(second)).toEqual(result);
    await request(second.getHttpServer())
      .get(`/api/v1/scans/${result.scanId}`)
      .expect(404)
      .expect(({ body }) => expect(body).toMatchObject({ code: 'NOT_FOUND' }));
  });

  it.each(['depth', 'roots'] as const)(
    'invalidates cached results when %s changes',
    async (setting) => {
      const first = await openApp();
      await completed(first);
      await closeApp(first);
      const second = await openApp(
        setting === 'depth' ? { depth: 1 } : { roots: join(root, 'app') },
      );
      await request(second.getHttpServer())
        .get('/api/v1/scans/latest')
        .expect(404);
      const result = await completed(second);
      if (setting === 'depth')
        expect(
          result.projects.some((project) => project.name === 'child'),
        ).toBe(false);
      else
        expect(result.projects.map((project) => project.name)).toEqual(['app']);
    },
  );

  it.each(['invalid JSON', 'invalid nested metadata'])(
    'ignores %s in the cache without preventing startup',
    async (kind) => {
      const first = await openApp();
      await completed(first);
      await closeApp(first);
      const file = join(dataDir, 'cache', 'last-scan.json');
      if (kind === 'invalid JSON') await writeFile(file, '{');
      else {
        const entry = JSON.parse(await readFile(file, 'utf8')) as {
          result: IScanResult;
        };
        entry.result.projects[0].nodeModules.sizeBytes = 42 as unknown as null;
        await writeFile(file, JSON.stringify(entry));
      }
      const second = await openApp();
      await request(second.getHttpServer())
        .get('/api/v1/scans/latest')
        .expect(404);
      expect((await completed(second)).status).toBe('completed');
    },
  );
});
