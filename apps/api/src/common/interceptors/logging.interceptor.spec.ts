import { Logger } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import { PollingEndpoint } from '@/common/decorators/throttle.decorator';
import { LoggingInterceptor } from '@/common/interceptors/logging.interceptor';

class Handlers {
  @PollingEndpoint()
  poll(this: void) {}

  plain(this: void) {}
}

const context = (method: string, handler: () => void) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ method, url: '/api/v1/scans/1' }),
      getResponse: () => ({ statusCode: 200 }),
    }),
    getHandler: () => handler,
    getClass: () => Handlers,
  }) as unknown as ExecutionContext;

const ok: CallHandler = { handle: () => of('x') };

describe('LoggingInterceptor', () => {
  let log: jest.SpyInstance;
  let debug: jest.SpyInstance;
  let error: jest.SpyInstance;
  const interceptor = new LoggingInterceptor(new Reflector());
  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('logs GET polling endpoints at debug', async () => {
    await lastValueFrom(
      interceptor.intercept(context('GET', Handlers.prototype.poll), ok),
    );
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining('GET /api/v1/scans/1 → 200'),
    );
    expect(log).not.toHaveBeenCalled();
  });

  it('logs other requests at log level', async () => {
    await lastValueFrom(
      interceptor.intercept(context('GET', Handlers.prototype.plain), ok),
    );
    await lastValueFrom(
      interceptor.intercept(context('POST', Handlers.prototype.poll), ok),
    );
    expect(log).toHaveBeenCalledTimes(2);
    expect(debug).not.toHaveBeenCalled();
  });

  it('leaves error logging to the exception filter', async () => {
    const failing: CallHandler = {
      handle: () => throwError(() => new Error('x')),
    };
    await expect(
      lastValueFrom(
        interceptor.intercept(
          context('GET', Handlers.prototype.plain),
          failing,
        ),
      ),
    ).rejects.toThrow('x');
    expect(error).not.toHaveBeenCalled();
  });
});
