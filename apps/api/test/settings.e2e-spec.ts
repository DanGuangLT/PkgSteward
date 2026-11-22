import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
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
import { PathGuardService } from '@/core/path-guard/path-guard.service';
import { DRIVE_DETECTOR } from '@/platform/interfaces/drive-detector.interface';
import type {
  ISettingsExportResponse,
  ISettingsPreviewResponse,
  ISettingsSnapshot,
} from '@/settings/interfaces/settings.types';
import type { IPluginsCatalog } from '@/settings/plugins/interfaces/plugin.types';
import { PLUGIN_MANIFEST_FILE_NAME } from '@/settings/plugins/plugin-registry.service';
import { createTestAppPaths } from './create-test-app-paths';

describe('SettingsModule (e2e)', () => {
  let app: INestApplication<App>;
  let tmpRoot: string;
  let dataDir: string;
  let allowedProjectDir: string;
  let nextAllowedDir: string;

  beforeAll(async () => {
    tmpRoot = realpathSync(
      mkdtempSync(join(tmpdir(), 'pkgsteward-settings-e2e-')),
    );
    dataDir = join(tmpRoot, 'data');
    allowedProjectDir = join(tmpRoot, 'roots', 'work-a');
    nextAllowedDir = join(tmpRoot, 'roots', 'work-b');
    mkdirSync(allowedProjectDir, { recursive: true });
    mkdirSync(nextAllowedDir, { recursive: true });

    const config = new ConfigService(
      loadAppConfig({
        env: {
          ...process.env,
          PKGSTEWARD_DATA_DIR: dataDir,
          SCAN_ROOT_PATHS: allowedProjectDir,
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
        listFixedDrives: jest.fn(() =>
          Promise.resolve([allowedProjectDir, nextAllowedDir]),
        ),
      })
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

  it('enforces Host/Origin guard and Cache-Control: no-store on settings endpoints', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/settings')
      .set('Host', 'evil.example:24681')
      .expect(403);

    const res = await request(app.getHttpServer())
      .get('/api/v1/settings')
      .expect(200);
    const body = res.body as IApiResponse<ISettingsSnapshot>;
    expect(res.headers['cache-control']).toBe('no-store');
    expect(body.data?.document.runtime.scanRootPaths).toBe(allowedProjectDir);
    expect(body.data?.sources.runtime.scanRootPaths).toBe('env');
  });

  it('updates UI preferences immediately and rejects runtime changes on /preferences', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/settings/preferences')
      .send({ runtime: { maxScanDepth: 3 } })
      .expect(400);

    const res = await request(app.getHttpServer())
      .patch('/api/v1/settings/preferences')
      .send({
        appearance: {
          themePreset: 'emerald',
          fontScale: 110,
          navigationLayout: 'sidebar',
        },
        behavior: { defaultConsoleShell: 'powershell' },
      })
      .expect(200);
    const body = res.body as IApiResponse<ISettingsSnapshot>;

    expect(body.data?.document.appearance.themePreset).toBe('emerald');
    expect(body.data?.document.appearance.navigationLayout).toBe('sidebar');
    expect(body.data?.document.behavior.defaultConsoleShell).toBe('powershell');
    expect(existsSync(join(dataDir, 'settings.json'))).toBe(true);
  });

  it('hot-reloads PathGuard SCAN_ROOT_PATHS via preview -> confirm -> audit log', async () => {
    const guard = app.get(PathGuardService);
    expect((await guard.check(nextAllowedDir)).allowed).toBe(false);

    const previewRes = await request(app.getHttpServer())
      .post('/api/v1/settings/preview')
      .send({
        runtime: {
          scanRootPaths: nextAllowedDir,
          maxScanDepth: 4,
          npmCommandTimeoutMs: 25000,
        },
        server: {
          port: 24999,
        },
      })
      .expect(200);
    const previewBody =
      previewRes.body as IApiResponse<ISettingsPreviewResponse>;
    const previewData = previewBody.data!;

    const previewId = previewData.previewId;
    expect(previewData.clearsScanCache).toBe(true);
    expect(previewData.restartRequiredFields).toContain('server.port');

    // Missing confirm returns 400
    await request(app.getHttpServer())
      .patch('/api/v1/settings')
      .send({ previewId, confirm: false })
      .expect(400);

    const execRes = await request(app.getHttpServer())
      .patch('/api/v1/settings')
      .send({ previewId, confirm: true })
      .expect(200);
    const execBody = execRes.body as IApiResponse<ISettingsSnapshot>;

    expect(execBody.data?.document.runtime.scanRootPaths).toBe(nextAllowedDir);
    expect(execBody.data?.restartRequiredFields).toEqual(['port']);
    // Live PathGuard now allows nextAllowedDir and blocks old allowedProjectDir
    expect((await guard.check(nextAllowedDir)).allowed).toBe(true);
    expect((await guard.check(allowedProjectDir)).allowed).toBe(false);

    const auditContent = readFileSync(
      join(dataDir, 'logs', 'dangerous-operations.jsonl'),
      'utf8',
    );
    expect(auditContent).toContain('"operation":"settings.update"');
    expect(auditContent).toContain('"phase":"intent"');
    expect(auditContent).toContain('"result":"completed"');
  });

  it('discovers valid and invalid plugin manifests safely on GET /api/v1/settings/plugins', async () => {
    const pluginFolder = join(dataDir, 'plugins', 'demo-plugin');
    mkdirSync(pluginFolder, { recursive: true });
    writeFileSync(
      join(pluginFolder, PLUGIN_MANIFEST_FILE_NAME),
      JSON.stringify({
        id: 'demo.plugin',
        name: 'Demo Plugin',
        version: '1.0.0',
        apiVersion: 1,
        capabilities: ['theme-preset'],
      }),
    );

    const res = await request(app.getHttpServer())
      .get('/api/v1/settings/plugins')
      .expect(200);
    const body = res.body as IApiResponse<IPluginsCatalog>;
    expect(res.headers['cache-control']).toBe('no-store');
    expect(body.data?.runtimeMode).toBe('manifest-only');
    expect(body.data?.discovered).toHaveLength(1);
    expect(body.data?.discovered[0].id).toBe('demo.plugin');
  });

  it('supports export -> import/preview -> import -> reset/preview -> reset', async () => {
    const exported = await request(app.getHttpServer())
      .get('/api/v1/settings/export')
      .expect(200);
    const exportedBody = exported.body as IApiResponse<ISettingsExportResponse>;
    expect(exported.headers['cache-control']).toBe('no-store');
    const doc = exportedBody.data!.document;

    const importPreview = await request(app.getHttpServer())
      .post('/api/v1/settings/import/preview')
      .send({
        document: {
          ...doc,
          appearance: {
            ...doc.appearance,
            themePreset: 'violet',
          },
        },
      })
      .expect(200);
    const importPreviewBody =
      importPreview.body as IApiResponse<ISettingsPreviewResponse>;

    const imported = await request(app.getHttpServer())
      .post('/api/v1/settings/import')
      .send({
        previewId: importPreviewBody.data!.previewId,
        confirm: true,
      })
      .expect(200);
    const importedBody = imported.body as IApiResponse<ISettingsSnapshot>;
    expect(importedBody.data?.document.appearance.themePreset).toBe('violet');

    // Resetting appearance keeps runtime narrowed
    const resetPreview = await request(app.getHttpServer())
      .post('/api/v1/settings/reset/preview')
      .send({ scope: 'appearance' })
      .expect(200);
    const resetPreviewBody =
      resetPreview.body as IApiResponse<ISettingsPreviewResponse>;

    const afterReset = await request(app.getHttpServer())
      .post('/api/v1/settings/reset')
      .send({
        previewId: resetPreviewBody.data!.previewId,
        confirm: true,
      })
      .expect(200);
    const afterResetBody = afterReset.body as IApiResponse<ISettingsSnapshot>;
    expect(afterResetBody.data?.document.appearance.themePreset).toBe(
      'default',
    );
  });

  it('rejects __proto__ payloads on import/preview and protected drive-root plugin directories', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/settings/import/preview')
      .set('Content-Type', 'application/json')
      .send('{"document":{"schemaVersion":1,"__proto__":{"polluted":true}}}')
      .expect(400);

    const driveRoot = process.platform === 'win32' ? 'C:\\' : '/';
    await request(app.getHttpServer())
      .post('/api/v1/settings/preview')
      .send({ plugins: { directory: driveRoot } })
      .expect(400);
  });
});
