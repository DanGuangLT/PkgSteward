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
import { win32 } from 'node:path';
import request from 'supertest';
import { execa } from 'execa';
import {
  AppException,
  ForbiddenException,
} from '@/common/exceptions/app.exception';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import { TransformInterceptor } from '@/common/interceptors/transform.interceptor';
import type { IApiResponse } from '@/common/interceptors/transform.interceptor';
import { createHostOriginMiddleware } from '@/common/middleware/host-origin.middleware';
import { AuditLogService } from '@/core/audit-log/audit-log.service';
import type { IAuditRecord } from '@/core/audit-log/interfaces/audit-log.types';
import { MutationGateService } from '@/core/mutation-gate/mutation-gate.service';
import { PathGuardService } from '@/core/path-guard/path-guard.service';
import { THROTTLER_NAMES } from '@/core/throttler-config.module';
import { DiskUsageService } from '@/disk-usage/disk-usage.service';
import { FileOpsService } from '@/file-ops/file-ops.service';
import { ProjectsService } from '@/projects/projects.service';
import { ScannerService } from '@/scanner/scanner.service';
import { ScannerCache } from '@/scanner/scanner-cache';
import { NPM_RUNNER_RUNTIME } from '@/npm-runner/interfaces/npm-runner.runtime';
import type { INpmRunnerRuntime } from '@/npm-runner/interfaces/npm-runner.runtime';
import type {
  IRunJob,
  IRunLogPage,
  IRunStart,
  IRunnerContext,
} from '@/npm-runner/interfaces/npm-runner.types';
import {
  createNpmRunnerRuntime,
  NpmRunnerModule,
} from '@/npm-runner/npm-runner.module';
import type { IRunnerRuntimeBindings } from '@/npm-runner/npm-runner.module';
import { NpmRunnerService } from '@/npm-runner/npm-runner.service';
import type {
  IRunProcessCallbacks,
  IRunProcessExit,
} from '@/npm-runner/runner-process';
import { resolveRunnerTool } from '@/npm-runner/runner-tool';
import {
  fsFixture,
  nodeFile,
  npmDir,
  root,
} from '@/npm-runner/__fixtures__/runner-test.fixture';

