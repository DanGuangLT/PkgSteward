import 'reflect-metadata';
import { validateEnv } from '@/config/env.validation';

describe('validateEnv', () => {
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
});
