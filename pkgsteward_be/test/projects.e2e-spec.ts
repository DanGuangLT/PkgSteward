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
import { execa } from 'execa';
import * as nativeFs from 'node:fs/promises';
import * as nativeStreams from 'node:fs';
import type { Server } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import request from 'supertest';
import { AppException } from '@/common/exceptions/app.exception';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import { LoggingInterceptor } from '@/common/interceptors/logging.interceptor';
import { TransformInterceptor } from '@/common/interceptors/transform.interceptor';
import type { IApiResponse } from '@/common/interceptors/transform.interceptor';
import { MutationGateService } from '@/core/mutation-gate/mutation-gate.service';
import { PathGuardService } from '@/core/path-guard/path-guard.service';
import { THROTTLER_NAMES } from '@/core/throttler-config.module';
import { DiskUsageService } from '@/disk-usage/disk-usage.service';
import { ScannerCache } from '@/scanner/scanner-cache';
import { ScannerService } from '@/scanner/scanner.service';
import type {
  IAnalysisResult,
  IProjectAnalysisJob,
  IProjectAnalysisStart,
  IProjectDetail,
  IProjectFs,
  ProjectScanSnapshot,
} from '@/projects/interfaces/projects.types';
import type {
  IProjectRegistry,
  IProjectsRuntime,
  ProjectAnalyzer,
} from '@/projects/interfaces/projects.runtime';
import {
  PROJECT_ANALYZER,
  PROJECT_REGISTRY,
  ProjectsModule,
} from '@/projects/projects.module';
import { PROJECT_FS, PROJECT_RUNTIME } from '@/projects/projects.service';

jest.mock('execa', () => ({ execa: jest.fn() }));
jest.mock('node:fs/promises', () => {
  const blocked = () =>
    jest.fn(() => {
      throw new Error('Native filesystem IO is disabled in Projects e2e');
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
    appendFile: blocked(),
    mkdir: blocked(),
    rm: blocked(),
    unlink: blocked(),
    rename: blocked(),
    copyFile: blocked(),
    readlink: blocked(),
  };
});
jest.mock('node:fs', () => {
  const blocked = () =>
    jest.fn(() => {
      throw new Error('Native filesystem IO is disabled in Projects e2e');
    });
  const actual = jest.requireActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    constants: actual.constants,
    promises: jest.requireMock<unknown>('node:fs/promises'),
    access: blocked(),
    stat: blocked(),
    lstat: blocked(),
    realpath: blocked(),
    readdir: blocked(),
    readFile: blocked(),
    open: blocked(),
    writeFile: blocked(),
    appendFile: blocked(),
    mkdir: blocked(),
    rm: blocked(),
    unlink: blocked(),
    rename: blocked(),
    copyFile: blocked(),
    createReadStream: blocked(),
    createWriteStream: blocked(),
    readFileSync: blocked(),
    writeFileSync: blocked(),
    existsSync: blocked(),
    statSync: blocked(),
    lstatSync: blocked(),
    realpathSync: blocked(),
    mkdirSync: blocked(),
    rmSync: blocked(),
  };
});

// Export only the existing global dependencies. Scanner/DiskUsage services are
// replaced before Nest creates them; their production modules remain imported.
@Global()
@Module({
  providers: [
    { provide: ConfigService, useValue: {} },
    { provide: PathGuardService, useValue: {} },
    { provide: MutationGateService, useValue: {} },
  ],
  exports: [ConfigService, PathGuardService, MutationGateService],
})
class ProjectTestAdaptersModule {}

const jobId = 'e4261d1d-590f-48a4-a765-d6dedcff17e4';
const timestamp = '2026-11-02T12:30:00.000Z';
const origin = 'https://registry.npmjs.org';
const bulkPath = '/-/npm/v1/security/advisories/bulk';
type FsMock<K extends keyof IProjectFs> = jest.Mock<
  ReturnType<IProjectFs[K]>,
  Parameters<IProjectFs[K]>
>;
const urlOf = (input: Parameters<typeof fetch>[0]): string =>
  input instanceof Request ? input.url : input.toString();
const root = resolve('/pkgsteward-project-test/demo');
const other = resolve('/pkgsteward-project-test/other');
const unscanned = resolve('/pkgsteward-project-test/unscanned');
const manifestPath = join(root, 'package.json');

