import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { OpenAPIObject } from '@nestjs/swagger';
import { exportSwaggerJson } from '@/config/swagger.config';

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
