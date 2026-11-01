import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { existsSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
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
import type { Response } from 'supertest';
import { AppModule } from '@/app.module';
import type { IApiResponse } from '@/common/interceptors/transform.interceptor';
import { loadAppConfig } from '@/config/config-loader';
import { configureApp } from '@/config/configure-app';
import { AppPathsService } from '@/core/app-paths/app-paths.service';
import { createFileOpsFs } from '@/file-ops/file-ops-fs';
import { GitProbe } from '@/file-ops/git-probe';
import { FILE_OPS_FS } from '@/file-ops/interfaces/file-ops.types';
import type {
  IFileOpsOperation,
  IFileOpsPreview,
  IFileTreeLevel,
  IOperationStart,
  IPreviewStart,
  IPreviewSummary,
} from '@/file-ops/interfaces/file-ops.types';
import { DRIVE_DETECTOR } from '@/platform/interfaces/drive-detector.interface';
import { PROCESS_SNAPSHOT } from '@/platform/interfaces/process-snapshot.interface';
import type { ProcessSnapshotResult } from '@/platform/interfaces/process-snapshot.interface';
import { RECYCLE_BIN } from '@/platform/interfaces/recycle-bin.interface';
import type { RecycleResult } from '@/platform/interfaces/recycle-bin.interface';
import type {
  IScanResult,
  IScanStart,
} from '@/scanner/interfaces/scanner.types';
import { createTestAppPaths } from './create-test-app-paths';

const API = '/api/v1/file-ops';
const UNKNOWN_ID = 'e4261d1d-590f-48a4-a765-d6dedcff17e4';

describe('FileOps HTTP flow (e2e)', () => {
  let base: string;
  let root: string;
  let dataDir: string;
  let project: string;
  let nodeModules: string;
  let otherNodeModules: string;
  let source: string;
  let app: INestApplication<Server>;

  // Deletion and recycling never reach the real filesystem in this suite.
  const remove = jest.fn<Promise<void>, [string, unknown]>();
  const recycle = jest.fn<Promise<RecycleResult>, [string, number]>();
  const capture = jest.fn<Promise<ProcessSnapshotResult>, []>();
  const git = {
    status: jest.fn(() => Promise.resolve({ state: 'clean' })),
    trackedNames: jest.fn(() =>
      Promise.resolve({ state: 'ok', tracked: [] as string[] }),
    ),
  };
  const detect = jest.fn(() =>
    Promise.reject(new Error('Drive discovery must not run')),
  );

  const makeProject = async (path: string) => {
    await mkdir(join(path, 'node_modules', 'test-package'), {
      recursive: true,
    });
    await mkdir(join(path, 'src'));
    await writeFile(join(path, 'package.json'), '{"name":"test-project"}');
    await writeFile(join(path, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
    await writeFile(
      join(path, 'node_modules', 'test-package', 'index.js'),
      'module.exports = 1;',
    );
    await writeFile(join(path, 'src', 'index.ts'), 'export {};');
  };

  beforeEach(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), 'pkgsteward-ops-e2e-')));
    root = join(base, 'allowed');
    dataDir = join(base, 'data');
    const installDir = join(base, 'install');
    project = join(root, 'test-app');
    nodeModules = join(project, 'node_modules');
    otherNodeModules = join(root, 'test-other', 'node_modules');
    source = join(project, 'src');
    await Promise.all(
      [root, dataDir, installDir].map((path) =>
        mkdir(path, { recursive: true }),
      ),
    );
    await makeProject(project);
    await makeProject(join(root, 'test-other'));

    jest.clearAllMocks();
    remove.mockResolvedValue(undefined);
    recycle.mockResolvedValue({ status: 'recycled' });
    capture.mockResolvedValue({ status: 'ok', processes: [] });

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
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(config)
      .overrideProvider(DRIVE_DETECTOR)
      .useValue({ listFixedDrives: detect })
      .overrideProvider(AppPathsService)
      .useFactory({
        factory: (service: ConfigService) =>
          createTestAppPaths(service, installDir),
        inject: [ConfigService],
      })
      .overrideProvider(FILE_OPS_FS)
      .useValue({ ...createFileOpsFs(), remove })
      .overrideProvider(RECYCLE_BIN)
      .useValue({ recycle })
      .overrideProvider(PROCESS_SNAPSHOT)
      .useValue({ capture })
      .overrideProvider(GitProbe)
      .useValue(git)
      .compile();
    app = module.createNestApplication<INestApplication<Server>>();
    app.useLogger(['error']);
    configureApp(app);
    await app.listen(0, '127.0.0.1');
  });

  afterEach(async () => {
    try {
      await app.close();
      expect(detect).not.toHaveBeenCalled();
    } finally {
      // Remove only this test's mkdtemp root, after the application has closed.
      if (base) await rm(base, { recursive: true, force: true });
    }
  });

  const http = () => request(app.getHttpServer());
  const data = <T>(response: Response): T =>
    (response.body as IApiResponse<T>).data as T;
  const code = (response: Response): string =>
    (response.body as { code: string }).code;

  const until = async <T>(
    read: () => Promise<T>,
    done: (value: T) => boolean,
  ): Promise<T> => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const value = await read();
      if (done(value)) return value;
      await delay(10);
    }
    throw new Error('Job did not reach the expected state');
  };

  const scan = async () => {
    const started = data<IScanStart>(
      await http().post('/api/v1/scans').expect(202),
    );
    await until(
      async () =>
        data<{ status: string }>(
          await http().get(`/api/v1/scans/${started.scanId}`).expect(200),
        ),
      ({ status }) => status !== 'running',
    );
  };

  const getPreview = async (previewId: string) => {
    const response = await http()
      .get(`${API}/previews/${previewId}`)
      .expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    return data<IFileOpsPreview>(response);
  };

  const finishedPreview = (previewId: string) =>
    until(
      () => getPreview(previewId),
      ({ status }) => status !== 'running',
    );

  const previewPaths = async (paths: string[]) => {
    const { previewId } = data<IPreviewStart>(
      await http().post(`${API}/delete/preview`).send({ paths }).expect(202),
    );
    return finishedPreview(previewId);
  };

  const getOperation = async (operationId: string) =>
    data<IFileOpsOperation>(
      await http().get(`${API}/operations/${operationId}`).expect(200),
    );

  const finishedOperation = (operationId: string) =>
    until(
      () => getOperation(operationId),
      ({ status }) => status !== 'running' && status !== 'stopping',
    );

  // Same steps as the UI: confirm exactly what the server says about this selection.
  const confirmed = async (previewId: string, paths: string[]) => {
    const summary = data<IPreviewSummary>(
      await http()
        .post(`${API}/previews/${previewId}/summary`)
        .send({ paths })
        .expect(200),
    );
    return {
      previewId,
      paths,
      confirm: true,
      acknowledgedRisks: summary.risk.reasons.map(
        ({ code: riskCode }) => riskCode,
      ),
      ...(summary.confirmText === null
        ? {}
        : { confirmText: summary.confirmText }),
    };
  };

  const execute = (body: object) =>
    http().post(`${API}/delete/execute`).send(body);

  const auditRecords = async () =>
    (
      await readFile(
        join(dataDir, 'logs', 'dangerous-operations.jsonl'),
        'utf8',
      )
    )
      .trim()
      .split('\n')
      .map(
        (line) =>
          JSON.parse(line) as {
            phase: string;
            operationId: string;
            targets: string[];
            result: string;
          },
      );

  it('previews, summarizes, deletes and updates the latest scan through the API', async () => {
    await scan();
    const { previewId, status } = data<IPreviewStart>(
      await http()
        .post(`${API}/cleanup/preview`)
        .send({ includeKinds: ['node_modules'], projectPaths: [project] })
        .expect(202),
    );
    expect(status).toBe('running');
    const preview = await finishedPreview(previewId);
    expect(preview.status).toBe('completed');
    expect(preview.targets).toHaveLength(1);
    expect(preview.targets[0]).toMatchObject({
      path: nodeModules,
      kind: 'node_modules',
      method: 'permanent',
      valid: true,
      size: { status: 'done' },
    });
    expect(JSON.stringify(preview)).not.toContain('identity');
    expect(remove).not.toHaveBeenCalled();

    const started = data<IOperationStart>(
      await execute(await confirmed(previewId, [nodeModules])).expect(202),
    );
    const operation = await finishedOperation(started.operationId);
    expect(operation).toMatchObject({
      status: 'completed',
      currentPath: null,
      results: [
        {
          path: nodeModules,
          status: 'success',
          errorCode: null,
          mayBePartial: false,
        },
      ],
    });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(nodeModules, {
      recursive: true,
      force: false,
      maxRetries: 0,
    });
    expect((await getPreview(previewId)).operationId).toBe(started.operationId);

    const latest = data<IScanResult>(
      await http().get('/api/v1/scans/latest').expect(200),
    );
    expect(
      latest.projects.find(({ path }) => path === project)?.nodeModules.exists,
    ).toBe(false);
    expect(await auditRecords()).toMatchObject([
      {
        phase: 'intent',
        operationId: started.operationId,
        targets: [nodeModules],
        result: 'pending',
      },
      {
        phase: 'result',
        operationId: started.operationId,
        targets: [nodeModules],
        result: 'success',
      },
    ]);
  });

  it('sends source folders to the Recycle Bin and demands the confirmation text', async () => {
    await scan();
    const preview = await previewPaths([source]);
    expect(preview.targets[0]).toMatchObject({
      kind: 'project_content',
      method: 'recycle',
      valid: true,
    });
    const body = await confirmed(preview.previewId, [source]);
    expect(body.confirmText).toBe('DELETE 1');

    const wrong = await execute({ ...body, confirmText: 'DELETE 2' }).expect(
      400,
    );
    expect(code(wrong)).toBe('VALIDATION_ERROR');
    expect(recycle).not.toHaveBeenCalled();
    expect((await getPreview(preview.previewId)).operationId).toBeNull();

    const started = data<IOperationStart>(await execute(body).expect(202));
    const operation = await finishedOperation(started.operationId);
    expect(operation.results[0]).toMatchObject({
      status: 'success',
      method: 'recycle',
      reclaimableBytes: null,
    });
    expect(recycle).toHaveBeenCalledTimes(1);
    expect(recycle.mock.calls[0][0]).toBe(source);
    expect(recycle.mock.calls[0][1]).toBeGreaterThan(0);
    expect(remove).not.toHaveBeenCalled();
  });

  it('replays a repeated execute without deleting twice and rejects other paths', async () => {
    await scan();
    const preview = await previewPaths([nodeModules, otherNodeModules]);
    const body = await confirmed(preview.previewId, [
      nodeModules,
      otherNodeModules,
    ]);
    const first = data<IOperationStart>(await execute(body).expect(202));
    await finishedOperation(first.operationId);
    expect(remove).toHaveBeenCalledTimes(2);

    const replay = data<IOperationStart>(
      await execute({
        ...body,
        paths: [otherNodeModules, nodeModules],
      }).expect(202),
    );
    expect(replay).toEqual({
      operationId: first.operationId,
      status: 'completed',
    });
    const other = await execute({ ...body, paths: [nodeModules] }).expect(409);
    expect(code(other)).toBe('CONFLICT');
    expect(remove).toHaveBeenCalledTimes(2);
    expect(await auditRecords()).toHaveLength(3);
  });

  it('refuses execution when the risk increased after the preview', async () => {
    await scan();
    const preview = await previewPaths([nodeModules]);
    const body = await confirmed(preview.previewId, [nodeModules]);
    capture.mockResolvedValue({
      status: 'ok',
      processes: [
        {
          pid: 4242,
          name: 'node.exe',
          executablePath: null,
          commandLine: `node ${join(project, 'server.js')}`,
        },
      ],
    });
    const refused = await execute(body).expect(409);
    expect(code(refused)).toBe('RISK_CHANGED');
    expect(remove).not.toHaveBeenCalled();
    expect(existsSync(join(dataDir, 'logs'))).toBe(false);
  });

  it('refuses execution after a newer scan replaced the preview baseline', async () => {
    await scan();
    const preview = await previewPaths([nodeModules]);
    const body = await confirmed(preview.previewId, [nodeModules]);
    await scan();
    const refused = await execute(body).expect(409);
    expect(code(refused)).toBe('SCAN_CHANGED');
    expect(remove).not.toHaveBeenCalled();
  });

  it('refuses a target that was replaced after the preview', async () => {
    await scan();
    const preview = await previewPaths([nodeModules]);
    const body = await confirmed(preview.previewId, [nodeModules]);
    // Same path, different directory: only the identity check can notice this.
    await rm(nodeModules, { recursive: true });
    await mkdir(nodeModules);
    const refused = await execute(body).expect(409);
    expect(code(refused)).toBe('TARGET_CHANGED');
    expect((refused.body as { details: unknown }).details).toEqual({
      paths: [nodeModules],
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it('holds the mutation gate during deletion and stops after the current target', async () => {
    await scan();
    const preview = await previewPaths([nodeModules, otherNodeModules]);
    const body = await confirmed(preview.previewId, [
      nodeModules,
      otherNodeModules,
    ]);
    let release!: () => void;
    remove.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const started = data<IOperationStart>(await execute(body).expect(202));
    await until(
      () => Promise.resolve(remove.mock.calls.length),
      (calls) => calls === 1,
    );

    const responses = await Promise.all([
      http().post('/api/v1/scans'),
      http()
        .post(`${API}/delete/preview`)
        .send({ paths: [source] }),
      http().post('/api/v1/disk-usage').send({ path: project }),
    ]);
    expect(responses.map(({ status }) => status)).toEqual([409, 409, 409]);

    const stopping = data<IFileOpsOperation>(
      await http()
        .post(`${API}/operations/${started.operationId}/cancel`)
        .expect(200),
    );
    expect(stopping.status).toBe('stopping');
    release();

    const operation = await finishedOperation(started.operationId);
    expect(operation.status).toBe('cancelled');
    expect(operation.results.map(({ status }) => status)).toEqual([
      'success',
      'not_started',
    ]);
    expect(remove).toHaveBeenCalledTimes(1);
    await http()
      .post(`${API}/delete/preview`)
      .send({ paths: [source] })
      .expect(202);
  });

  it('reports a locked target per path without stopping the others', async () => {
    await scan();
    const preview = await previewPaths([nodeModules, otherNodeModules]);
    remove.mockRejectedValueOnce(
      Object.assign(new Error('EBUSY private path'), { code: 'EBUSY' }),
    );
    const started = data<IOperationStart>(
      await execute(
        await confirmed(preview.previewId, [nodeModules, otherNodeModules]),
      ).expect(202),
    );
    const operation = await finishedOperation(started.operationId);
    expect(operation.status).toBe('completed');
    expect(operation.results).toMatchObject([
      { status: 'failed', errorCode: 'FILE_IN_USE', mayBePartial: true },
      { status: 'success', errorCode: null },
    ]);
    expect(JSON.stringify(operation)).not.toContain('private path');
    expect(
      (await auditRecords()).filter(({ phase }) => phase === 'result'),
    ).toMatchObject([{ result: 'failed' }, { result: 'success' }]);
  });

  it('accepts the documented path limit at realistic path lengths', async () => {
    await scan();
    const paths = Array.from({ length: 1000 }, (_, index) =>
      join(project, 'src', `${'a'.repeat(150)}-${index}`),
    );
    const { previewId } = data<IPreviewStart>(
      await http().post(`${API}/delete/preview`).send({ paths }).expect(202),
    );
    const preview = await finishedPreview(previewId);
    expect(preview.targets).toHaveLength(1000);
    expect(preview.targets.every(({ valid }) => !valid)).toBe(true);
  });

  it('answers an oversized body with a clear 413 instead of a 500', async () => {
    const paths = Array.from({ length: 1000 }, () => 'a'.repeat(11_000));
    const response = await http()
      .post(`${API}/delete/preview`)
      .send({ paths })
      .expect(413);
    expect(code(response)).toBe('PAYLOAD_TOO_LARGE');
  });

  it('finds the running operation again without knowing its ID', async () => {
    await scan();
    const idle = await http().get(`${API}/operations/active`).expect(200);
    expect(idle.headers['cache-control']).toBe('no-store');
    expect(data<IFileOpsOperation | null>(idle)).toBeNull();

    const preview = await previewPaths([nodeModules]);
    const body = await confirmed(preview.previewId, [nodeModules]);
    let release!: () => void;
    remove.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const started = data<IOperationStart>(await execute(body).expect(202));
    await until(
      () => Promise.resolve(remove.mock.calls.length),
      (calls) => calls === 1,
    );
    const active = data<IFileOpsOperation | null>(
      await http().get(`${API}/operations/active`).expect(200),
    );
    expect(active).toMatchObject({
      operationId: started.operationId,
      status: 'running',
      currentPath: nodeModules,
    });
    release();
    await finishedOperation(started.operationId);
    expect(
      data<IFileOpsOperation | null>(
        await http().get(`${API}/operations/active`).expect(200),
      ),
    ).toBeNull();
  });

  it('never treats a cache folder holding a scanned project as disposable', async () => {
    const coverage = join(project, 'coverage');
    await mkdir(join(coverage, 'test-tool'), { recursive: true });
    await writeFile(
      join(coverage, 'test-tool', 'package.json'),
      '{"name":"test-tool"}',
    );
    await scan();
    const { previewId } = data<IPreviewStart>(
      await http()
        .post(`${API}/cleanup/preview`)
        .send({ includeKinds: ['build_cache'], projectPaths: [project] })
        .expect(202),
    );
    const cleanup = await finishedPreview(previewId);
    expect(cleanup.targets.map(({ path }) => path)).not.toContain(coverage);

    const preview = await previewPaths([coverage]);
    expect(preview.targets[0]).toMatchObject({
      kind: 'project_content',
      method: 'recycle',
      nestedProjects: [join(coverage, 'test-tool')],
    });
    expect(preview.risk.level).toBe('high');
  });

  it('rejects unusable selections with the shared error shape', async () => {
    await scan();
    const outside = join(base, 'data');
    const preview = await previewPaths([nodeModules, outside]);
    const invalid = preview.targets.find(({ valid }) => !valid);
    expect(invalid).toBeDefined();
    const body = await confirmed(preview.previewId, [nodeModules]);

    for (const change of [
      { confirm: 'true' },
      { confirm: false },
      { confirm: null },
      { previewId: 'invalid' },
      { paths: [] },
      { paths: [invalid!.path] },
      { extra: true },
    ]) {
      const refused = await execute({ ...body, ...change }).expect(400);
      expect(code(refused)).toBe('VALIDATION_ERROR');
    }
    const missing = await execute({ ...body, previewId: UNKNOWN_ID }).expect(
      404,
    );
    expect(code(missing)).toBe('NOT_FOUND');
    await http().get(`${API}/previews/invalid`).expect(400);
    await http().get(`${API}/previews/${UNKNOWN_ID}`).expect(404);
    await http().get(`${API}/operations/${UNKNOWN_ID}`).expect(404);
    await http().post(`${API}/operations/${UNKNOWN_ID}/cancel`).expect(404);
    expect(remove).not.toHaveBeenCalled();
    expect(recycle).not.toHaveBeenCalled();
  });

  it('lists one tree level and refuses a preview before any scan', async () => {
    const refused = await http()
      .post(`${API}/cleanup/preview`)
      .send({})
      .expect(404);
    expect(code(refused)).toBe('NOT_FOUND');
    await scan();
    const response = await http()
      .get(`${API}/tree`)
      .query({ path: project })
      .expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const level = data<IFileTreeLevel>(response);
    expect(level.path).toBe(project);
    expect(level.entries.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['node_modules', 'src', 'package.json']),
    );
    await http().get(`${API}/tree`).expect(400);
  });

  it('documents the file operation routes in the live Swagger document', async () => {
    const response = await http().get('/swagger-json').expect(200);
    const { paths } = response.body as { paths: Record<string, unknown> };
    expect(Object.keys(paths)).toEqual(
      expect.arrayContaining([
        `${API}/delete/execute`,
        `${API}/operations/{operationId}/cancel`,
      ]),
    );
  });
});
