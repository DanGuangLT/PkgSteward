import 'reflect-metadata';
import type { ArgumentsHost } from '@nestjs/common';
import {
  BadRequestException,
  Logger,
  NotFoundException as NestNotFoundException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { IsString } from 'class-validator';
import {
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

  it('logs 4xx AppExceptions at warn without a stack', () => {
    const { body } = run(new ConflictException('busy'));
    expect(body).toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).not.toHaveProperty('stack');
    expect(error).not.toHaveBeenCalled();
  });

  it('logs 5xx AppExceptions at error with the stack', () => {
    run(new InternalServerException('boom'));
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        stack: expect.any(String) as unknown,
      }),
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('turns a bare Error into INTERNAL_SERVER_ERROR and logs it with the stack', () => {
    const { status, body } = run(new Error('kaboom'));
    expect(status).toHaveBeenCalledWith(500);
    expect(body).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'kaboom',
    });
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ stack: expect.any(String) as unknown }),
    );
  });

  it('handles non-Error throws', () =>
    expect(run('weird').body).toMatchObject({
      statusCode: 500,
      message: 'Internal Server Error',
    }));
});
