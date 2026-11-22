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
  IPluginInstallPreviewResponse,
  IPluginSandboxDocumentResponse,
  IPluginUninstallPreviewResponse,
  ISettingsExportResponse,
  ISettingsPreviewResponse,
  ISettingsSnapshot,
} from '@/settings/interfaces/settings.types';
import type { IPluginsCatalog } from '@/settings/plugins/interfaces/plugin.types';
import { PLUGIN_MANIFEST_FILE_NAME } from '@/settings/plugins/plugin-registry.service';
import { createTestAppPaths } from './create-test-app-paths';

function buildStoredZip(entries: { name: string; content: Buffer }[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(entry.content.length, 18);
    local.writeUInt32LE(entry.content.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    localChunks.push(local, nameBuf, entry.content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(entry.content.length, 20);
    central.writeUInt32LE(entry.content.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, nameBuf);

    offset += local.length + nameBuf.length + entry.content.length;
  }

  const centralBuf = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localChunks, centralBuf, eocd]);
}

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
    expect(body.data?.runtimeMode).toBe('sandboxed-web');
    const discoveredIds = body.data?.discovered.map((p) => p.id) ?? [];
    expect(discoveredIds).toContain('wallpaper-engine');
    expect(discoveredIds).toContain('demo.plugin');
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

  it('exposes availableDrives, uninstalls & restores preinstalled wallpaper plugin, installs ZIP plugin, and serves sandbox/assets safely', async () => {
    const snapRes = await request(app.getHttpServer())
      .get('/api/v1/settings')
      .expect(200);
    const snapBody = snapRes.body as IApiResponse<ISettingsSnapshot>;
    expect(snapBody.data?.availableDrives).toEqual([
      allowedProjectDir,
      nextAllowedDir,
    ]);

    // Uninstall preinstalled wallpaper-engine and restore it
    const uninstallPreview = await request(app.getHttpServer())
      .post('/api/v1/settings/plugins/uninstall/preview')
      .send({ pluginId: 'wallpaper-engine' })
      .expect(200);
    const uninstallBody =
      uninstallPreview.body as IApiResponse<IPluginUninstallPreviewResponse>;
    expect(uninstallBody.data?.preinstalled).toBe(true);

    const afterUninstall = await request(app.getHttpServer())
      .post('/api/v1/settings/plugins/uninstall')
      .send({ previewId: uninstallBody.data!.previewId, confirm: true })
      .expect(200);
    const afterUninstallBody =
      afterUninstall.body as IApiResponse<ISettingsSnapshot>;
    expect(afterUninstallBody.data?.plugins.preinstalledAvailable).toBe(true);
    expect(
      afterUninstallBody.data?.plugins.discovered.some(
        (p) => p.id === 'wallpaper-engine',
      ),
    ).toBe(false);

    const restored = await request(app.getHttpServer())
      .post('/api/v1/settings/plugins/restore-defaults')
      .send({})
      .expect(200);
    const restoredBody = restored.body as IApiResponse<ISettingsSnapshot>;
    expect(restoredBody.data?.plugins.preinstalledAvailable).toBe(false);
    expect(
      restoredBody.data?.plugins.discovered.some(
        (p) => p.id === 'wallpaper-engine',
      ),
    ).toBe(true);

    // Install a web-wallpaper ZIP via octet-stream upload
    const zipBytes = buildStoredZip([
      {
        name: 'neon-bg/project.json',
        content: Buffer.from(
          JSON.stringify({
            title: 'Neon Grid',
            type: 'web',
            file: 'index.html',
          }),
          'utf8',
        ),
      },
      {
        name: 'neon-bg/index.html',
        content: Buffer.from(
          '<!doctype html><html><body><canvas id="c"></canvas></body></html>',
          'utf8',
        ),
      },
      {
        name: 'neon-bg/assets/thumb.png',
        content: Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00,
          0x0d,
        ]),
      },
    ]);

    const installPreview = await request(app.getHttpServer())
      .post('/api/v1/settings/plugins/install/preview')
      .set('Content-Type', 'application/octet-stream')
      .set('x-plugin-filename', 'neon-bg.zip')
      .send(zipBytes)
      .expect(200);
    const installPreviewBody =
      installPreview.body as IApiResponse<IPluginInstallPreviewResponse>;
    expect(installPreviewBody.data?.pluginId).toBe('neon-grid');
    expect(installPreviewBody.data?.entryKind).toBe('web-sandbox');

    const installed = await request(app.getHttpServer())
      .post('/api/v1/settings/plugins/install')
      .send({
        previewId: installPreviewBody.data!.previewId,
        confirm: true,
        acknowledgedRisks: ['PLUGIN_SANDBOX_SCRIPT'],
      })
      .expect(200);
    const installedBody = installed.body as IApiResponse<ISettingsSnapshot>;
    expect(
      installedBody.data?.plugins.discovered.some((p) => p.id === 'neon-grid'),
    ).toBe(true);

    const sandboxDoc = await request(app.getHttpServer())
      .get('/api/v1/settings/plugins/neon-grid/sandbox-document')
      .expect(200);
    const sandboxBody =
      sandboxDoc.body as IApiResponse<IPluginSandboxDocumentResponse>;
    expect(sandboxBody.data?.html).toContain("connect-src 'none'");

    const assetRes = await request(app.getHttpServer())
      .get('/api/v1/settings/plugins/neon-grid/assets/assets/thumb.png')
      .expect(200);
    expect(assetRes.headers['x-content-type-options']).toBe('nosniff');
    expect(assetRes.headers['cache-control']).toBe('no-store');
    expect(assetRes.headers['content-type']).toContain('image/png');

    await request(app.getHttpServer())
      .get('/api/v1/settings/plugins/neon-grid/assets/..%2F..%2Fsecret.txt')
      .expect(400);

    // Upload valid PNG media to wallpaper-engine
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    const mediaRes = await request(app.getHttpServer())
      .post('/api/v1/settings/plugins/wallpaper-media')
      .set('Content-Type', 'application/octet-stream')
      .set('x-plugin-filename', 'custom.png')
      .send(pngBytes)
      .expect(200);
    const mediaBody = mediaRes.body as IApiResponse<ISettingsSnapshot>;
    expect(
      mediaBody.data?.document.plugins.entries['wallpaper-engine']?.config.mode,
    ).toBe('image');

    const savedMediaAsset = String(
      mediaBody.data?.document.plugins.entries['wallpaper-engine']?.config
        .mediaAsset ?? '',
    );
    const streamedMedia = await request(app.getHttpServer())
      .get(
        `/api/v1/settings/plugins/wallpaper-engine/assets/${savedMediaAsset}`,
      )
      .expect(200);
    expect(streamedMedia.headers['x-content-type-options']).toBe('nosniff');
  });
});
