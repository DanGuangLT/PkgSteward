import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { ClassConstructor } from 'class-transformer';
import {
  GlobalActivityDto,
  GlobalVersionsDto,
} from '@/global-packages/dto/global-activity.dto';
import { GlobalPreviewDto } from '@/global-packages/dto/global-preview.dto';
import { GlobalExecuteDto } from '@/global-packages/dto/global-execute.dto';
import { GlobalJobIdDto } from '@/global-packages/dto/global-job-id.dto';
import { GlobalLogQueryDto } from '@/global-packages/dto/global-log-query.dto';

const requestId = '00000000-0000-4000-8000-000000000001';
const previewId = '00000000-0000-4000-8000-000000000002';
const base = { requestId, manager: 'npm', package: '@test/tool' };
const consent = {
  requestId,
  previewId,
  confirm: true,
  acknowledgedRisks: ['MACHINE_WIDE'],
  confirmText: 'REMOVE GLOBAL npm @test/tool',
};
const errors = <T extends object>(type: ClassConstructor<T>, body: object) =>
  validateSync(
    plainToInstance(type, body, { enableImplicitConversion: false }),
    {
      whitelist: true,
      forbidNonWhitelisted: true,
    },
  );

describe('global activity DTO contracts', () => {
  it('accepts only a UUID v4 requestId for inventory', () => {
    expect(errors(GlobalActivityDto, { requestId })).toEqual([]);
    expect(
      errors(GlobalActivityDto, { requestId, manager: 'npm' }),
    ).not.toEqual([]);
  });
  it.each([
    undefined,
    null,
    1,
    '',
    'bad',
    '00000000-0000-1000-8000-000000000001',
  ])('rejects invalid requestId %p', (value) => {
    expect(errors(GlobalActivityDto, { requestId: value })).not.toEqual([]);
    expect(
      errors(GlobalExecuteDto, { ...consent, requestId: value }),
    ).not.toEqual([]);
    expect(
      errors(GlobalExecuteDto, { ...consent, previewId: value }),
    ).not.toEqual([]);
    expect(errors(GlobalJobIdDto, { id: value })).not.toEqual([]);
  });
  it.each(['npm', 'pnpm'])('accepts %s versions input', (manager) => {
    expect(errors(GlobalVersionsDto, { ...base, manager })).toEqual([]);
  });
  it.each(['yarn', 'corepack', 'NPM', '', null, 1])(
    'rejects manager %p',
    (manager) => {
      expect(errors(GlobalVersionsDto, { ...base, manager })).not.toEqual([]);
    },
  );
  it.each(['tool', '@test/tool', 'a.b-c_d'])(
    'accepts registry name %s',
    (name) => {
      expect(errors(GlobalVersionsDto, { ...base, package: name })).toEqual([]);
    },
  );
  it.each([
    undefined,
    null,
    1,
    [],
    {},
    '',
    'tool@1.2.3',
    'tool@latest',
    'npm:other',
    '../tool',
    'file:tool',
    'https://test.invalid/tool',
    'git+https://test.invalid/tool',
    '--global',
    'tool;echo',
    ' tool',
    'TOOL',
    '@test',
    'a..b',
    'a'.repeat(215),
  ])('rejects non-registry name %p', (name) => {
    expect(errors(GlobalVersionsDto, { ...base, package: name })).not.toEqual(
      [],
    );
  });
  it.each([
    { path: 'D:\\TEST' },
    { args: ['--global'] },
    { env: {} },
    { script: 'install' },
    { cwd: 'D:\\TEST' },
    { confirm: true },
    { targetVersion: '1.2.3' },
    { action: 'remove' },
  ])('versions rejects forbidden fields %p', (extra) => {
    expect(errors(GlobalVersionsDto, { ...base, ...extra })).not.toEqual([]);
  });
});

