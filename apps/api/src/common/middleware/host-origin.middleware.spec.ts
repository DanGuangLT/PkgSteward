import type { NextFunction, Request, Response } from 'express';
import {
  createHostOriginMiddleware,
  isAllowedHost,
  isAllowedOrigin,
  isWriteMethod,
  parseAllowedOrigins,
} from '@/common/middleware/host-origin.middleware';

describe('isAllowedHost', () => {
  it.each([
    'localhost:24681',
    '127.0.0.1:24681',
    '[::1]:24681',
    'LOCALHOST:24681',
    ' localhost:24681 ',
  ])('accepts %s', (host) => expect(isAllowedHost(host, 24681)).toBe(true));
  it.each([
    'localhost:24680',
    'localhost',
    'evil.example:24681',
    'localhost.evil.example:24681',
    'localhost:24681.evil.example',
    'localhost.:24681',
    '127.0.0.2:24681',
    '::1:24681',
    '',
    undefined,
  ])('rejects %p', (host) => expect(isAllowedHost(host, 24681)).toBe(false));
  it('rejects when the listening port is unknown', () =>
    expect(isAllowedHost('localhost:24681', undefined)).toBe(false));
});

describe('isAllowedOrigin', () => {
  const allowed = ['http://localhost:24680'];
  it.each([
    'http://localhost:24680',
    'HTTP://LOCALHOST:24680',
    'http://localhost:24680/',
  ])('accepts %s', (origin) =>
    expect(isAllowedOrigin(origin, allowed)).toBe(true),
  );
  it.each([
    'http://evil.example',
    'null',
    '',
    'http://localhost:24680.evil.example',
    'https://localhost:24680',
  ])('rejects %p', (origin) =>
    expect(isAllowedOrigin(origin, allowed)).toBe(false),
  );
  it('rejects everything when no origin is configured', () =>
    expect(isAllowedOrigin('http://localhost:24680', [])).toBe(false));
});

describe('isWriteMethod / parseAllowedOrigins', () => {
  it('treats POST, PUT, PATCH, DELETE as writes', () => {
    for (const m of ['POST', 'put', 'PATCH', 'DELETE'])
      expect(isWriteMethod(m)).toBe(true);
    for (const m of ['GET', 'HEAD', 'OPTIONS'])
      expect(isWriteMethod(m)).toBe(false);
  });
  it('splits and trims LIST_ORIGIN_CORS', () =>
    expect(parseAllowedOrigins(' http://a , ,http://b ')).toEqual([
      'http://a',
      'http://b',
    ]));
});

describe('createHostOriginMiddleware', () => {
  const middleware = createHostOriginMiddleware({
    allowedOrigins: ['http://localhost:24680'],
  });
  const run = (
    headers: Record<string, string>,
    method = 'GET',
    socket: { localPort?: number } = { localPort: 24681 },
  ) => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const res = { status } as unknown as Response;
    const next = jest.fn() as NextFunction;
    const req = {
      headers,
      method,
      originalUrl: '/api/v1/x',
      socket,
    } as unknown as Request;
    middleware(req, res, next);
    return { status, json, next };
  };

  it('passes a loopback Host on the listening port', () =>
    expect(run({ host: 'localhost:24681' }).next).toHaveBeenCalled());

  it('answers 403 with the standard error body for a foreign Host', () => {
    const { status, json, next } = run({ host: 'evil.example:24681' });
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      statusCode: 403,
      message: 'Host not allowed',
      code: 'FORBIDDEN',
      timestamp: expect.any(String) as unknown,
      path: '/api/v1/x',
    });
  });

  it('rejects a missing Host', () =>
    expect(run({}).next).not.toHaveBeenCalled());

  it('rejects a write from a foreign Origin', () => {
    const { json, next } = run(
      { host: 'localhost:24681', origin: 'http://evil.example' },
      'POST',
    );
    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Origin not allowed',
        code: 'FORBIDDEN',
      }),
    );
  });

  it('lets a write without Origin through (server-to-server from Next)', () =>
    expect(run({ host: 'localhost:24681' }, 'POST').next).toHaveBeenCalled());

  it('does not check Origin on reads', () =>
    expect(
      run({ host: 'localhost:24681', origin: 'http://evil.example' }).next,
    ).toHaveBeenCalled());

  it('compares the Host port with the socket that received the request', () => {
    expect(
      run({ host: 'localhost:24681' }, 'GET', { localPort: 3000 }).next,
    ).not.toHaveBeenCalled();
    expect(
      run({ host: 'localhost:3000' }, 'GET', { localPort: 3000 }).next,
    ).toHaveBeenCalled();
    expect(
      run({ host: 'localhost:24681' }, 'GET', {}).next,
    ).not.toHaveBeenCalled();
  });

  describe.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s', (method) => {
    it.each(['', 'null', 'http://localhost:24680.evil.example'])(
      'rejects Origin %p',
      (origin) =>
        expect(
          run({ host: 'localhost:24681', origin }, method).next,
        ).not.toHaveBeenCalled(),
    );
    it('accepts the configured Origin', () =>
      expect(
        run(
          { host: 'localhost:24681', origin: 'http://localhost:24680' },
          method,
        ).next,
      ).toHaveBeenCalled());
  });
});
