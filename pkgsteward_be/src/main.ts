import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import SwaggerConfig from '@/config/swagger.config';
import { setupCors } from '@/config/cors.config';
import { validationConfig } from '@/config/validation.config';
import { setupAppConfig } from '@/config/app-setup.config';
import * as os from 'os';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);

  // Cho phép đóng app an toàn và giải phóng tài nguyên khi có tín hiệu terminate
  app.enableShutdownHooks();

  if (configService.get<string>('MODE') === 'development') {
    SwaggerConfig.setup(app);
    logger.log('Swagger documentation is enabled in development mode');
  }

  // Setup versioning (mặc định v1) và global prefix (mặc định api)
  const { globalPrefix, version } = setupAppConfig(app);

  // Custom Validation Pipe với format error chuẩn theo field
  validationConfig(app);

  // Setup CORS cho frontend Next.js kết nối
  setupCors(app);

  const host = configService.get<string>('HOST') ?? 'localhost';
  const port = configService.get<number>('PORT') ?? 8080;
  const lanIp = Object.values(os.networkInterfaces())
    .flat()
    .find((iface) => iface?.family === 'IPv4' && !iface.internal)?.address;

  await app.listen(port, host);

  logger.log(
    `Application is running on: http://${host}:${port}/${globalPrefix}/v${version}`,
  );
  logger.log(`Swagger is running on: http://${host}:${port}/swagger`);
  if (lanIp) {
    logger.log(
      `Application is also accessible on local network at: http://${lanIp}:${port}/${globalPrefix}/v${version}`,
    );
  }
}

bootstrap().catch((err) => {
  new Logger('Bootstrap').error('Failed to start application', err);
  process.exit(1);
});