jest.mock('execa', () => ({ execa: jest.fn() }));
jest.mock('node:fs/promises', () => {
  const blocked = () =>
    jest.fn(() => {
      throw new Error('TEST native filesystem IO forbidden');
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

@Global()
@Module({
  providers: [
    { provide: ConfigService, useValue: new ConfigService() },
    { provide: PathGuardService, useValue: {} },
    { provide: AuditLogService, useValue: {} },
  ],
  exports: [ConfigService, PathGuardService, AuditLogService],
})
class RunnerTestAdaptersModule {}

// TEST only; không phải yêu cầu nghiệp vụ. No package manager or network is executed.
const id = '00000000-0000-4000-8000-000000000010';
const requestId = '00000000-0000-4000-8000-000000000020';
const tick = async () => {
  for (let turn = 0; turn < 200; turn++) await Promise.resolve();
};

function fixture() {
  const input = fsFixture();
  input.put(nodeFile, 'TEST executable, never executed');
  input.put(
    win32.join(npmDir, 'package.json'),
    JSON.stringify({
      name: 'npm',
      version: '11.17.0',
      bin: { npm: 'bin/npm-cli.js' },
    }),
  );
  input.put(win32.join(npmDir, 'bin', 'npm-cli.js'), '// TEST inert entry');
  input.deps.resolveTool = (manager) =>
    resolveRunnerTool(manager, input.snapshot, input.fs);
  const gate = new MutationGateService();
  let callbacks: IRunProcessCallbacks | undefined;
  let complete!: (exit: IRunProcessExit) => void;
  const settled = new Promise<IRunProcessExit>((resolve) => {
    complete = resolve;
  });
  const finish = (overrides: Partial<IRunProcessExit> = {}) => {
    const exit: IRunProcessExit = {
      exitCode: 0,
      signal: null,
      failureCode: null,
      termination: 'verified',
      outputTruncated: false,
      ...overrides,
    };
    complete(exit);
    callbacks?.onExit(exit);
  };
  const stop = jest.fn(() => {
    finish({ exitCode: null, signal: 'SIGTERM' });
    return Promise.resolve('verified' as const);
  });
  const launch = jest.fn<
    ReturnType<INpmRunnerRuntime['launch']>,
    Parameters<INpmRunnerRuntime['launch']>
  >((_c, _e, listener) => {
    callbacks = listener;
    return { pid: 123, settled, stop };
  });
  let deadline: (() => void) | undefined;
  let clockOffsetMs = 0;
  const audit = jest.fn<Promise<void>, [IAuditRecord]>(() => Promise.resolve());
  const refreshProject = jest.fn<Promise<void>, [string]>(() =>
    Promise.resolve(),
  );
  const clearCache = jest.fn(() => undefined);
  const invalidateAfterMutation = jest.fn<void, [string]>(() => undefined);
  const runtime: INpmRunnerRuntime = {
    input: input.deps,
    env: { PATH: 'C:\\Windows\\System32', SystemRoot: 'C:\\Windows' },
    timeoutMs: undefined,
    processes: {
      capture: jest.fn(() => Promise.resolve({ status: 'unknown' as const })),
      descendants: jest.fn(() =>
        Promise.resolve({ status: 'unknown' as const }),
      ),
      stopTree: jest.fn(() => Promise.resolve('attempted' as const)),
      verifyGone: jest.fn(() => Promise.resolve('verified' as const)),
    },
    gate,
    readers: {
      hasRunningScan: () => false,
      hasRunningMeasurement: () => false,
      hasRunningPreview: () => false,
      hasRunningAnalysis: () => false,
    },
    audit: {
      writeIntent: () => Promise.resolve(),
      writeResult: () => Promise.resolve(),
    },
    invalidation: {
      refreshProject,
      clearDiskUsage: clearCache,
      staleAnalysis: invalidateAfterMutation,
    },
    launch,
    now: () => new Date(Date.now() + clockOffsetMs),
    uuid: () => id,
    setTimer: (callback, ms) => {
      deadline = callback;
      return setTimeout(callback, ms);
    },
    clearTimer: (timer) => clearTimeout(timer),
  };
  const output = (bytes: Buffer) => {
    if (!callbacks) throw new Error('TEST no fake child');
    callbacks.onOutput('stdout', bytes);
  };
  return {
    input,
    gate,
    runtime,
    launch,
    stop,
    finish,
    output,
    audit,
    refreshProject,
    clearCache,
    invalidateAfterMutation,
    fireDeadline: () => {
      if (!deadline) throw new Error('TEST no deadline');
      // The service rechecks elapsed time, so move the clock past any deadline first.
      clockOffsetMs += 1e9;
      deadline();
    },
  };
}

describe('NpmRunner HTTP flow (real Nest, mocked IO)', () => {
  let apps: INestApplication<Server>[];
  let f: ReturnType<typeof fixture>;
  beforeEach(() => {
    apps = [];
    f = fixture();
    jest.mocked(execa).mockClear();
    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() =>
        Promise.reject(new Error('TEST network forbidden')),
      );
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(async () => {
    try {
      for (const app of apps.reverse()) {
        // Lifecycle behavior has dedicated tests; avoid a deliberately held fake child at teardown.
        jest
          .spyOn(app.get(NpmRunnerService), 'onModuleDestroy')
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
        RunnerTestAdaptersModule,
        ThrottlerModule.forRoot(
          THROTTLER_NAMES.map((name) => ({ name, ttl: 60_000, limit })),
        ),
        NpmRunnerModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_INTERCEPTOR, useClass: ClassSerializerInterceptor },
        { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    })
      .overrideProvider(NPM_RUNNER_RUNTIME)
      .useValue(f.runtime)
      .overrideProvider(ScannerCache)
      .useValue({})
      .overrideProvider(ScannerService)
      .useValue({ getLatest: () => f.input.scan, hasRunningScan: () => false })
      .overrideProvider(DiskUsageService)
      .useValue({
        hasRunningMeasurement: () => false,
        peekCompletedSize: () => null,
      })
      .overrideProvider(FileOpsService)
      .useValue({ hasRunningPreview: () => false })
      .overrideProvider(ProjectsService)
      .useValue({ hasRunningAnalysis: () => false })
      .compile();
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
  const getContext = async (app: INestApplication<Server>) => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/npm-runs/context')
      .query({ path: root })
      .expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    return (response.body as IApiResponse<IRunnerContext>).data!;
  };
  const start = async (app: INestApplication<Server>, inputHash: string) => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/npm-runs')
      .send({ path: root, action: 'install_all', inputHash, requestId })
      .expect(202);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.body as IApiResponse<IRunStart>;
    expect(body.statusCode).toBe(202);
    expect(body.code).toBe('SUCCESS');
    expect(body.path).toBe('/api/v1/npm-runs');
    expect(body.timestamp).toEqual(expect.any(String));
    return body.data!;
  };
  const poll = async (app: INestApplication<Server>) => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/npm-runs/${id}`)
      .expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    return (response.body as IApiResponse<IRunJob>).data!;
  };

  it('context → accepted run → bounded logs → cancel → unchanged terminal cancel', async () => {
    const app = await open();
    const context = await getContext(app);
    expect(context.available).toBe(true);
    expect(f.launch).not.toHaveBeenCalled();
    expect(context).not.toHaveProperty('tool');
    expect(context).not.toHaveProperty('file');
    const accepted = await start(app, context.inputHash);
    expect(accepted.jobId).toBe(id);
    await tick();
    f.output(Buffer.from('TEST <script>alert(1)</script>\n'));
    await tick();
    const logs = await request(app.getHttpServer())
      .get(`/api/v1/npm-runs/${id}/logs`)
      .query({ cursor: 0 })
      .expect(200);
    const page = (logs.body as IApiResponse<IRunLogPage>).data!;
    expect(page.chunks[0].text).toContain('<script>');
    expect(page.nextCursor).toBe(1);
    expect(logs.headers['cache-control']).toBe('no-store');
    expect(await poll(app)).not.toHaveProperty('chunks');
    await request(app.getHttpServer())
      .post(`/api/v1/npm-runs/${id}/cancel`)
      .send({})
      .expect(202);
    await tick();
    expect(await poll(app)).toMatchObject({
      status: 'cancelled',
      gateHeld: false,
      mayHaveChanged: true,
    });
    await request(app.getHttpServer())
      .post(`/api/v1/npm-runs/${id}/cancel`)
      .send({})
      .expect(200);
    expect(f.launch).toHaveBeenCalledTimes(1);
    expect(f.stop).toHaveBeenCalledTimes(1);
    expect(f.refreshProject).toHaveBeenCalledTimes(1);
    expect(f.clearCache).toHaveBeenCalledTimes(1);
  });

  it('maps accepted preflight errors to a pollable job rather than an HTTP error', async () => {
    const app = await open();
    const context = await getContext(app);
    await start(
      app,
      context.inputHash.replace(/^./, context.inputHash[0] === 'a' ? 'b' : 'a'),
    );
    await tick();
    expect(await poll(app)).toMatchObject({
      status: 'failed',
      failureCode: 'INPUT_CHANGED',
      spawned: false,
    });
    expect(f.launch).not.toHaveBeenCalled();
  });

  it('registers latest before :id and keeps missing-job/validation errors no-store', async () => {
    const app = await open();
    for (const route of [
      'latest',
      id,
      `${id}/logs`,
      'bad-uuid',
      `${id}/logs?cursor=-1`,
      `${id}/logs?cursor=9007199254740992`,
    ]) {
      const response = await request(app.getHttpServer()).get(
        `/api/v1/npm-runs/${route}`,
      );
      expect(response.status).toBe(
        route.includes('bad-uuid') || route.includes('cursor=') ? 400 : 404,
      );
      expect(response.headers['cache-control']).toBe('no-store');
    }
    const cancel = await request(app.getHttpServer())
      .post(`/api/v1/npm-runs/${id}/cancel`)
      .send({})
      .expect(404);
    expect(cancel.headers['cache-control']).toBe('no-store');
  });

  it.each([
    { action: 'install_all', argv: ['--global'] },
    { action: 'install_all', package: 'alpha' },
    { action: 'install_one' },
    { action: 'script', script: 'dev', package: 'alpha' },
    { action: 'script', script: 'dev', env: { NODE_OPTIONS: '--inspect' } },
  ])(
    'rejects extra/mismatched DTO fields before reservation: %j',
    async (fields) => {
      const app = await open();
      const response = await request(app.getHttpServer())
        .post('/api/v1/npm-runs')
        .send({ path: root, requestId, inputHash: 'a'.repeat(64), ...fields })
        .expect(400);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(f.gate.isBusy()).toBe(false);
      expect(f.launch).not.toHaveBeenCalled();
    },
  );

  it('returns forbidden input errors and reader conflicts with reason details and no-store', async () => {
    const app = await open();
    f.input.deps.assertAllowed = () =>
      Promise.reject(new ForbiddenException('TEST denied'));
    const forbidden = await request(app.getHttpServer())
      .get('/api/v1/npm-runs/context')
      .query({ path: root })
      .expect(403);
    expect(forbidden.headers['cache-control']).toBe('no-store');
    f.runtime.readers.hasRunningPreview = () => true;
    const response = await request(app.getHttpServer())
      .post('/api/v1/npm-runs')
      .send({
        path: root,
        requestId,
        inputHash: 'a'.repeat(64),
        action: 'install_all',
      })
      .expect(409);
    const body = response.body as { code: string; details: { reason: string } };
    expect(body.code).toBe('CONFLICT');
    expect(body.details.reason).toBe('READERS_RUNNING');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(f.launch).not.toHaveBeenCalled();
  });

  it('throttles start/context/cancel while repeated polls remain available', async () => {
    const app = await open(2);
    const context = await getContext(app);
    await start(app, context.inputHash);
    await tick();
    for (let count = 0; count < 5; count++) {
      await request(app.getHttpServer())
        .get('/api/v1/npm-runs/latest')
        .expect(200);
      await request(app.getHttpServer())
        .get(`/api/v1/npm-runs/${id}`)
        .expect(200);
      await request(app.getHttpServer())
        .get(`/api/v1/npm-runs/${id}/logs`)
        .expect(200);
    }
    await start(app, context.inputHash);
    const limited = await request(app.getHttpServer())
      .post('/api/v1/npm-runs')
      .send({
        path: root,
        requestId,
        inputHash: context.inputHash,
        action: 'install_all',
      })
      .expect(429);
    expect(limited.headers['cache-control']).toBe('no-store');
    expect((limited.body as { code: string }).code).toBe('RATE_LIMITED');
    await getContext(app);
    await request(app.getHttpServer())
      .get('/api/v1/npm-runs/context')
      .query({ path: root })
      .expect(429);
    await request(app.getHttpServer())
      .post(`/api/v1/npm-runs/${id}/cancel`)
      .send({})
      .expect(202);
    await tick();
    await request(app.getHttpServer())
      .post(`/api/v1/npm-runs/${id}/cancel`)
      .send({})
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/npm-runs/${id}/cancel`)
      .send({})
      .expect(429);
  });

  it('preserves Host and Origin rejection before runner admission', async () => {
    const app = await open();
    await request(app.getHttpServer())
      .get('/api/v1/npm-runs/latest')
      .set('Host', 'evil.example:24681')
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/npm-runs')
      .set('Origin', 'https://evil.example')
      .send({
        path: root,
        requestId,
        inputHash: 'a'.repeat(64),
        action: 'install_all',
      })
      .expect(403);
    expect(f.launch).not.toHaveBeenCalled();
    expect(f.gate.isBusy()).toBe(false);
  });

  it('timeout is pollable and leaves no automatic restart or repeat execution', async () => {
    f.runtime.timeoutMs = 1000;
    const app = await open();
    const context = await getContext(app);
    await start(app, context.inputHash);
    await tick();
    f.fireDeadline();
    await tick();
    expect(await poll(app)).toMatchObject({
      status: 'timed_out',
      failureCode: 'TIMED_OUT',
      gateHeld: false,
    });
    expect(f.launch).toHaveBeenCalledTimes(1);
    expect(f.stop).toHaveBeenCalledTimes(1);
  });

  it('shutdown uses the same cleanup path and refuses later starts', async () => {
    const app = await open();
    const context = await getContext(app);
    await start(app, context.inputHash);
    await tick();
    const service = app.get(NpmRunnerService);
    await service.onModuleDestroy();
    await tick();
    expect(await poll(app)).toMatchObject({
      status: 'cancelled',
      failureCode: 'SHUTDOWN',
    });
    expect(f.launch).toHaveBeenCalledTimes(1);
    await request(app.getHttpServer())
      .post('/api/v1/npm-runs')
      .send({
        path: root,
        requestId,
        inputHash: context.inputHash,
        action: 'install_all',
      })
      .expect(503);
  });

  it('runtime factory binds roots, path guard, scan snapshot, predicates, audit and invalidators', async () => {
    const refresh = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
    const clear = jest.fn(() => undefined);
    const stale = jest.fn<void, [string]>(() => undefined);
    const assertAllowed = jest.fn((path: string) =>
      Promise.resolve({
        inputPath: path,
        resolvedPath: path,
        realPath: path,
        isSymbolicLink: false,
      }),
    );
    const config = new ConfigService({
      SCAN_ROOT_PATHS: '*',
      NPM_COMMAND_TIMEOUT_MS: '',
    });
    const env = { PATH: 'C:\\TEST\\tools', TEST_VALUE: 'before' };
    const bindings: IRunnerRuntimeBindings = {
      fs: f.input.fs,
      processes: f.runtime.processes,
      scanner: {
        getLatest: () => ({
          ...f.input.scan,
          status: 'completed',
          partial: false,
          roots: [root],
          maxDepth: 0,
          startedAt: '2026-11-03T03:00:00.000Z',
          finishedAt: '2026-11-03T03:00:00.000Z',
          skippedCount: 0,
          orphanNodeModules: [],
        }),
        hasRunningScan: () => true,
        refreshProject: refresh,
      },
      disk: { hasRunningMeasurement: () => true, clearCache: clear },
      fileOps: { hasRunningPreview: () => true },
      projects: {
        hasRunningAnalysis: () => true,
        invalidateAfterMutation: stale,
      },
      gate: f.gate,
      audit: { append: f.audit },
      guard: { assertAllowed },
      config,
      host: { platform: 'win32', execPath: nodeFile, env },
    };
    const runtime = createNpmRunnerRuntime(bindings);
    env.TEST_VALUE = 'after';
    expect(runtime.env.TEST_VALUE).toBe('before');
    expect(runtime.timeoutMs).toBeUndefined();
    expect(runtime.input.scanRoots).toEqual(['*']);
    await expect(runtime.input.assertAllowed(root)).resolves.toBe(root);
    expect(runtime.input.getScanSnapshot()?.scanId).toBe(f.input.scan.scanId);
    await expect(runtime.input.resolveTool('npm')).resolves.toMatchObject({
      manager: 'npm',
      version: '11.17.0',
      file: nodeFile,
    });
    for (const configured of [undefined, '', '1000', 1000]) {
      const configuredRuntime = createNpmRunnerRuntime({
        ...bindings,
        config: new ConfigService({
          SCAN_ROOT_PATHS: 'D:\\TEST',
          NPM_COMMAND_TIMEOUT_MS: configured,
        }),
      });
      expect(configuredRuntime.timeoutMs).toBe(
        typeof configured === 'number' ? configured : undefined,
      );
      expect(configuredRuntime.input.scanRoots).toEqual(['D:\\TEST']);
    }
    const unsupported = createNpmRunnerRuntime({
      ...bindings,
      host: { platform: 'linux', execPath: '/usr/bin/node', env: {} },
    });
    expect(unsupported.input.platform).toBe('posix');
    expect(unsupported.processes).toBeNull();
    expect(
      Object.values(runtime.readers).map((predicate) => predicate()),
    ).toEqual([true, true, true, true]);
    await runtime.invalidation.refreshProject(root);
    runtime.invalidation.clearDiskUsage();
    runtime.invalidation.staleAnalysis(root);
    expect(refresh.mock.calls[0]).toEqual([root]);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(stale.mock.calls[0]).toEqual([root]);
    const record: IRunJob = {
      jobId: id,
      requestId,
      requestPath: root,
      path: root,
      scanId: id,
      action: 'script',
      manager: 'npm',
      version: '11.17.0',
      package: null,
      script: 'dev',
      status: 'completed',
      phase: 'done',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      spawned: true,
      exitCode: 0,
      signal: null,
      failureCode: null,
      stopReason: null,
      terminationVerified: true,
      mayHaveChanged: true,
      gateHeld: true,
      auditWritten: false,
      refreshRequired: false,
      warningCodes: [],
      firstCursor: 0,
      endCursor: 1,
      droppedBytes: 0,
    };
    await runtime.audit.writeIntent(record);
    await runtime.audit.writeResult(record);
    const [intent] = f.audit.mock.calls[0];
    const [result] = f.audit.mock.calls[1];
    expect(intent).toMatchObject({
      operation: 'npm-runner.run',
      operationId: id,
      phase: 'intent',
      targets: [root],
      method: 'npm:script',
      risk: { level: 'high', codes: [] },
      result: 'pending',
    });
    expect(result.phase).toBe('result');
    expect(JSON.parse(result.result) as unknown).toEqual({
      status: 'completed',
      exitCode: 0,
      signal: null,
      spawned: true,
      terminationVerified: true,
      mayHaveChanged: true,
      refreshRequired: false,
    });
    expect(result.result).not.toContain('TEST_VALUE');
  });
});
