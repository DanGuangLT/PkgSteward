import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHostOriginMiddleware,
  parseAllowedOrigins,
} from '@/common/middleware/host-origin.middleware';
import { setupAppConfig } from '@/config/app-setup.config';
import { setupCors } from '@/config/cors.config';
import SwaggerConfig from '@/config/swagger.config';
import { validationConfig } from '@/config/validation.config';

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
