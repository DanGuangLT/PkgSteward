import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ClearRecoveryHoldDto } from '@/npm-runner/dto/clear-recovery-hold.dto';

const options = { whitelist: true, forbidNonWhitelisted: true };
const validateBody = (body: Record<string, unknown>) =>
  validateSync(plainToInstance(ClearRecoveryHoldDto, body), options);

describe('ClearRecoveryHoldDto', () => {
  it('accepts exact { confirm: true }', () => {
    expect(validateBody({ confirm: true })).toEqual([]);
  });

  it.each([
    {},
    { confirm: false },
    { confirm: null },
    { confirm: 'true' },
    { confirm: 1 },
    { confirm: true, extra: 'blocked' },
  ])('rejects %p', (body) => {
    expect(validateBody(body)).not.toEqual([]);
  });
});
