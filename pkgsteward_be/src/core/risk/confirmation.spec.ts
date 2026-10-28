import {
  InternalServerException,
  ValidationException,
} from '@/common/exceptions/app.exception';
import { validateConfirmation } from '@/core/risk/confirmation';
import type {
  IConfirmationInput,
  IRisk,
} from '@/core/risk/interfaces/risk.types';

const low: IRisk = {
  level: 'low',
  reasons: [{ code: 'ORPHAN_NODE_MODULES', level: 'low', message: 'Orphan' }],
};
const medium: IRisk = {
  level: 'medium',
  reasons: [
    { code: 'NO_LOCKFILE', level: 'medium', message: 'No lockfile' },
    { code: 'ORPHAN_NODE_MODULES', level: 'low', message: 'Orphan' },
  ],
};
const high: IRisk = {
  level: 'high',
  reasons: [
    { code: 'DELETE_WHOLE_PROJECT', level: 'high', message: 'Whole project' },
    ...medium.reasons,
  ],
};
const allHighCodes = [
  'DELETE_WHOLE_PROJECT',
  'NO_LOCKFILE',
  'ORPHAN_NODE_MODULES',
];

function expectValidation(
  risk: IRisk,
  expectedText: string | null,
  input: IConfirmationInput,
  message: string,
  details: Record<string, unknown>,
): void {
  let thrown: unknown;
  try {
    validateConfirmation(risk, expectedText, input);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ValidationException);
  expect(thrown).toMatchObject({
    statusCode: 400,
    code: 'VALIDATION_ERROR',
    message,
    details,
  });
  expect((thrown as ValidationException).details).toEqual(details);
}

describe('validateConfirmation', () => {
  describe.each([low, medium, high])('$level risk', (risk) => {
    it.each(
      [undefined, null, false, 'true', 1, {}, []].map((value) => ({ value })),
    )(
      'rejects confirm=$value before checking acknowledgements or text',
      ({ value: confirm }) => {
        expectValidation(risk, null, { confirm }, 'Confirmation is required', {
          field: 'confirm',
        });
      },
    );
  });

  it('allows low risk with only boolean confirmation', () => {
    expect(validateConfirmation(low, null, { confirm: true })).toBeUndefined();
  });

  it('ignores malformed acknowledgements and text for low risk', () => {
    expect(
      validateConfirmation(low, 'unused', {
        confirm: true,
        acknowledgedRisks: 42,
        confirmText: { unexpected: true },
      }),
    ).toBeUndefined();
  });

  describe.each([medium, high])('$level acknowledgements', (risk) => {
    it.each(
      [undefined, null, 'NO_LOCKFILE', 1, {}, [1], ['NO_LOCKFILE', null]].map(
        (value) => ({ value }),
      ),
    )(
      'rejects non-string-array acknowledgements $value before text',
      ({ value: acknowledgedRisks }) => {
        expectValidation(
          risk,
          null,
          { confirm: true, acknowledgedRisks },
          'acknowledgedRisks must be an array of risk codes',
          { field: 'acknowledgedRisks' },
        );
      },
    );

    it('reports every missing code in reason order for an empty array', () => {
      expectValidation(
        risk,
        null,
        { confirm: true, acknowledgedRisks: [] },
        'Every risk must be acknowledged',
        {
          field: 'acknowledgedRisks',
          missingRisks:
            risk.level === 'high'
              ? ['DELETE_WHOLE_PROJECT', 'NO_LOCKFILE', 'ORPHAN_NODE_MODULES']
              : ['NO_LOCKFILE', 'ORPHAN_NODE_MODULES'],
        },
      );
    });

    it('requires low-level reasons too and does not count unknown codes as acknowledgement', () => {
      expectValidation(
        risk,
        null,
        {
          confirm: true,
          acknowledgedRisks: ['DELETE_WHOLE_PROJECT', 'NO_LOCKFILE', 'UNKNOWN'],
        },
        'Every risk must be acknowledged',
        {
          field: 'acknowledgedRisks',
          missingRisks: ['ORPHAN_NODE_MODULES'],
        },
      );
    });

    it('accepts reordered, duplicated and unknown extra codes', () => {
      expect(
        validateConfirmation(risk, 'DELETE 1', {
          confirm: true,
          acknowledgedRisks: [
            'ORPHAN_NODE_MODULES',
            'UNKNOWN',
            'NO_LOCKFILE',
            'NO_LOCKFILE',
            'DELETE_WHOLE_PROJECT',
          ],
          confirmText: 'DELETE 1',
        }),
      ).toBeUndefined();
    });
  });

  it('reports a missing middle reason in a high-risk request', () => {
    expectValidation(
      high,
      'DELETE 1',
      {
        confirm: true,
        acknowledgedRisks: ['ORPHAN_NODE_MODULES', 'DELETE_WHOLE_PROJECT'],
        confirmText: 'DELETE 1',
      },
      'Every risk must be acknowledged',
      {
        field: 'acknowledgedRisks',
        missingRisks: ['NO_LOCKFILE'],
      },
    );
  });

  it('ignores confirmText for medium risk even if an expected string exists', () => {
    expect(
      validateConfirmation(medium, 'unused', {
        confirm: true,
        acknowledgedRisks: ['NO_LOCKFILE', 'ORPHAN_NODE_MODULES'],
        confirmText: 42,
      }),
    ).toBeUndefined();
  });

  it('accepts medium risk without text or an expected string', () => {
    expect(
      validateConfirmation(medium, null, {
        confirm: true,
        acknowledgedRisks: ['NO_LOCKFILE', 'ORPHAN_NODE_MODULES'],
      }),
    ).toBeUndefined();
  });

  it('rejects missing server text as an internal error after acknowledgements pass', () => {
    let thrown: unknown;
    try {
      validateConfirmation(high, null, {
        confirm: true,
        acknowledgedRisks: allHighCodes,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InternalServerException);
    expect(thrown).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Confirmation text is not available',
    });
    expect((thrown as InternalServerException).details).toBeUndefined();
  });

  it.each([
    undefined,
    null,
    1,
    true,
    {},
    'delete 1',
    'DELETE 2',
    ' DELETE 1',
    'DELETE 1 ',
    'DELETE 1\n',
  ])('rejects high-risk text %j unless it matches exactly', (confirmText) => {
    expectValidation(
      high,
      'DELETE 1',
      {
        confirm: true,
        acknowledgedRisks: allHighCodes,
        confirmText,
      },
      'Confirmation text does not match',
      { field: 'confirmText' },
    );
  });

  it.each(['DELETE 1', 'Dự án thử', ' project ', ''])(
    'accepts the exact server text %j',
    (text) => {
      expect(
        validateConfirmation(high, text, {
          confirm: true,
          acknowledgedRisks: allHighCodes,
          confirmText: text,
        }),
      ).toBeUndefined();
    },
  );
});
