import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '@/app.module';
import { AppPathsService } from '@/core/app-paths/app-paths.service';
import { PathGuardService } from '@/core/path-guard/path-guard.service';
import { configureApp } from '@/config/configure-app';
import { createTestAppPaths } from './create-test-app-paths';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  let tmpInstallDir: string;

  beforeAll(async () => {
    tmpInstallDir = mkdtempSync(join(tmpdir(), 'pkgsteward-app-e2e-'));
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AppPathsService)
      .useFactory({
        factory: (configService: ConfigService) =>
          createTestAppPaths(configService, tmpInstallDir),
        inject: [ConfigService],
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
      if (tmpInstallDir)
        rmSync(tmpInstallDir, { recursive: true, force: true });
    }
  });

  it('wires the shared PathGuardService', () => {
    const guard = app.get(PathGuardService);
    const appPaths = app.get(AppPathsService);
    expect(appPaths).toBeInstanceOf(AppPathsService);
    expect(appPaths.appInstallDir).toBe(tmpInstallDir);
    expect(guard.isInsideProtectedTree(appPaths.appInstallDir)).toBe(true);
  });

  it('answers an unknown route with NOT_FOUND', () =>
    request(app.getHttpServer())
      .get('/api/v1/does-not-exist')
      .expect(404)
      .expect((res) =>
        expect((res.body as { code: unknown }).code).toBe('NOT_FOUND'),
      ));

  it('/api/v1 (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/v1')
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          statusCode: 200,
          message: 'Request successful',
          code: 'SUCCESS',
          data: 'Hello World!',
        });
      });
  });
});
