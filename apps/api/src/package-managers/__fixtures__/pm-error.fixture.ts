import { AppException } from '@/common/exceptions/app.exception';

export interface IExpectedPmAppError {
  statusCode?: number;
  code?: string;
  details?: Record<string, unknown>;
}

export function expectPmAppError(
  action: () => unknown,
  expected: IExpectedPmAppError,
): AppException {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AppException);
  const error = caught as AppException;
  if (expected.statusCode !== undefined) {
    expect(error.statusCode).toBe(expected.statusCode);
  }
  if (expected.code !== undefined) {
    expect(error.code).toBe(expected.code);
  }
  if (expected.details !== undefined) {
    expect(error.details).toEqual(expected.details);
  }
  return error;
}
