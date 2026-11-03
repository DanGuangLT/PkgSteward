import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  createHostOriginMiddleware,
  parseAllowedOrigins,
} from '@/common/middleware/host-origin.middleware';
import { setupAppConfig } from '@/config/app-setup.config';
import { setupCors } from '@/config/cors.config';
import SwaggerConfig from '@/config/swagger.config';
import { validationConfig } from '@/config/validation.config';

// Mặc định 100 KB của Express không đủ cho lô 1.000 path của FileOps.
export const JSON_BODY_LIMIT = '10mb';

export interface IConfiguredApp {
  globalPrefix: string;
  version: string;
  swaggerEnabled: boolean;
}

// Dùng chung cho main.ts và e2e để test đúng thứ tự thật.
export const configureApp = (app: INestApplication): IConfiguredApp => {
  const configService = app.get(ConfigService);

  // D6: Host/Origin guard gắn TRƯỚC Swagger và mọi route.
  app.use(
    createHostOriginMiddleware({
      allowedOrigins: parseAllowedOrigins(
        configService.get<string>('LIST_ORIGIN_CORS'),
      ),
    }),
  );

  // Sau guard: request bị từ chối không tốn công đọc body.
  (app as NestExpressApplication).useBodyParser('json', {
    limit: JSON_BODY_LIMIT,
  });

  const swaggerEnabled = configService.get<string>('MODE') === 'development';
  if (swaggerEnabled) SwaggerConfig.setup(app);

  // Setup versioning (mặc định v1) và global prefix (mặc định api)
  const { globalPrefix, version } = setupAppConfig(app);

  // Custom Validation Pipe với format error chuẩn theo field
  validationConfig(app);

  // Setup CORS cho frontend Next.js kết nối
  setupCors(app);

  return { globalPrefix, version, swaggerEnabled };
};
