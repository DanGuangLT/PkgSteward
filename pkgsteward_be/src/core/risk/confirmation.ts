import {
  InternalServerException,
  ValidationException,
} from '@/common/exceptions/app.exception';
import type {
  IConfirmationInput,
  IRisk,
} from '@/core/risk/interfaces/risk.types';

export function validateConfirmation(
  risk: IRisk,
  expectedConfirmText: string | null,
  input: IConfirmationInput,
): void {
  if (input.confirm !== true) {
    throw new ValidationException('Confirmation is required', {
      field: 'confirm',
    });
  }

  if (risk.level === 'low') return;

  const { acknowledgedRisks } = input;
  if (
    !Array.isArray(acknowledgedRisks) ||
    Array.from(acknowledgedRisks).some(
      (code: unknown) => typeof code !== 'string',
    )
  ) {
    throw new ValidationException(
      'acknowledgedRisks must be an array of risk codes',
      { field: 'acknowledgedRisks' },
    );
  }

  const acknowledged = new Set<unknown>(acknowledgedRisks);
  const missingRisks = risk.reasons
    .map(({ code }) => code)
    .filter((code) => !acknowledged.has(code));
  if (missingRisks.length > 0) {
    throw new ValidationException('Every risk must be acknowledged', {
      field: 'acknowledgedRisks',
      missingRisks,
    });
  }

  if (risk.level === 'high') {
    if (expectedConfirmText === null) {
      throw new InternalServerException('Confirmation text is not available');
    }
    if (input.confirmText !== expectedConfirmText) {
      throw new ValidationException('Confirmation text does not match', {
        field: 'confirmText',
      });
    }
  }
}
