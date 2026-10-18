import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '@/app.module';
import { AppPathsService } from '@/core/app-paths/app-paths.service';
import { PathGuardService } from '@/core/path-guard/path-guard.service';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('wires the shared PathGuardService', () => {
    const guard = app.get(PathGuardService);
    expect(
      guard.isInsideProtectedTree(app.get(AppPathsService).appInstallDir),
    ).toBe(true);
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
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