describe('global preview DTO discriminants', () => {
  it('accepts remove without a target', () => {
    expect(errors(GlobalPreviewDto, { ...base, action: 'remove' })).toEqual([]);
  });
  it.each(['1.2.3', '1.2.3-beta.1', '1.2.3+build.1', 'latest', 'next-1'])(
    'accepts change target %s',
    (targetVersion) => {
      expect(
        errors(GlobalPreviewDto, { ...base, action: 'change', targetVersion }),
      ).toEqual([]);
    },
  );
  it.each([
    undefined,
    null,
    '',
    1,
    [],
    {},
    '1',
    '^1.2.3',
    '~1.2.3',
    '*',
    '>=1.0.0',
    'v1.2.3',
    'file:x',
    'npm:x',
    'git+x',
    '--force',
    ' latest',
    'tool@1.2.3',
    'x'.repeat(129),
    '1.2.3;echo',
  ])('rejects change target %p', (targetVersion) => {
    expect(
      errors(GlobalPreviewDto, { ...base, action: 'change', targetVersion }),
    ).not.toEqual([]);
  });
  it.each([undefined, null, '1.2.3', 'latest', '', 1])(
    'forbids even present empty remove target %p',
    (targetVersion) => {
      expect(
        errors(GlobalPreviewDto, { ...base, action: 'remove', targetVersion }),
      ).not.toEqual([]);
    },
  );
  it('rejects an absent change target', () => {
    expect(errors(GlobalPreviewDto, { ...base, action: 'change' })).not.toEqual(
      [],
    );
  });
  it.each([null, 1, 'install', 'update', 'REMOVE'])(
    'rejects action %p',
    (action) => {
      expect(errors(GlobalPreviewDto, { ...base, action })).not.toEqual([]);
    },
  );
  it.each([
    { confirm: true },
    { acknowledgedRisks: [] },
    { previewId },
    { path: 'D:\\TEST' },
  ])('rejects extra preview fields %p', (extra) => {
    expect(
      errors(GlobalPreviewDto, { ...base, action: 'remove', ...extra }),
    ).not.toEqual([]);
  });
});

describe('global execute and polling DTO contracts', () => {
  it('accepts only server-preview identity and consent fields', () => {
    expect(errors(GlobalExecuteDto, consent)).toEqual([]);
    expect(errors(GlobalJobIdDto, { id: previewId })).toEqual([]);
  });
  it.each([undefined, null, false, 'true', 1])(
    'requires literal true: %p',
    (confirm) => {
      expect(errors(GlobalExecuteDto, { ...consent, confirm })).not.toEqual([]);
    },
  );
  it.each([
    undefined,
    null,
    'MACHINE_WIDE',
    [1],
    Array<string>(33).fill('MACHINE_WIDE'),
  ])('rejects malformed acknowledgements %p', (acknowledgedRisks) => {
    expect(
      errors(GlobalExecuteDto, { ...consent, acknowledgedRisks }),
    ).not.toEqual([]);
  });
  it.each([undefined, null, 1, [], 'x'.repeat(1025)])(
    'rejects malformed confirmation text %p',
    (confirmText) => {
      expect(errors(GlobalExecuteDto, { ...consent, confirmText })).not.toEqual(
        [],
      );
    },
  );
  it('does not trim or normalize confirmation text before shared semantic validation', () => {
    const dto = plainToInstance(GlobalExecuteDto, {
      ...consent,
      confirmText: ' REMOVE GLOBAL npm @test/tool ',
    });
    expect(dto.confirmText).toBe(' REMOVE GLOBAL npm @test/tool ');
  });
  it.each([
    { manager: 'npm' },
    { package: 'tool' },
    { action: 'remove' },
    { targetVersion: '1.2.3' },
    { globalRoot: 'D:\\TEST' },
    { risk: { level: 'low' } },
  ])('execute rejects client facts %p', (extra) => {
    expect(errors(GlobalExecuteDto, { ...consent, ...extra })).not.toEqual([]);
  });
  it.each(['0', '42'])('accepts canonical query-string cursor %p', (cursor) => {
    expect(errors(GlobalLogQueryDto, { cursor })).toEqual([]);
    expect(plainToInstance(GlobalLogQueryDto, { cursor }).cursor).toBe(
      Number(cursor),
    );
  });
  it('defaults an absent cursor to zero', () => {
    expect(plainToInstance(GlobalLogQueryDto, {}).cursor).toBe(0);
    expect(errors(GlobalLogQueryDto, {})).toEqual([]);
  });
  it.each([0, 1, Number.MAX_SAFE_INTEGER])(
    'accepts safe integer cursor %p',
    (cursor) => {
      expect(errors(GlobalLogQueryDto, { cursor })).toEqual([]);
    },
  );
  it.each([
    -1,
    0.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    null,
    '-1',
    '1e2',
    ' 1',
    true,
  ])('rejects cursor without coercion %p', (cursor) => {
    expect(errors(GlobalLogQueryDto, { cursor })).not.toEqual([]);
  });
  it('rejects polling extras', () => {
    expect(
      errors(GlobalLogQueryDto, { cursor: 0, path: 'D:\\TEST' }),
    ).not.toEqual([]);
    expect(errors(GlobalJobIdDto, { id: previewId, requestId })).not.toEqual(
      [],
    );
  });
});
