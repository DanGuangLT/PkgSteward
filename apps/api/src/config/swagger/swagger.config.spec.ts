import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { tmpdir } from 'os';
import { join } from 'path';
import { SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import SwaggerConfig, {
  exportSwaggerJson,
} from '@/config/swagger/swagger.config';
import { AppPathsService } from '@/core/app-paths/app-paths.service';

describe('exportSwaggerJson', () => {
  let tmp: string;
  const document = {
    openapi: '3.0.0',
    info: { title: 't', version: '1' },
    paths: {},
  } as OpenAPIObject;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pkgsteward-swagger-'));
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('writes swagger.json into the given folder when enabled', () => {
    const outputDir = join(tmp, 'docs_API');
    exportSwaggerJson(outputDir, true, () => document);
    expect(
      JSON.parse(readFileSync(join(outputDir, 'swagger.json'), 'utf8')),
    ).toEqual(document);
  });

  it('deletes a stale export and never builds the document when disabled', () => {
    const outputDir = join(tmp, 'docs_API');
    mkdirSync(outputDir);
    writeFileSync(join(outputDir, 'swagger.json'), '{}');
    const create = jest.fn(() => document);
    exportSwaggerJson(outputDir, false, create);
    expect(existsSync(join(outputDir, 'swagger.json'))).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('does nothing when disabled and no export exists', () =>
    expect(() =>
      exportSwaggerJson(join(tmp, 'none'), false, () => document),
    ).not.toThrow());
});

describe('SwaggerConfig.setup Tier 3 zero-write guarantee', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pkgsteward-swagger-tier3-'));
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('skips docs_API file export when sourceCheckoutDir is null', () => {
    const setupSpy = jest
      .spyOn(SwaggerModule, 'setup')
      .mockImplementation(() => undefined);
    const app = {
      get: (token: unknown) => {
        if (token === ConfigService) {
          return {
            get: (key: string) =>
              key === 'EXPORT_SWAGGER_API_JSON' ? true : '1',
          };
        }
        if (token === AppPathsService) {
          return { appInstallDir: tmp, sourceCheckoutDir: null };
        }
        return undefined;
      },
    } as unknown as INestApplication;

    try {
      SwaggerConfig.setup(app);
      expect(existsSync(join(tmp, 'docs_API'))).toBe(false);
      expect(setupSpy).toHaveBeenCalledTimes(1);
    } finally {
      setupSpy.mockRestore();
    }
  });
});
