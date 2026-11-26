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
import { ScannerCache } from '@/scanner/cache/scanner-cache';
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
import {
  TEST_PATHS,
  testTool,
} from '@/global-packages/__fixtures__/global-adapters';
import { globalHttpFixture } from '@/../test/mocks/global-packages';
import { npmLifecycleFixture } from '@/global-packages/__fixtures__/npm-overlay/lifecycle';
import { npmTarget } from '@/global-packages/__fixtures__/npm-overlay/facts';
import * as locationAdapter from '@/global-packages/discovery/global-location';
import { GlobalRegistry } from '@/global-packages/registry/global-registry';
import {
  YARN_TEST_PATHS as Y,
  yarnConfigFacts,
  yarnLocation,
} from '@/global-packages/__fixtures__/yarn1/facts';
import {
  yarnGlobalBinShims,
  yarnLocalBinShims,
} from '@/global-packages/__fixtures__/yarn1/shims';

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

  it.each(['change', 'remove', 'repair'] as const)(
    'runs npm-self %s over HTTP without npm ls',
    async (action) => {
      const npm = npmLifecycleFixture(
        action === 'change'
          ? 'absent'
          : action === 'remove'
            ? 'present'
            : 'broken',
      );
      f.runtime = npm.runtime;
      jest
        .spyOn(locationAdapter, 'discoverGlobalLocation')
        .mockImplementation((manager) =>
          manager !== 'npm'
            ? Promise.reject(
                new AppException(409, 'TEST unavailable', 'CONFLICT', {
                  reason: 'TOOL_NOT_FOUND',
                }),
              )
            : Promise.resolve(npm.location),
        );
      jest.spyOn(GlobalRegistry.prototype, 'getVersions').mockResolvedValue({
        manager: 'npm',
        package: 'npm',
        versions: ['11.17.0', '12.2.2'],
        deprecatedVersions: [],
        tags: { latest: '12.2.2' },
      });
      jest
        .spyOn(GlobalRegistry.prototype, 'getTarget')
        .mockResolvedValue(npmTarget());
      const app = await open();
      const waitDone = async () => {
        for (let index = 0; index < 40; index++) {
          const job = await latest(app);
          if (job?.phase === 'done') return job;
        }
        throw new Error('TEST npm-self HTTP job did not finish');
      };
      await request(app.getHttpServer())
        .post(`${base}/versions`)
        .send({ requestId: uuid(++serial), manager: 'npm', package: 'npm' })
        .expect(202);
      expect((await waitDone()).versions?.versions).toEqual([
        '11.17.0',
        '12.2.2',
      ]);
      await request(app.getHttpServer())
        .post(`${base}/preview`)
        .send({
          requestId: uuid(++serial),
          manager: 'npm',
          package: 'npm',
          action,
          ...(action === 'change' ? { targetVersion: 'latest' } : {}),
        })
        .expect(202);
      const previewJob = await waitDone();
      expect(previewJob.status).toBe('completed');
      const preview = previewJob.preview!;
      const bad = await request(app.getHttpServer())
        .post(`${base}/execute`)
        .send({ ...consent(preview), confirmText: 'TEST wrong confirmation' })
        .expect(400);
      assertError(bad, 400, 'VALIDATION_ERROR');
      expect(appendFile).not.toHaveBeenCalled();
      await request(app.getHttpServer())
        .post(`${base}/execute`)
        .send(consent(preview))
        .expect(202);
      if (action !== 'repair') {
        if (action === 'change') npm.present();
        else npm.absent();
        npm.child.exit();
      }
      expect(await waitDone()).toMatchObject({
        status: 'completed',
        gateHeld: false,
        refreshRequired: false,
        mutationSpawned: action !== 'repair',
        mayHaveChanged: true,
      });
      if (action === 'repair') {
        expect(npm.child.launch).not.toHaveBeenCalled();
        expect(npm.rm.mock.calls.map(([path]) => path)).toEqual(
          preview.npm!.repairTargets,
        );
      } else expect(npm.child.launch).toHaveBeenCalledTimes(1);
      expect(npm.probe).not.toHaveBeenCalled();
      expect(appendFile).toHaveBeenCalledTimes(2);
    },
  );
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

  it('runs Yarn Classic HTTP workflow with sharedPackages, preview -> consent -> execute and neighbor postcondition', async () => {
    const globalDotBin = `${Y.root}\\.bin`;
    const semverTarget = `${Y.root}\\semver\\bin\\semver.js`;
    const writeYarnFs = (sv: string) => {
      f.fs.put(Y.global, { directory: true });
      f.fs.put(Y.root, { directory: true });
      f.fs.put(Y.bin, { directory: true });
      f.fs.put(globalDotBin, { directory: true });
      f.fs.put(`${Y.global}\\package.json`, {
        text: JSON.stringify({
          dependencies: { semver: sv, 'is-odd': '3.0.0' },
        }),
      });
      f.fs.put(`${Y.global}\\yarn.lock`, {
        text: [
          'is-odd@3.0.0:',
          '  version "3.0.0"',
          '  resolved "https://registry.yarnpkg.com/is-odd/-/is-odd-3.0.0.tgz#bbbb"',
          '  integrity sha512-odd==',
          '',
          `semver@${sv}:`,
          `  version "${sv}"`,
          `  resolved "https://registry.yarnpkg.com/semver/-/semver-${sv}.tgz#aaaa"`,
          `  integrity sha512-sv${sv}==`,
        ].join('\n'),
      });
      f.fs.put(`${Y.root}\\is-odd\\package.json`, {
        text: JSON.stringify({ name: 'is-odd', version: '3.0.0' }),
      });
      f.fs.put(`${Y.root}\\semver\\package.json`, {
        text: JSON.stringify({
          name: 'semver',
          version: sv,
          bin: { semver: 'bin/semver.js' },
        }),
      });
      f.fs.put(semverTarget, { text: `// semver ${sv}` });
      const l = yarnLocalBinShims(globalDotBin, 'semver', semverTarget);
      const g = yarnGlobalBinShims(Y.bin, globalDotBin, 'semver');
      f.fs.put(l.cmdPath, { text: l.cmdText });
      f.fs.put(l.shPath, { text: l.shText });
      f.fs.put(g.cmdPath, { text: g.cmdText });
      f.fs.put(g.shPath, { text: g.shText });
    };
    writeYarnFs('7.7.1');
    const loc = yarnLocation(yarnConfigFacts(), '1.22.22');
    jest
      // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.fn mock
      .mocked(f.runtime.resolveTool)
      .mockImplementation((manager) =>
        Promise.resolve(manager === 'yarn' ? loc.tool : testTool(manager)),
      );
    jest
      .spyOn(locationAdapter, 'discoverGlobalLocation')
      .mockImplementation((manager) =>
        manager === 'yarn'
          ? Promise.resolve(loc)
          : Promise.reject(
              new AppException(409, 'TEST unavailable', 'CONFLICT', {
                reason: 'TOOL_NOT_FOUND',
              }),
            ),
      );
    jest.spyOn(GlobalRegistry.prototype, 'getVersions').mockResolvedValue({
      manager: 'yarn',
      package: 'semver',
      versions: ['7.7.1', '7.7.2'],
      deprecatedVersions: [],
      tags: { latest: '7.7.2' },
    });
    jest.spyOn(GlobalRegistry.prototype, 'getTarget').mockResolvedValue({
      name: 'semver',
      version: '7.7.2',
      requestedVersion: '7.7.2',
      manifestHash: 'TEST',
      integrity: 'TEST',
      bins: [{ name: 'semver', target: 'bin/semver.js' }],
      engines: null,
      deprecated: false,
    });
    const app = await open();
    const waitDone = async () => {
      for (let i = 0; i < 100; i++) {
        await new Promise<void>((r) => setImmediate(r));
        const job = await latest(app);
        if (job?.phase === 'done') return job;
      }
      throw new Error('TEST yarn HTTP job did not finish');
    };
    await request(app.getHttpServer())
      .post(`${base}/inventory`)
      .send({ requestId: uuid(++serial) })
      .expect(202);
    expect((await waitDone()).status).toBe('completed');
    const snap = await snapshot(app);
    expect(snap?.managers.find((m) => m.manager === 'yarn')).toMatchObject({
      manager: 'yarn',
      available: true,
      version: '1.22.22',
    });

    await request(app.getHttpServer())
      .post(`${base}/preview`)
      .send({
        requestId: uuid(++serial),
        manager: 'yarn',
        package: 'semver',
        action: 'change',
        targetVersion: '7.7.2',
      })
      .expect(202);
    const prevJob = await waitDone();
    expect(prevJob.status).toBe('completed');
    expect(prevJob.preview?.sharedPackages).toEqual([
      { name: 'is-odd', version: '3.0.0', linked: false },
    ]);
    expect(prevJob.preview?.warningCodes).toContain(
      'YARN_SHARED_GLOBAL_PROJECT',
    );

    await request(app.getHttpServer())
      .post(`${base}/execute`)
      .send(consent(prevJob.preview!))
      .expect(202);
    for (let i = 0; i < 100 && f.child.launch.mock.calls.length === 0; i++) {
      await new Promise<void>((r) => setImmediate(r));
    }
    expect(f.child.launch).toHaveBeenCalledTimes(1);
    writeYarnFs('7.7.2');
    f.child.exit();
    expect(await waitDone()).toMatchObject({
      status: 'completed',
      gateHeld: false,
    });
  });

  it('keeps per-process neutral temp cwd identity stable across preview -> execute in Tier 2 co-located layout', async () => {
    const repo = 'D:\\TEST\\source';
    const dataDir = `${repo}\\PkgStewardLog`;
    const cacheDir = `${dataDir}\\cache`;
    const tempBase = 'D:\\TEST\\SystemTemp';
    const expectedCwd = `${tempBase}\\pkgsteward-global-cwd-${String(process.pid)}`;
    f.runtime.paths = {
      cacheDir,
      appInstallDir: `${repo}\\apps\\api`,
      sourceCheckoutDir: repo,
      appRootDir: repo,
      portableBaseDir: null,
      dataDir,
    };
    f.runtime.environment = {
      ...f.runtime.environment,
      TEMP: tempBase,
    };
    for (const d of [repo, dataDir, cacheDir, tempBase, expectedCwd]) {
      f.fs.put(d, { directory: true });
    }
    f.fs.put(`${repo}\\package.json`, { text: '{"name":"pkgsteward"}' });
    f.fs.put(TEST_PATHS.userconfig, { text: '' });
    f.fs.put(TEST_PATHS.globalconfig, { text: '' });

    const app = await open();
    const waitDone = async () => {
      for (let i = 0; i < 100; i++) {
        await new Promise<void>((r) => setImmediate(r));
        const job = await latest(app);
        if (job?.phase === 'done') return job;
      }
      throw new Error('TEST Tier 2 HTTP job did not finish');
    };

    await request(app.getHttpServer())
      .post(`${base}/preview`)
      .send({
        requestId: uuid(++serial),
        manager: 'npm',
        package: 'test-tool',
        action: 'remove',
      })
      .expect(202);
    const prevJob = await waitDone();
    expect(prevJob.status).toBe('completed');
    expect(prevJob.preview).toBeDefined();

    await request(app.getHttpServer())
      .post(`${base}/execute`)
      .send(consent(prevJob.preview!))
      .expect(202);
    for (let i = 0; i < 100 && f.child.launch.mock.calls.length === 0; i++) {
      await new Promise<void>((r) => setImmediate(r));
    }
    expect(f.child.launch).toHaveBeenCalledTimes(1);
    expect(f.child.launch.mock.calls[0][0].cwd).toBe(expectedCwd);
    await f.removeAndExit();
    expect(await waitDone()).toMatchObject({
      status: 'completed',
      gateHeld: false,
    });
  });
});
