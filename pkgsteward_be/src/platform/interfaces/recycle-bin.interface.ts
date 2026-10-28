export const RECYCLE_BIN = Symbol('RECYCLE_BIN');

export type RecycleFailureCode =
  | 'RECYCLE_BIN_DISABLED'
  | 'RECYCLE_BIN_TOO_SMALL'
  | 'RECYCLE_UNAVAILABLE'
  | 'RECYCLE_FAILED';

export type RecycleResult =
  | { status: 'recycled' }
  | { status: 'failed'; code: RecycleFailureCode; message: string };

export interface IRecycleBin {
  /** Recycles a guarded, non-link target. Never permanently deletes or throws. */
  recycle(targetPath: string, apparentBytes: number): Promise<RecycleResult>;
}
