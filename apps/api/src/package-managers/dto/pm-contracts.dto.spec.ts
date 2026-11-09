import { plainToInstance } from 'class-transformer';
import type { ClassConstructor } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PmProjectQueryDto } from '@/package-managers/dto/pm-project-query.dto';
import { PmVersionsDto } from '@/package-managers/dto/pm-versions.dto';
import { PmPreviewDto } from '@/package-managers/dto/pm-preview.dto';
import { PmExecuteDto } from '@/package-managers/dto/pm-execute.dto';
import { PmJobIdDto } from '@/package-managers/dto/pm-job-id.dto';

const requestId = '00000000-0000-4000-8000-000000000001';
const previewId = '00000000-0000-4000-8000-000000000002';
const path = 'D:\\TEST\\m9';
const base = { requestId, path, manager: 'npm' };
const consent = { requestId, previewId, confirm: true };
const errors = <T extends object>(type: ClassConstructor<T>, body: object) =>
  validateSync(
    plainToInstance(type, body, { enableImplicitConversion: false }),
    { whitelist: true, forbidNonWhitelisted: true },
  );

describe('package manager HTTP input', () => {
  it('accepts project context, all public catalogs, and supported pin targets', () => {
    expect(errors(PmProjectQueryDto, { path })).toEqual([]);
    for (const manager of ['npm', 'pnpm', 'yarn'])
      expect(errors(PmVersionsDto, { ...base, manager })).toEqual([]);
    for (const targetVersion of ['11.2.0', 'latest', 'next-11'])
      expect(errors(PmPreviewDto, { ...base, targetVersion })).toEqual([]);
    expect(
      errors(PmPreviewDto, {
        ...base,
        manager: 'yarn',
        targetVersion: '1.22.22',
      }),
    ).not.toEqual([]);
  });
  it.each([
    undefined,
    null,
    '',
    1,
    'bad',
    '00000000-0000-1000-8000-000000000001',
  ])('rejects non-v4 ID %p', (id) => {
    expect(errors(PmVersionsDto, { ...base, requestId: id })).not.toEqual([]);
    expect(errors(PmExecuteDto, { ...consent, requestId: id })).not.toEqual([]);
    expect(errors(PmExecuteDto, { ...consent, previewId: id })).not.toEqual([]);
    expect(errors(PmJobIdDto, { id })).not.toEqual([]);
  });
  it.each([
    undefined,
    null,
    '',
    1,
    'relative',
    'C:relative',
    'D:\\TEST\\..\\secret',
    'D:\\x\0',
    'D:\\x\r',
    'D:\\x\n',
    `D:\\${'x'.repeat(32765)}`,
  ])('rejects unsafe path %p', (value) => {
    expect(errors(PmProjectQueryDto, { path: value })).not.toEqual([]);
    expect(errors(PmVersionsDto, { ...base, path: value })).not.toEqual([]);
  });
  it('accepts the path length boundary without normalizing client input', () => {
    expect(
      errors(PmProjectQueryDto, { path: `D:\\${'x'.repeat(32764)}` }),
    ).toEqual([]);
  });
  it.each(['corepack', 'NPM', null, 1])(
    'rejects unsupported manager %p',
    (manager) => {
      expect(errors(PmVersionsDto, { ...base, manager })).not.toEqual([]);
    },
  );
  it.each([
    undefined,
    null,
    '',
    1,
    '^11.0.0',
    'v11.0.0',
    '11',
    'file:x',
    'npm@11.0.0',
    '--force',
    'latest ',
    'x'.repeat(129),
    '11.0.0;echo',
  ])('rejects target syntax %p', (targetVersion) => {
    expect(errors(PmPreviewDto, { ...base, targetVersion })).not.toEqual([]);
  });
  it.each([
    { tool: 'x' },
    { toolPath: 'x' },
    { args: [] },
    { argv: [] },
    { env: {} },
    { config: {} },
    { registry: 'https://example.invalid' },
    { package: 'other' },
  ])('rejects client execution/routing fields %p', (extra) => {
    expect(errors(PmVersionsDto, { ...base, ...extra })).not.toEqual([]);
    expect(
      errors(PmPreviewDto, { ...base, targetVersion: 'latest', ...extra }),
    ).not.toEqual([]);
    expect(errors(PmExecuteDto, { ...consent, ...extra })).not.toEqual([]);
  });
  it('requires literal consent and permits absent optional consent fields', () => {
    expect(errors(PmExecuteDto, consent)).toEqual([]);
    expect(
      errors(PmExecuteDto, {
        ...consent,
        acknowledgedRisks: ['RECENTLY_ACTIVE'],
        confirmText: '',
      }),
    ).toEqual([]);
    for (const confirm of [undefined, null, false, 'true', 1])
      expect(errors(PmExecuteDto, { ...consent, confirm })).not.toEqual([]);
  });
  it.each([
    null,
    'RECENTLY_ACTIVE',
    [1],
    Array<string>(33).fill('RECENTLY_ACTIVE'),
    ['x'.repeat(65)],
  ])('rejects malformed acknowledgements %p', (acknowledgedRisks) => {
    expect(errors(PmExecuteDto, { ...consent, acknowledgedRisks })).not.toEqual(
      [],
    );
  });
  it.each([null, 1, [], 'x'.repeat(1025)])(
    'rejects malformed optional text %p',
    (confirmText) => {
      expect(errors(PmExecuteDto, { ...consent, confirmText })).not.toEqual([]);
    },
  );
  it('forbids execute facts and query/polling extras', () => {
    for (const extra of [
      { path },
      { targetVersion: '11.2.0' },
      { manager: 'npm' },
      { risk: {} },
    ])
      expect(errors(PmExecuteDto, { ...consent, ...extra })).not.toEqual([]);
    expect(errors(PmProjectQueryDto, { path, requestId })).not.toEqual([]);
    expect(errors(PmJobIdDto, { id: previewId, cursor: 0 })).not.toEqual([]);
    expect(errors(PmJobIdDto, { id: previewId })).toEqual([]);
  });
});
