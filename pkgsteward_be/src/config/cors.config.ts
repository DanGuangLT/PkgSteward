import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const setupCors = (app: INestApplication) => {
  const configService: ConfigService = app.get(ConfigService);
  const originCors = configService
    .get<string>('LIST_ORIGIN_CORS')
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: originCors ?? false, // Allow requests only from the specified origins in the environment variable LIST_ORIGIN_CORS. If not set, CORS is disabled.
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: false, // Không có cookie/auth (D6)
  });
};
