import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { configureApp } from '@/config/configure-app';

// "::1" phải viết "[::1]" trong URL.
const formatHostForUrl = (host: string) =>
  host.includes(':') ? `[${host}]` : host;

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);

  // Cho phép đóng app an toàn và giải phóng tài nguyên khi có tín hiệu terminate
  app.enableShutdownHooks();

  const { globalPrefix, version, swaggerEnabled } = configureApp(app);

  const host = configService.get<string>('HOST') ?? '127.0.0.1';
  const port = configService.get<number>('PORT') ?? 24681;

  await app.listen(port, host);

  const baseUrl = `http://${formatHostForUrl(host)}:${port}`;
  logger.log(
    `Application is running on: ${baseUrl}/${globalPrefix}/v${version}`,
  );
  if (swaggerEnabled) {
    logger.log(`Swagger is running on: ${baseUrl}/swagger`);
  }
}

bootstrap().catch((err) => {
  new Logger('Bootstrap').error('Failed to start application', err);
  process.exit(1);
});
