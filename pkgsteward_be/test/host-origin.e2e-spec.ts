import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import request from 'supertest';
import { AppModule } from '@/app.module';
import { configureApp } from '@/config/configure-app';

describe('Host/Origin guard (e2e)', () => {
  let app: INestApplication<Server>;
  let port: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  const server = () => app.getHttpServer();

  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'serves the API for Host %s:<port>',
    (name) =>
      request(server())
        .get('/api/v1')
        .set('Host', `${name}:${port}`)
        .expect(200),
  );

  it('rejects a foreign Host with the standard error body', () =>
    request(server())
      .get('/api/v1')
      .set('Host', 'evil.example:24681')
      .expect(403)
      .expect((res) => {
        expect(res.body).toEqual({
          statusCode: 403,
          message: 'Host not allowed',
          code: 'FORBIDDEN',
          timestamp: expect.any(String) as unknown,
          path: '/api/v1',
        });
      }));

  it('rejects a loopback Host on another port', () =>
    request(server())
      .get('/api/v1')
      .set('Host', `localhost:${port + 1}`)
      .expect(403));

  it('protects Swagger too (guard runs before Swagger)', async () => {
    await request(server())
      .get('/swagger')
      .set('Host', 'evil.example:24681')
      .expect(403);
    await request(server())
      .get('/swagger')
      .set('Host', `localhost:${port}`)
      .expect(200);
  });

  it('rejects a POST from a foreign Origin', () =>
    request(server())
      .post('/api/v1')
      .set('Host', `localhost:${port}`)
      .set('Origin', 'http://evil.example')
      .expect(403)
      .expect((res) =>
        expect((res.body as { message: string }).message).toBe(
          'Origin not allowed',
        ),
      ));

  it('lets a POST without Origin reach routing (no such route → 404, not 403)', () =>
    request(server())
      .post('/api/v1')
      .set('Host', `localhost:${port}`)
      .expect(404));

  it('lets a POST from the frontend Origin reach routing', () =>
    request(server())
      .post('/api/v1')
      .set('Host', `localhost:${port}`)
      .set('Origin', 'http://localhost:24680')
      .expect(404));

  it('does not check Origin on GET', () =>
    request(server())
      .get('/api/v1')
      .set('Host', `localhost:${port}`)
      .set('Origin', 'http://evil.example')
      .expect(200));

  it('answers CORS preflight without allowing credentials', () =>
    request(server())
      .options('/api/v1')
      .set('Host', `localhost:${port}`)
      .set('Origin', 'http://localhost:24680')
      .set('Access-Control-Request-Method', 'POST')
      .expect(204)
      .expect((res) => {
        expect(res.headers['access-control-allow-origin']).toBe(
          'http://localhost:24680',
        );
        expect(res.headers['access-control-allow-credentials']).toBeUndefined();
      }));
});
