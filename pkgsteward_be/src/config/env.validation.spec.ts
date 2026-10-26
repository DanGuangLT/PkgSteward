import 'reflect-metadata';
import { validateEnv } from '@/config/env.validation';

describe('validateEnv', () => {
  describe('EXPORT_SWAGGER_API_JSON', () => {
    it('defaults to true', () =>
      expect(validateEnv({}, 'win32').EXPORT_SWAGGER_API_JSON).toBe(true));
    it.each([
      [true, true],
      [false, false],
      ['true', true],
      ['false', false],
      [' FALSE ', false],
      ['True', true],
    ])('reads %p as %p', (value, expected) =>
      expect(
        validateEnv({ EXPORT_SWAGGER_API_JSON: value }, 'win32')
          .EXPORT_SWAGGER_API_JSON,
      ).toBe(expected),
    );
    it.each(['yes', '1', ''])('rejects %p', (value) =>
      expect(() =>
        validateEnv({ EXPORT_SWAGGER_API_JSON: value }, 'win32'),
      ).toThrow(/EXPORT_SWAGGER_API_JSON must be true or false/),
    );
  });

  describe('MAX_SCAN_DEPTH', () => {
    it('defaults to 0 (no depth limit) when not set', () => {
      expect(validateEnv({}).MAX_SCAN_DEPTH).toBe(0);
    });

    it('accepts 0 and positive depth limits', () => {
      expect(validateEnv({ MAX_SCAN_DEPTH: '0' }).MAX_SCAN_DEPTH).toBe(0);
      expect(validateEnv({ MAX_SCAN_DEPTH: '6' }).MAX_SCAN_DEPTH).toBe(6);
    });

    it('rejects a negative depth', () => {
      expect(() => validateEnv({ MAX_SCAN_DEPTH: '-1' })).toThrow(
        /MAX_SCAN_DEPTH must be 0 \(no limit\) or a positive integer/,
      );
    });
  });

  describe('HOST', () => {
    it('defaults to 127.0.0.1 (C5)', () =>
      expect(validateEnv({}, 'win32').HOST).toBe('127.0.0.1'));
    it.each(['localhost', '127.0.0.1', '::1'])('accepts %s', (host) =>
      expect(validateEnv({ HOST: host }, 'win32').HOST).toBe(host),
    );
    it('normalises case and spaces', () =>
      expect(validateEnv({ HOST: ' LocalHost ' }, 'win32').HOST).toBe(
        'localhost',
      ));
    it.each(['0.0.0.0', '192.168.1.10', 'example.com', ''])(
      'rejects %p',
      (host) =>
        expect(() => validateEnv({ HOST: host }, 'win32')).toThrow(
          /HOST must be one of: localhost, 127\.0\.0\.1, ::1/,
        ),
    );
  });

  describe('SCAN_TIMEOUT_MS', () => {
    it('defaults to undefined (no time limit) when not set', () =>
      expect(validateEnv({}, 'win32').SCAN_TIMEOUT_MS).toBeUndefined());
    it.each(['', '  '])('treats %p as no time limit', (value) =>
      expect(
        validateEnv({ SCAN_TIMEOUT_MS: value }, 'win32').SCAN_TIMEOUT_MS,
      ).toBeUndefined(),
    );
    it('accepts 1000', () =>
      expect(
        validateEnv({ SCAN_TIMEOUT_MS: '1000' }, 'win32').SCAN_TIMEOUT_MS,
      ).toBe(1000));
    it.each(['999', '0', '-1', 'abc'])(
      'rejects %s and explains how to remove the time limit',
      (v) =>
        expect(() => validateEnv({ SCAN_TIMEOUT_MS: v }, 'win32')).toThrow(
          /SCAN_TIMEOUT_MS must be at least 1000 \(1 second\); leave it empty for no time limit/,
        ),
    );
    it('rejects a fractional timeout', () =>
      expect(() => validateEnv({ SCAN_TIMEOUT_MS: '1000.5' }, 'win32')).toThrow(
        /SCAN_TIMEOUT_MS must be an integer/,
      ));
  });

  describe('NPM_COMMAND_TIMEOUT_MS', () => {
    it('defaults to undefined (no time limit) when not set', () =>
      expect(validateEnv({}, 'win32').NPM_COMMAND_TIMEOUT_MS).toBeUndefined());
    it.each(['', '  '])('treats %p as no time limit', (value) =>
      expect(
        validateEnv({ NPM_COMMAND_TIMEOUT_MS: value }, 'win32')
          .NPM_COMMAND_TIMEOUT_MS,
      ).toBeUndefined(),
    );
    it('accepts 1000', () =>
      expect(
        validateEnv({ NPM_COMMAND_TIMEOUT_MS: '1000' }, 'win32')
          .NPM_COMMAND_TIMEOUT_MS,
      ).toBe(1000));
    it.each(['999', '0', '-1', 'abc'])(
      'rejects %s and explains how to remove the time limit',
      (value) =>
        expect(() =>
          validateEnv({ NPM_COMMAND_TIMEOUT_MS: value }, 'win32'),
        ).toThrow(
          /NPM_COMMAND_TIMEOUT_MS must be at least 1000 \(1 second\); leave it empty for no time limit/,
        ),
    );
    it('rejects a fractional timeout', () =>
      expect(() =>
        validateEnv({ NPM_COMMAND_TIMEOUT_MS: '1000.5' }, 'win32'),
      ).toThrow(/NPM_COMMAND_TIMEOUT_MS must be an integer/));
  });

  describe('SCAN_ROOT_PATHS', () => {
    it.each([undefined, '', '  '])('%p means "*"', (v) =>
      expect(
        validateEnv(v === undefined ? {} : { SCAN_ROOT_PATHS: v }, 'win32')
          .SCAN_ROOT_PATHS,
      ).toBe('*'),
    );
    it('rejects "*" mixed with paths', () =>
      expect(() =>
        validateEnv({ SCAN_ROOT_PATHS: '*,D:\\x' }, 'win32'),
      ).toThrow(/SCAN_ROOT_PATHS.*must be used alone/));
    it('rejects relative paths', () =>
      expect(() =>
        validateEnv({ SCAN_ROOT_PATHS: 'projects' }, 'win32'),
      ).toThrow(/SCAN_ROOT_PATHS.*absolute/));
    it('accepts absolute paths', () =>
      expect(
        validateEnv({ SCAN_ROOT_PATHS: 'D:\\a,E:\\b' }, 'win32')
          .SCAN_ROOT_PATHS,
      ).toBe('D:\\a,E:\\b'));
  });

  describe('PKGSTEWARD_DATA_DIR', () => {
    it.each([undefined, ''])('%p is treated as unset', (v) =>
      expect(
        validateEnv(v === undefined ? {} : { PKGSTEWARD_DATA_DIR: v }, 'win32')
          .PKGSTEWARD_DATA_DIR,
      ).toBeUndefined(),
    );
    it('accepts an absolute path', () =>
      expect(
        validateEnv({ PKGSTEWARD_DATA_DIR: 'D:\\pkg-data' }, 'win32')
          .PKGSTEWARD_DATA_DIR,
      ).toBe('D:\\pkg-data'));
    it('rejects a relative path', () =>
      expect(() =>
        validateEnv({ PKGSTEWARD_DATA_DIR: 'data' }, 'win32'),
      ).toThrow(/PKGSTEWARD_DATA_DIR must be an absolute path/));
  });
});
