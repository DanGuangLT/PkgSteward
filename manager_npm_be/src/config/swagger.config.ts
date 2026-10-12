import { writeFileSync, mkdirSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export default class SwaggerConfig {
  public static setup = (app: INestApplication): void => {
    const logger = new Logger('SwaggerConfig');
    const configService: ConfigService = app.get(ConfigService);
    const config = new DocumentBuilder()
      .setTitle('Manager NPM API')
      .setDescription(
        'API backend cho ứng dụng quản lý dự án npm/Node.js local',
      )
      .setVersion(`version ${configService.get<string>('VERSION') || '1'}`)
      .build();

    const documentFactory = () =>
      SwaggerModule.createDocument(app, config, {
        deepScanRoutes: false,
      });

    const exportJson =
      configService.get<string>('EXPORT_SWAGGER_API_JSON') === 'true';
    if (exportJson) {
      const document = documentFactory();
      const outputDir = join(process.cwd(), 'docs_API');
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(
        join(outputDir, 'swagger.json'),
        JSON.stringify(document, null, 2),
      );
      logger.log('Swagger JSON exported to docs_API/swagger.json');
    } else {
      const filePath = join(process.cwd(), 'docs_API', 'swagger.json');
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        logger.log('Swagger JSON file deleted because export is disabled.');
      } else {
        logger.log(
          'Swagger JSON export is disabled and no file exists to delete.',
        );
      }
    }

    SwaggerModule.setup('swagger', app, documentFactory, {
      jsonDocumentUrl: '/swagger-json',
      yamlDocumentUrl: '/swagger-yaml',
    });
  };
}
