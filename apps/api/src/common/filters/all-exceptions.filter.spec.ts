import 'reflect-metadata';
import type { ArgumentsHost } from '@nestjs/common';
import {
  BadRequestException,
  HttpException,
  Logger,
  NotFoundException as NestNotFoundException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { IsString } from 'class-validator';
import {
  AppException,
  ConflictException,
  InternalServerException,
} from '@/common/exceptions/app.exception';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import { createValidationPipe } from '@/config/validation.config';

class CreateThingDto {
  @IsString({ message: 'name must be a string' })
  name!: string;
}

const run = (exception: unknown) => {
  const json = jest.fn<void, [Record<string, unknown>]>();
  const status = jest.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'POST', url: '/api/v1/things' }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return { status, body: json.mock.calls[0][0] };
};

describe('AllExceptionsFilter', () => {
  let warn: jest.SpyInstance<void, [unknown, ...unknown[]]>;
  let error: jest.SpyInstance<void, [unknown, ...unknown[]]>;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('maps ValidationPipe errors to VALIDATION_ERROR and keeps details', async () => {
    const exception: unknown = await createValidationPipe()
      .transform(
        { name: 1, extra: 'x' },
        { type: 'body', metatype: CreateThingDto },
      )
      .catch((e: unknown) => e);
    const { status, body } = run(exception);
    expect(status).toHaveBeenCalledWith(400);
    expect(body).toMatchObject({
      statusCode: 400,
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      path: '/api/v1/things',
      details: expect.arrayContaining([
        { field: 'name', messages: ['name must be a string'] },
        { field: 'extra', messages: ['property extra should not exist'] },
      ]) as unknown,
    });
    expect(warn).toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('maps 429 to RATE_LIMITED', () => {
    const { status, body } = run(new ThrottlerException());
    expect(status).toHaveBeenCalledWith(429);
    expect(body.code).toBe('RATE_LIMITED');
  });

  it('maps an unknown route to NOT_FOUND', () => {
    const { body } = run(new NestNotFoundException('Cannot GET /api/v1/nope'));
    expect(body).toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Cannot GET /api/v1/nope',
    });
  });

  it('keeps HTTP_EXCEPTION for other HttpExceptions', () =>
    expect(run(new BadRequestException('bad')).body.code).toBe(
      'HTTP_EXCEPTION',
    ));

  // body-parser's http-errors instance; Nest >= 12.3 wraps it in an HttpException cause.
  const tooLarge = () =>
    Object.assign(new Error('request entity too large'), {
      type: 'entity.too.large',
      status: 413,
      statusCode: 413,
      expose: true,
    });

  it.each([
    ['the raw body-parser error', () => tooLarge()],
    [
      'an HttpException wrapping it',
      () =>
        new HttpException('request entity too large', 413, {
          cause: tooLarge(),
        }),
    ],
  ])('maps %s to PAYLOAD_TOO_LARGE', (_label, make) => {
    const { status, body } = run(make());
    expect(status).toHaveBeenCalledWith(413);
    expect(body).toMatchObject({
      statusCode: 413,
      message: 'Request body is too large',
      code: 'PAYLOAD_TOO_LARGE',
    });
    expect(warn).toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('logs 4xx AppExceptions at warn without a stack', () => {
    const { body } = run(new ConflictException('busy'));
    expect(body).toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
      message: 'busy',
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).not.toHaveProperty('stack');
    expect(error).not.toHaveBeenCalled();
  });

  it('logs 5xx AppExceptions at error with the stack', () => {
    const exception = new InternalServerException('boom');
    const { body } = run(exception);
    expect(body).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
    });
    expect(body).not.toHaveProperty('details');
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        message: 'boom',
        stack: exception.stack,
      }),
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('turns a bare Error into INTERNAL_SERVER_ERROR and logs it with the stack', () => {
    const exception = new Error('TEST_INTERNAL');
    const { status, body } = run(exception);
    expect(status).toHaveBeenCalledWith(500);
    expect(body).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      statusCode: 500,
      message: 'Internal server error',
    });
    expect(body).not.toHaveProperty('details');
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'TEST_INTERNAL',
        stack: exception.stack,
      }),
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'AppException with a custom code and internal details',
      exception: new AppException(500, 'TEST_APP_INTERNAL', 'TEST_FAILURE', {
        diagnostic: 'TEST_APP_DETAILS',
      }),
      statusCode: 500,
      code: 'TEST_FAILURE',
      logMessage: 'TEST_APP_INTERNAL',
    },
    {
      name: 'HttpException 503 with internal validation details',
      exception: new HttpException(
        {
          message: 'TEST_HTTP_INTERNAL',
          errors: [{ diagnostic: 'TEST_HTTP_DETAILS' }],
        },
        503,
      ),
      statusCode: 503,
      code: 'HTTP_EXCEPTION',
      logMessage: 'TEST_HTTP_INTERNAL',
    },
  ])('redacts $name while preserving diagnostics in the error log', (test) => {
    const { status, body } = run(test.exception);
    expect(status).toHaveBeenCalledWith(test.statusCode);
    expect(body).toEqual({
      statusCode: test.statusCode,
      message: 'Internal server error',
      code: test.code,
      timestamp: expect.any(String) as unknown,
      path: '/api/v1/things',
    });
    expect(body).not.toHaveProperty('details');
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith({
      method: 'POST',
      path: '/api/v1/things',
      statusCode: test.statusCode,
      message: test.logMessage,
      code: test.code,
      stack: test.exception.stack,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'a string', value: 'TEST_NON_ERROR' },
    { name: 'an object', value: { diagnostic: 'TEST_NON_ERROR_OBJECT' } },
    { name: 'null', value: null },
    { name: 'undefined', value: undefined },
  ])(
    'redacts non-Error throws ($name) and logs the original value without a stack',
    ({ value }) => {
      const { status, body } = run(value);
      expect(status).toHaveBeenCalledWith(500);
      expect(body).toEqual({
        statusCode: 500,
        message: 'Internal server error',
        code: 'INTERNAL_SERVER_ERROR',
        timestamp: expect.any(String) as unknown,
        path: '/api/v1/things',
      });
      expect(body).not.toHaveProperty('details');
      expect(error).toHaveBeenCalledWith({
        method: 'POST',
        path: '/api/v1/things',
        statusCode: 500,
        message: value,
        code: 'INTERNAL_SERVER_ERROR',
        stack: null,
      });
      expect(warn).not.toHaveBeenCalled();
    },
  );
});