const completeResult = (): IAnalysisResult => ({
  outdated: {
    state: 'complete',
    items: [],
    warningCodes: [],
    failureCode: null,
    checkedCount: 0,
    totalCount: 0,
  },
  audit: {
    state: 'complete',
    items: [],
    warningCodes: [],
    failureCode: null,
    checkedCount: 0,
    totalCount: 0,
  },
  partial: false,
  warningCodes: [],
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('Projects HTTP flow (mocked IO, real Nest pipeline)', () => {
  let apps: INestApplication<Server>[];
  let files: Map<string, string>;
  let directories: Set<string>;
  let scan: ProjectScanSnapshot;
  let fs: {
    lstat: FsMock<'lstat'>;
    realpath: FsMock<'realpath'>;
    readChunks: FsMock<'readChunks'>;
  };
  let noScan: boolean;
  let busy: boolean;
  let timeoutMs: number | undefined;
  let getLatest: jest.Mock<ProjectScanSnapshot | undefined, []>;
  let assertIdle: jest.Mock<void, []>;
  let assertAllowed: jest.Mock<Promise<{ realPath: string }>, [string]>;
  let peekCompletedSize: jest.Mock<IProjectDetail['diskUsage'], [string]>;
  let fetchMock: jest.Mock<ReturnType<typeof fetch>, Parameters<typeof fetch>>;
  let debug: jest.SpyInstance;
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;
  let warn: jest.SpyInstance;

  const addProject = (path: string, withLock = true) => {
    directories.add(path);
    directories.add(join(path, 'node_modules'));
    files.set(
      join(path, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        version: '1.0.0',
        packageManager: 'npm@11.0.0',
        dependencies: { demo: '^1.0.0' },
        scripts: {
          postinstall: 'node ./hostile.js',
          inspect: 'echo never execute',
        },
      }),
    );
    if (withLock)
      files.set(
        join(path, 'package-lock.json'),
        JSON.stringify({
          lockfileVersion: 3,
          packages: {
            '': { dependencies: { demo: '^1.0.0' } },
            'node_modules/demo': {
              version: '1.0.0',
              resolved: `${origin}/demo/-/demo-1.0.0.tgz`,
            },
            // Every registry lock entry is in audit scope, even without a root declaration.
            'node_modules/unused': {
              version: '1.0.0',
              resolved: `${origin}/unused/-/unused-1.0.0.tgz`,
            },
          },
        }),
      );
  };

  beforeEach(() => {
    apps = [];
    files = new Map();
    directories = new Set();
    addProject(root);
    addProject(other);
    addProject(unscanned);
    scan = {
      scanId: jobId,
      projects: [root, other].map(
        (path) => ({ path }) as ProjectScanSnapshot['projects'][number],
      ),
    };
    noScan = false;
    busy = false;
    timeoutMs = undefined;
    getLatest = jest.fn(() => {
      if (noScan) return undefined;
      return structuredClone(scan);
    });
    assertIdle = jest.fn(() => {
      if (busy)
        throw new AppException(409, 'Mutation in progress', 'CONFLICT', {
          reason: 'MUTATION_RUNNING',
        });
    });
    assertAllowed = jest.fn((path: string) => {
      const absolute = resolve(path);
      if (
        dirname(absolute) !== dirname(root) &&
        !absolute.startsWith(`${root}\\`) &&
        !absolute.startsWith(`${root}/`) &&
        !absolute.startsWith(`${other}\\`) &&
        !absolute.startsWith(`${other}/`) &&
        !absolute.startsWith(`${unscanned}\\`) &&
        !absolute.startsWith(`${unscanned}/`)
      ) {
        return Promise.reject(
          new AppException(403, 'Forbidden path', 'FORBIDDEN'),
        );
      }
      if (!directories.has(absolute) && !files.has(absolute)) {
        return Promise.reject(
          new AppException(404, 'Missing path', 'NOT_FOUND'),
        );
      }
      return Promise.resolve({ realPath: absolute });
    });
    peekCompletedSize = jest.fn(() => ({
      sizeBytes: 0,
      measuredAt: timestamp,
    }));
    fs = {
      lstat: jest.fn((path: string) => {
        const absolute = resolve(path);
        if (!files.has(absolute) && !directories.has(absolute)) {
          return Promise.reject(
            Object.assign(new Error('missing'), { code: 'ENOENT' }),
          );
        }
        return Promise.resolve({
          size: Buffer.byteLength(files.get(absolute) ?? ''),
          mtimeMs: 1,
          ctimeMs: 1,
          ino: 2,
          dev: 1,
          isFile: () => files.has(absolute),
          isDirectory: () => directories.has(absolute),
          isSymbolicLink: () => false,
        });
      }),
      realpath: jest.fn((path: string) => Promise.resolve(resolve(path))),
      readChunks: jest.fn(async function* (path: string, signal: AbortSignal) {
        signal.throwIfAborted();
        const text = files.get(resolve(path));
        if (text === undefined)
          throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        yield await Promise.resolve(Buffer.from(text));
        signal.throwIfAborted();
      }),
    };
    fetchMock = jest.fn(
      (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = new URL(urlOf(input));
        expect(url.origin).toBe(origin);
        expect(init?.redirect).toBe('error');
        const headers = new Headers(init?.headers);
        expect(headers.has('authorization')).toBe(false);
        expect(headers.has('cookie')).toBe(false);
        if (url.pathname === bulkPath) {
          expect(init?.method).toBe('POST');
          return Promise.resolve(
            Response.json({
              demo: [
                {
                  id: 42,
                  title: 'Known fixture advisory',
                  severity: 'high',
                  vulnerable_versions: '<2.0.0',
                  url: 'https://github.com/advisories/GHSA-fixture',
                },
              ],
            }),
          );
        }
        expect(decodeURIComponent(url.pathname)).toBe('/demo');
        return Promise.resolve(
          Response.json({
            name: 'demo',
            'dist-tags': { latest: '2.0.0' },
            versions: {
              '1.0.0': { name: 'demo', version: '1.0.0' },
              '2.0.0': { name: 'demo', version: '2.0.0' },
            },
          }),
        );
      },
    );
    jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);
    debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.mocked(execa).mockClear();
    for (const module of [nativeFs, nativeStreams]) {
      for (const operation of Object.values(module)) {
        if (jest.isMockFunction(operation)) operation.mockClear();
      }
    }
  });

  afterEach(async () => {
    try {
      for (const app of [...apps].reverse()) await app.close();
      expect(execa).not.toHaveBeenCalled();
      for (const [input, init] of fetchMock.mock.calls) {
        expect(new URL(urlOf(input)).origin).toBe(origin);
        expect(init?.redirect).toBe('error');
        const headers = new Headers(init?.headers);
        expect(headers.has('authorization')).toBe(false);
        expect(headers.has('cookie')).toBe(false);
      }
      // The only filesystem surface injected into Projects has read operations.
      expect(Object.keys(fs).sort()).toEqual([
        'lstat',
        'readChunks',
        'realpath',
      ]);
      for (const module of [nativeFs, nativeStreams]) {
        for (const operation of Object.values(module)) {
          if (jest.isMockFunction(operation))
            expect(operation).not.toHaveBeenCalled();
        }
      }
    } finally {
      jest.restoreAllMocks();
    }
  });

  const openApp = async (
    analyze?: ProjectAnalyzer,
    registry?: IProjectRegistry,
  ) => {
    const builder = Test.createTestingModule({
      imports: [
        ProjectTestAdaptersModule,
        ThrottlerModule.forRoot(
          THROTTLER_NAMES.map((name) => ({
            name,
            ttl: 60000,
            limit: name === 'short-term' ? 20 : 21,
          })),
        ),
        ProjectsModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
        { provide: APP_INTERCEPTOR, useClass: ClassSerializerInterceptor },
        { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService({ NPM_COMMAND_TIMEOUT_MS: timeoutMs }))
      .overrideProvider(PathGuardService)
      .useValue({ assertAllowed })
      .overrideProvider(MutationGateService)
      .useValue({ assertIdle })
      .overrideProvider(ScannerCache)
      .useValue({})
      .overrideProvider(ScannerService)
      .useValue({ getLatest })
      .overrideProvider(DiskUsageService)
      .useValue({ peekCompletedSize })
      .overrideProvider(PROJECT_FS)
      .useValue(fs);
    if (analyze) builder.overrideProvider(PROJECT_ANALYZER).useValue(analyze);
    if (registry) builder.overrideProvider(PROJECT_REGISTRY).useValue(registry);
    const module = await builder.compile();
    const app = module.createNestApplication<INestApplication<Server>>();
    apps.push(app);
    app.setGlobalPrefix('api/v1');
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
    expect(app.get<IProjectsRuntime>(PROJECT_RUNTIME).registry).toBe(
      app.get<unknown>(PROJECT_REGISTRY),
    );
    return app;
  };

  const start = async (app: INestApplication<Server>, path = root) => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/projects/analyses')
      .send({ path })
      .expect(202);
    const body = response.body as IApiResponse<IProjectAnalysisStart>;
    expect(body.statusCode).toBe(202);
    expect(body.code).toBe('SUCCESS');
    expect(body.timestamp).toEqual(expect.any(String));
    expect(body.path).toBe('/api/v1/projects/analyses');
    expect(body.data?.jobId).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i,
    );
    return body.data!;
  };
  const get = async (app: INestApplication<Server>, id: string) => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/projects/analyses/${id}`)
      .expect(200);
    const body = response.body as IApiResponse<IProjectAnalysisJob>;
    expect(response.headers['cache-control']).toBe('no-store');
    expect(body.code).toBe('SUCCESS');
    expect(body.data?.jobId).toBe(id);
    return body.data!;
  };
  const poll = async (app: INestApplication<Server>, id: string) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const snapshot = await get(app, id);
      if (snapshot.status !== 'running') return snapshot;
      await delay(10);
    }
    throw new Error('Analysis did not finish');
  };
  const heldAnalyzer: ProjectAnalyzer = (_input, signal) =>
    new Promise((done) => {
      const finish = () => done(completeResult());
      if (signal.aborted) finish();
      else signal.addEventListener('abort', finish, { once: true });
    });

  it('reads local detail without HTTP/processes, then analyzes every public lock entry with one shared transport', async () => {
    const app = await openApp();
    const response = await request(app.getHttpServer())
      .get('/api/v1/projects')
      .query({ path: root })
      .expect(200);
    const body = response.body as IApiResponse<IProjectDetail>;
    expect(response.headers['cache-control']).toBe('no-store');
    expect(body.code).toBe('SUCCESS');
    expect(
      body.data?.scripts.find((script) => script.name === 'inspect')?.command,
    ).toBe('echo never execute');
    expect(body.data?.diskUsage).toEqual({
      sizeBytes: 0,
      measuredAt: timestamp,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(assertIdle).not.toHaveBeenCalled();
    const started = await start(app);
    const completed = await poll(app, started.jobId);
    expect(completed.status).toBe('completed');
    expect(completed.partial).toBe(false);
    expect(completed.stale).toBe(false);
    expect(completed.checkedAt).toEqual(expect.any(String));
    expect(completed.outdated.state).toBe('complete');
    expect(completed.outdated.items[0]).toMatchObject({
      name: 'demo',
      lockedVersions: ['1.0.0'],
      latest: '2.0.0',
      behindLatest: true,
    });
    expect(completed.audit.items[0]).toMatchObject({
      id: '42',
      name: 'demo',
      direct: true,
      severity: 'high',
    });
    const audit = fetchMock.mock.calls.find(([url]) =>
      urlOf(url).endsWith(bulkPath),
    );
    expect(JSON.parse(audit?.[1]?.body as string)).toEqual({
      demo: ['1.0.0'],
      unused: ['1.0.0'],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(assertIdle).toHaveBeenCalledTimes(1);
  });

  it('coalesces starts, exposes only the lexical running target in conflicts, cancels idempotently', async () => {
    const app = await openApp(heldAnalyzer);
    const first = await start(app);
    expect(await start(app)).toEqual(first);
    const response = await request(app.getHttpServer())
      .post('/api/v1/projects/analyses')
      .send({ path: other })
      .expect(409);
    expect(response.body).toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'ANALYSIS_RUNNING', jobId: first.jobId, path: root },
    });
    const cancel = () =>
      request(app.getHttpServer())
        .post(`/api/v1/projects/analyses/${first.jobId}/cancel`)
        .expect(200);
    const cancelled = (await cancel())
      .body as IApiResponse<IProjectAnalysisJob>;
    expect(cancelled.data).toMatchObject({
      status: 'cancelled',
      partial: true,
      failureCode: 'CANCELLED',
    });
    expect(
      ((await cancel()).body as IApiResponse<IProjectAnalysisJob>).data,
    ).toEqual(cancelled.data);
    expect(await get(app, first.jobId)).toEqual(cancelled.data);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('builds the runtime from the replaceable singleton registry provider', async () => {
    const getPackageMetadata = jest.fn(() =>
      Promise.resolve({ versions: ['1.0.0'], distTags: { latest: '1.0.0' } }),
    );
    const getBulkAdvisories = jest.fn(() => Promise.resolve({}));
    const registry: IProjectRegistry = {
      getPackageMetadata,
      getBulkAdvisories,
    };
    const app = await openApp(undefined, registry);
    const started = await start(app);
    const result = await poll(app, started.jobId);
    expect(result.status).toBe('completed');
    expect(result.partial).toBe(false);
    expect(getPackageMetadata).toHaveBeenCalledTimes(1);
    expect(getBulkAdvisories).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses a fake analyzer override and performs no guard/fs/scan/gate/disk IO during repeated polls', async () => {
    const app = await openApp(heldAnalyzer);
    const started = await start(app);
    jest.clearAllMocks();
    for (let index = 0; index < 24; index++)
      expect((await get(app, started.jobId)).status).toBe('running');
    expect(fs.lstat).not.toHaveBeenCalled();
    expect(fs.realpath).not.toHaveBeenCalled();
    expect(fs.readChunks).not.toHaveBeenCalled();
    expect(getLatest).not.toHaveBeenCalled();
    expect(assertIdle).not.toHaveBeenCalled();
    expect(assertAllowed).not.toHaveBeenCalled();
    expect(peekCompletedSize).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining(`GET /api/v1/projects/analyses/${started.jobId}`),
    );
    expect(log).not.toHaveBeenCalledWith(
      expect.stringContaining(`GET /api/v1/projects/analyses/${started.jobId}`),
    );
  });

  it.each(['start', 'cancel'] as const)(
    'keeps named throttles on %s',
    async (operation) => {
      const app = await openApp(heldAnalyzer);
      const started = await start(app);
      for (let index = 0; index < 24; index++) {
        const response =
          operation === 'start'
            ? await request(app.getHttpServer())
                .post('/api/v1/projects/analyses')
                .send({ path: root })
            : await request(app.getHttpServer()).post(
                `/api/v1/projects/analyses/${started.jobId}/cancel`,
              );
        if (response.status === 429) {
          expect(response.body).toMatchObject({
            statusCode: 429,
            code: 'RATE_LIMITED',
          });
          return;
        }
        expect(response.status).toBe(operation === 'start' ? 202 : 200);
      }
      throw new Error(`${operation} must retain throttles`);
    },
  );

  it('allows detail while mutation is busy and rejects start without advertising a followable analysis', async () => {
    busy = true;
    const app = await openApp(heldAnalyzer);
    await request(app.getHttpServer())
      .get('/api/v1/projects')
      .query({ path: root })
      .expect(200);
    expect(assertIdle).not.toHaveBeenCalled();
    const response = await request(app.getHttpServer())
      .post('/api/v1/projects/analyses')
      .send({ path: root })
      .expect(409);
    const body = response.body as {
      code: string;
      details: Record<string, unknown>;
    };
    expect(body.code).toBe('CONFLICT');
    expect(body.details.reason).toBe('MUTATION_RUNNING');
    expect(body.details.jobId).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed bodies and duplicate queries before input reads', async () => {
    const app = await openApp(heldAnalyzer);
    for (const input of [
      {},
      { path: '' },
      { path: 1 },
      { path: false },
      { path: null },
      { path: [root, other] },
      { path: '../relative' },
      { path: `${root}/../demo` },
      { path: `${root}\0bad` },
      { path: `/${'x'.repeat(32768)}` },
      { path: root, extra: true },
    ]) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/projects/analyses')
        .send(input)
        .expect(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    for (const query of [
      {},
      { path: '' },
      { path: '../relative' },
      { path: root, extra: 'yes' },
      { path: [root, other] },
    ]) {
      const response = await request(app.getHttpServer())
        .get('/api/v1/projects')
        .query(query)
        .expect(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(fs.readChunks).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['detail', 'start'] as const)(
    'returns 404 before any scan for %s, with no raw 500',
    async (operation) => {
      noScan = true;
      const app = await openApp();
      const response =
        operation === 'detail'
          ? await request(app.getHttpServer())
              .get('/api/v1/projects')
              .query({ path: root })
              .expect(404)
          : await request(app.getHttpServer())
              .post('/api/v1/projects/analyses')
              .send({ path: root })
              .expect(404);
      expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
      if (operation === 'detail')
        expect(response.headers['cache-control']).toBe('no-store');
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('returns no-store on detail guard, membership, missing manifest and invalid manifest errors', async () => {
    const app = await openApp();
    for (const [path, status, code] of [
      [resolve('/outside/demo'), 403, 'FORBIDDEN'],
      [join(dirname(root), 'missing'), 404, 'NOT_FOUND'],
      [unscanned, 409, 'CONFLICT'],
    ] as const) {
      const response = await request(app.getHttpServer())
        .get('/api/v1/projects')
        .query({ path })
        .expect(status);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toMatchObject({ code });
      if (status === 409)
        expect(response.body).toMatchObject({
          details: { reason: 'PROJECT_NOT_SCANNED' },
        });
    }
    files.delete(manifestPath);
    const missing = await request(app.getHttpServer())
      .get('/api/v1/projects')
      .query({ path: root })
      .expect(404);
    expect(missing.headers['cache-control']).toBe('no-store');
    files.set(manifestPath, '{bad json');
    const invalid = await request(app.getHttpServer())
      .get('/api/v1/projects')
      .query({ path: root })
      .expect(400);
    expect(invalid.headers['cache-control']).toBe('no-store');
    expect(invalid.body).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('applies no-store even when GET detail is rejected by the global rate guard', async () => {
    const app = await openApp();
    for (let index = 0; index < 24; index++) {
      const response = await request(app.getHttpServer())
        .get('/api/v1/projects')
        .query({ path: root });
      expect(response.headers['cache-control']).toBe('no-store');
      if (response.status === 429) {
        expect(response.body).toMatchObject({ code: 'RATE_LIMITED' });
        return;
      }
      expect(response.status).toBe(200);
    }
    throw new Error('Detail must retain the global rate limit');
  });

  it('validates UUID v4 on poll and cancel and returns 404 for an unknown retained job', async () => {
    const app = await openApp();
    for (const method of ['get', 'post'] as const) {
      const suffix = method === 'post' ? '/cancel' : '';
      for (const id of ['invalid', jobId.replace('48a4', '18a4')]) {
        const response = await request(app.getHttpServer())
          [method](`/api/v1/projects/analyses/${id}${suffix}`)
          .expect(400);
        expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
      }
      const missing = await request(app.getHttpServer())
        [method](`/api/v1/projects/analyses/${jobId}${suffix}`)
        .expect(404);
      expect(missing.body).toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  it('keeps outdated results with explicitly unavailable audit when no lock is present', async () => {
    files.delete(join(root, 'package-lock.json'));
    const app = await openApp();
    const started = await start(app);
    const result = await poll(app, started.jobId);
    expect(result.status).toBe('completed');
    expect(result.partial).toBe(true);
    expect(result.outdated.items[0]).toMatchObject({
      lockedVersions: [],
      latest: '2.0.0',
    });
    expect(result.audit.state).toBe('unavailable');
    expect(result.audit.failureCode).toBe('NO_LOCKFILE');
    expect(
      fetchMock.mock.calls.some(([url]) => urlOf(url).endsWith(bulkPath)),
    ).toBe(false);
  });

  it('reports offline sections as unavailable and normalizes upstream errors without leaking names or bodies', async () => {
    files.set(
      manifestPath,
      JSON.stringify({ dependencies: { 'secret-dependency-name': '^1.0.0' } }),
    );
    files.set(
      join(root, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { dependencies: { 'secret-dependency-name': '^1.0.0' } },
          'node_modules/secret-dependency-name': {
            version: '1.0.0',
            resolved: `${origin}/secret-dependency-name/-/secret-dependency-name-1.0.0.tgz`,
          },
        },
      }),
    );
    fetchMock.mockRejectedValue(
      new Error('SECRET upstream response; demo credential'),
    );
    const app = await openApp();
    const started = await start(app);
    const result = await poll(app, started.jobId);
    expect(result.status).toBe('completed');
    expect(result.partial).toBe(true);
    expect(result.warningCodes).toContain('REGISTRY_UNAVAILABLE');
    expect(result.audit.state).toBe('unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const logs = JSON.stringify([
      debug.mock.calls,
      log.mock.calls,
      warn.mock.calls,
      error.mock.calls,
    ]);
    expect(logs).not.toContain('SECRET');
    expect(logs).not.toContain('upstream response');
    expect(logs).not.toContain('credential');
    expect(logs).not.toContain('secret-dependency-name');
  });

  it('blocks online requests for registry config and returns no config text or secrets', async () => {
    files.set(join(root, '.npmrc'), '//host/:_authToken=SECRET_CONFIG');
    const app = await openApp();
    const response = await request(app.getHttpServer())
      .get('/api/v1/projects')
      .query({ path: root })
      .expect(200);
    expect(JSON.stringify(response.body)).not.toContain('SECRET_CONFIG');
    const started = await start(app);
    const result = await poll(app, started.jobId);
    expect(result.partial).toBe(true);
    expect(result.warningCodes).toContain('REGISTRY_CONFIG_UNSUPPORTED');
    expect(result.outdated.state).toBe('unavailable');
    expect(result.audit.state).toBe('unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves positive findings in a partial result', async () => {
    const analyze: ProjectAnalyzer = () =>
      Promise.resolve({
        ...completeResult(),
        partial: true,
        warningCodes: ['INVALID_REGISTRY_RESPONSE'],
        audit: {
          state: 'partial',
          items: [
            {
              id: '42',
              name: 'demo',
              title: 'Known finding',
              url: null,
              severity: 'high',
              range: '<2.0.0',
              affectedVersions: ['1.0.0'],
              direct: true,
            },
          ],
          checkedCount: 1,
          totalCount: 2,
          warningCodes: ['INVALID_REGISTRY_RESPONSE'],
          failureCode: 'INVALID_REGISTRY_RESPONSE',
        },
      });
    const app = await openApp(analyze);
    const started = await start(app);
    const result = await poll(app, started.jobId);
    expect(result.status).toBe('completed');
    expect(result.partial).toBe(true);
    expect(result.audit.state).toBe('partial');
    expect(result.audit.items[0].id).toBe('42');
  });

  it('detects changed inputs once at job end, then returns stable snapshots without further validation', async () => {
    const pending = deferred<IAnalysisResult>();
    const app = await openApp(() => pending.promise);
    const started = await start(app);
    files.set(
      manifestPath,
      JSON.stringify({ name: 'changed', dependencies: { demo: '^2.0.0' } }),
    );
    pending.resolve(completeResult());
    const result = await poll(app, started.jobId);
    expect(result.status).toBe('completed');
    expect(result.stale).toBe(true);
    expect(result.partial).toBe(true);
    expect(result.failureCode).toBe('INPUT_CHANGED');
    jest.clearAllMocks();
    files.delete(manifestPath);
    expect(await get(app, started.jobId)).toEqual(result);
    expect(await get(app, started.jobId)).toEqual(result);
    expect(fs.readChunks).not.toHaveBeenCalled();
    expect(assertAllowed).not.toHaveBeenCalled();
    expect(getLatest).not.toHaveBeenCalled();
    expect(assertIdle).not.toHaveBeenCalled();
  });

  it('honors a configured whole-job deadline', async () => {
    timeoutMs = 1000;
    const app = await openApp(heldAnalyzer);
    const started = await start(app);
    await delay(1050);
    const result = await get(app, started.jobId);
    expect(result.status).toBe('timed_out');
    expect(result.failureCode).toBe('TIMED_OUT');
    expect(result.partial).toBe(true);
  });
});
