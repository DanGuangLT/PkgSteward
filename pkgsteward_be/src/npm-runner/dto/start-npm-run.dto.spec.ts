import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { StartNpmRunDto } from './start-npm-run.dto';
import { RunnerPathQueryDto } from './runner-path-query.dto';
import { RunIdParamDto } from './run-id-param.dto';
import { RunLogQueryDto } from './run-log-query.dto';

const base = {
  path: 'D:\\TEST\\project',
  inputHash: 'a'.repeat(64),
  requestId: '00000000-0000-4000-8000-000000000001',
};
const options = { whitelist: true, forbidNonWhitelisted: true };
const errors = (body: Record<string, unknown>) =>
  validateSync(plainToInstance(StartNpmRunDto, body), options);

describe('StartNpmRunDto admission boundary', () => {
  it.each([
    { action: 'install_all' },
    { action: 'install_one', package: '@scope/pkg@1.2.3' },
    { action: 'update_all' },
    { action: 'update_one', package: 'alpha' },
    { action: 'uninstall_one', package: 'alpha' },
    { action: 'script', script: 'dev' },
  ])('accepts the exact fields for $action', (fields) => {
    expect(errors({ ...base, ...fields })).toEqual([]);
  });

  it.each(['install_all', 'update_all', 'script'])(
    '%s forbids package, including null',
    (action) => {
      for (const value of ['alpha', null, 1, '']) {
        expect(
          errors({
            ...base,
            action,
            package: value,
            ...(action === 'script' ? { script: 'dev' } : {}),
          }),
        ).not.toEqual([]);
      }
    },
  );
  it.each(['install_one', 'update_one', 'uninstall_one'])(
    '%s requires a string package and forbids script',
    (action) => {
      for (const value of [undefined, null, 1, [], {}, '']) {
        expect(errors({ ...base, action, package: value })).not.toEqual([]);
      }
      expect(
        errors({ ...base, action, package: 'alpha', script: 'dev' }),
      ).not.toEqual([]);
    },
  );
  it.each([undefined, null, 1, [], {}, ''])(
    'script requires a nonempty string: %p',
    (script) => {
      expect(errors({ ...base, action: 'script', script })).not.toEqual([]);
    },
  );
  it.each([
    'install_all',
    'install_one',
    'update_all',
    'update_one',
    'uninstall_one',
  ])('%s forbids any script field', (action) => {
    const fields = ['install_one', 'update_one', 'uninstall_one'].includes(
      action,
    )
      ? { package: 'alpha' }
      : {};
    expect(errors({ ...base, action, ...fields, script: null })).not.toEqual(
      [],
    );
  });
  it.each([
    { action: 'exec' },
    { action: 1 },
    { action: null },
    { action: 'install_all', args: ['--global'] },
    { action: 'install_all', confirm: true },
    { action: 'install_all', cwd: 'C:\\Windows' },
    { action: 'install_all', inputHash: 'A'.repeat(64) },
    { action: 'install_all', inputHash: 'a'.repeat(63) },
    {
      action: 'install_all',
      requestId: '00000000-0000-1000-8000-000000000001',
    },
    { action: 'install_all', requestId: 42 },
  ])('rejects malformed or extra properties: %p', (fields) => {
    expect(errors({ ...base, ...fields })).not.toEqual([]);
  });

  it.each([
    '',
    '.',
    'C:relative',
    '\\rooted',
    '\\\\host\\share',
    '\\\\?\\C:\\TEST',
    'D:\\a\\..\\b',
    'D:/a/../b',
    'D:\\x\0',
    'D:\\x\r',
    'D:\\x\n',
    '/posix',
    42,
    null,
    'D:\\' + 'x'.repeat(32765),
  ])('rejects unsafe path %p', (path) => {
    expect(
      validateSync(plainToInstance(RunnerPathQueryDto, { path }), options),
    ).not.toEqual([]);
  });
  it('accepts a local Unicode path at the 32767 character boundary', () => {
    expect(
      validateSync(
        plainToInstance(RunnerPathQueryDto, {
          path: 'D:\\' + 'ệ'.repeat(32764),
        }),
        options,
      ),
    ).toEqual([]);
  });
  it('validates UUID route parameters', () => {
    expect(
      validateSync(
        plainToInstance(RunIdParamDto, { id: base.requestId }),
        options,
      ),
    ).toEqual([]);
    expect(
      validateSync(plainToInstance(RunIdParamDto, { id: 'latest' }), options),
    ).not.toEqual([]);
    expect(
      validateSync(
        plainToInstance(RunIdParamDto, { id: base.requestId, extra: true }),
        options,
      ),
    ).not.toEqual([]);
  });
  it.each([undefined, 0, 1, Number.MAX_SAFE_INTEGER, '0', '42'])(
    'accepts cursor %p without unsafe numeric conversion',
    (cursor) => {
      const dto = plainToInstance(
        RunLogQueryDto,
        cursor === undefined ? {} : { cursor },
      );
      expect(validateSync(dto, options)).toEqual([]);
      expect(dto.cursor).toBe(cursor === undefined ? 0 : Number(cursor));
    },
  );
  it.each([
    -1,
    0.5,
    Number.MAX_SAFE_INTEGER + 1,
    '-1',
    '1e2',
    '1.0',
    '',
    ' 1',
    '0x10',
    true,
    null,
    [],
    {},
  ])('rejects cursor %p', (cursor) => {
    expect(
      validateSync(plainToInstance(RunLogQueryDto, { cursor }), options),
    ).not.toEqual([]);
  });
  it('forbids log query extras and does not coerce action fields', () => {
    expect(
      validateSync(
        plainToInstance(RunLogQueryDto, { cursor: 0, limit: 100 }),
        options,
      ),
    ).not.toEqual([]);
    const dto = plainToInstance(StartNpmRunDto, {
      ...base,
      action: 'install_one',
      package: 42,
    });
    expect(dto.package).toBe(42);
    expect(validateSync(dto, options)).not.toEqual([]);
  });
});
