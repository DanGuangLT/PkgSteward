import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '@/app.module';
import type { IApiResponse } from '@/common/interceptors/transform.interceptor';
import { loadAppConfig } from '@/config/config-loader';
import { configureApp } from '@/config/configure-app';
import { AppPathsService } from '@/core/app-paths/app-paths.service';
import { NODE_MANAGER_PROBE_RUNNER } from '@/node-runtime/probes/node-manager.probe';
import type { ProbeExecRunner } from '@/node-runtime/probes/node-manager.probe';
import type {
  INodeRuntimeOverview,
  IProjectNodeRuntimeDetail,
} from '@/node-runtime/interfaces/node-runtime.types';
import { DRIVE_DETECTOR } from '@/platform/interfaces/drive-detector.interface';
import { createTestAppPaths } from './create-test-app-paths';

describe('NodeRuntimeModule (e2e)', () => {
  let app: INestApplication<App>;
  let tmpRoot: string;
  let dataDir: string;
  let allowedRoot: string;
  let outsideDir: string;
  let projectDir: string;
  let probeRunnerMock: jest.Mock<
    ReturnType<ProbeExecRunner>,
    Parameters<ProbeExecRunner>
  >;

  beforeAll(async () => {
    tmpRoot = realpathSync(
      mkdtempSync(join(tmpdir(), 'pkgsteward-node-runtime-e2e-')),
    );
    dataDir = join(tmpRoot, 'data');
    allowedRoot = join(tmpRoot, 'roots');
    outsideDir = join(tmpRoot, 'outside-secret');
    projectDir = join(allowedRoot, 'demo-app');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });

    writeFileSync(join(projectDir, '.nvmrc'), '18.20.4\n', 'utf8');
    writeFileSync(
      join(projectDir, 'package.json'),
      JSON.stringify({ name: 'demo-app', engines: { node: '>=22.18' } }),
      'utf8',
    );
    // Directory junction/symlink pretending to be .node-version must be ignored safely.
    symlinkSync(
      outsideDir,
      join(projectDir, '.node-version'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    probeRunnerMock = jest.fn<
      ReturnType<ProbeExecRunner>,
      Parameters<ProbeExecRunner>
    >((file) => {
      if (file === 'nvm') {
        return Promise.resolve({
          exitCode: 0,
          stdout:
            '  * 24.19.0 (Currently using 64-bit executable)\n    18.20.4\n',
          failed: false,
          timedOut: false,
        });
      }
      return Promise.resolve({
        exitCode: 1,
        stdout: '',
        failed: true,
        timedOut: false,
      });
    });

    const config = new ConfigService(
      loadAppConfig({
        env: {
          ...process.env,
          PKGSTEWARD_DATA_DIR: dataDir,
          SCAN_ROOT_PATHS: allowedRoot,
          MODE: 'development',
          LIST_ORIGIN_CORS: 'http://localhost:24680',
        },
      }),
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ConfigService)
      .useValue(config)
      .overrideProvider(AppPathsService)
      .useFactory({
        factory: (configService: ConfigService) =>
          createTestAppPaths(configService, join(tmpRoot, 'app-install')),
        inject: [ConfigService],
      })
      .overrideProvider(DRIVE_DETECTOR)
      .useValue({
        listFixedDrives: jest.fn(() => Promise.resolve([allowedRoot])),
      })
      .overrideProvider(NODE_MANAGER_PROBE_RUNNER)
      .useValue(probeRunnerMock)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    try {
      if (app) await app.close();
    } finally {
      if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('enforces Host guard and returns overview cleanly without cached scan', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/node-runtime')
      .set('Host', 'evil.example:24681')
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/v1/node-runtime?unknownParam=1')
      .expect(400);

    const res = await request(app.getHttpServer())
      .get('/api/v1/node-runtime')
      .expect(200);
    const body = res.body as IApiResponse<INodeRuntimeOverview>;

    expect(res.headers['cache-control']).toBe('no-store');
    expect(body.data?.scanId).toBeNull();
    expect(body.data?.projects).toEqual([]);
    expect(body.data?.installedVersions).toEqual(['24.19.0', '18.20.4']);
    expect(probeRunnerMock).toHaveBeenCalledTimes(3);

    await request(app.getHttpServer())
      .get('/api/v1/node-runtime?refresh=true')
      .expect(200);
    expect(probeRunnerMock).toHaveBeenCalledTimes(6);
  });

  it('inspects allowed project safely, skips symlinked .node-version, and rejects invalid/denied/missing paths', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/node-runtime/project')
      .expect(400);

    await request(app.getHttpServer())
      .get('/api/v1/node-runtime/project')
      .query({ path: outsideDir })
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/v1/node-runtime/project')
      .query({ path: join(allowedRoot, 'does-not-exist') })
      .expect(404);

    const res = await request(app.getHttpServer())
      .get('/api/v1/node-runtime/project')
      .query({ path: projectDir })
      .expect(200);
    const body = res.body as IApiResponse<IProjectNodeRuntimeDetail>;

    expect(res.headers['cache-control']).toBe('no-store');
    expect(body.data?.project.name).toBe('demo-app');
    expect(body.data?.project.requirements.map((item) => item.source)).toEqual([
      '.nvmrc',
      'package.json#engines.node',
    ]);
    expect(body.data?.project.effectiveRequirement?.source).toBe('.nvmrc');
    expect(body.data?.project.commands[0]?.switchCommand).toBe(
      'nvm use 18.20.4',
    );
  });

  it('returns 200 with all managers undetected when no manager is installed or probes reject', async () => {
    probeRunnerMock.mockRejectedValue(new Error('ENOENT'));

    const res = await request(app.getHttpServer())
      .get('/api/v1/node-runtime?refresh=true')
      .expect(200);
    const body = res.body as IApiResponse<INodeRuntimeOverview>;

    expect(body.data?.activeNodeVersion).toBe(process.versions.node);
    expect(body.data?.scanId).toBeNull();
    expect(body.data?.projects).toEqual([]);
    expect(body.data?.installedVersions).toEqual([]);
    expect(body.data?.managers).toEqual([
      {
        id: 'nvm-windows',
        label: 'nvm-windows',
        detected: false,
        activeVersion: null,
        installedVersions: [],
      },
      {
        id: 'fnm',
        label: 'fnm',
        detected: false,
        activeVersion: null,
        installedVersions: [],
      },
      {
        id: 'volta',
        label: 'Volta',
        detected: false,
        activeVersion: null,
        installedVersions: [],
      },
    ]);
  });
});
