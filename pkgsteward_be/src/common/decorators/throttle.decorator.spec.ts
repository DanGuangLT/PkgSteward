import { Controller, Get } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  PollingEndpoint,
  SkipThrottleAll,
} from '@/common/decorators/throttle.decorator';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import {
  THROTTLER_NAMES,
  ThrottlerConfigModule,
} from '@/core/throttler-config.module';

@Controller('t')
class ProbeController {
  @Get('plain')
  plain() {
    return 'ok';
  }

  @PollingEndpoint()
  @Get('poll')
  poll(this: void) {
    return 'ok';
  }

  @SkipThrottleAll()
  @Get('skip')
  skip(this: void) {
    return 'ok';
  }
}

describe('throttle decorators', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerConfigModule],
      controllers: [ProbeController],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  afterEach(() => app.close());

  const hit = async (path: string, times: number) => {
    const statuses: number[] = [];
    for (let i = 0; i < times; i++)
      statuses.push((await request(app.getHttpServer()).get(path)).status);
    return statuses;
  };

  it('a plain route is rate limited with RATE_LIMITED (short-term: 20 per 10s)', async () => {
    const statuses = await hit('/t/plain', 20);
    expect(statuses.every((s) => s === 200)).toBe(true);
    const res = await request(app.getHttpServer()).get('/t/plain');
    expect(res.status).toBe(429);
    expect((res.body as { code: string }).code).toBe('RATE_LIMITED');
  });

  it.each(['/t/poll', '/t/skip'])('%s skips every throttler', async (path) =>
    expect((await hit(path, 30)).every((s) => s === 200)).toBe(true),
  );

  it.each(['poll', 'skip'] as const)(
    '%s sets skip metadata for every configured throttler',
    (handler) => {
      const reflector = new Reflector();
      for (const name of THROTTLER_NAMES) {
        expect(
          reflector.get<boolean>(
            `THROTTLER:SKIP${name}`,
            ProbeController.prototype[handler],
          ),
        ).toBe(true);
      }
    },
  );
});
