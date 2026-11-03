import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { AppPathsService } from '@/core/app-paths/app-paths.service';

// Swagger JSON is a development export next to the backend installation.
export const exportSwaggerJson = (
  outputDir: string,
  enabled: boolean,
  createDocument: () => OpenAPIObject,
): void => {
  const logger = new Logger('SwaggerConfig');
  const filePath = join(outputDir, 'swagger.json');
  if (enabled) {
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(filePath, JSON.stringify(createDocument(), null, 2));
    logger.log(`Swagger JSON exported to ${filePath}`);
    return;
  }
  if (existsSync(filePath)) {
    unlinkSync(filePath);
    logger.log('Swagger JSON file deleted because export is disabled.');
  }
};

export default class SwaggerConfig {
  public static setup = (app: INestApplication): void => {
    const configService: ConfigService = app.get(ConfigService);
    const config = new DocumentBuilder()
      .setTitle('PkgSteward API')
      .setDescription(
        'API backend cho ứng dụng quản lý dự án npm/Node.js local',
      )
      .setVersion(`version ${configService.get<string>('VERSION') || '1'}`)
      .build();

    const documentFactory = () =>
      SwaggerModule.createDocument(app, config, {
        deepScanRoutes: false,
      });

    exportSwaggerJson(
      join(app.get(AppPathsService).appInstallDir, 'docs_API'),
      configService.get<boolean>('EXPORT_SWAGGER_API_JSON') === true,
      documentFactory,
    );

    SwaggerModule.setup('swagger', app, documentFactory, {
      jsonDocumentUrl: '/swagger-json',
      yamlDocumentUrl: '/swagger-yaml',
    });
  };
}
