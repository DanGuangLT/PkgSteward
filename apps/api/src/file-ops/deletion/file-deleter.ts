import type {
  DeleteErrorCode,
  DeleteOutcome,
  FileOpsKind,
} from '@/file-ops/interfaces/file-ops.types';
import type { IRecycleBin } from '@/platform/interfaces/recycle-bin.interface';
import {
  errorCode,
  methodForKind,
} from '@/file-ops/assessment/file-ops-targets';

/** Q8: do not follow junctions, retry, or silently accept a missing target. */
export const PERMANENT_RM_OPTIONS = Object.freeze({
  recursive: true,
  force: false,
  maxRetries: 0,
} as const);

export interface IFileDeleterDeps {
  rm(path: string, options: typeof PERMANENT_RM_OPTIONS): Promise<void>;
  recycleBin: IRecycleBin;
}

export interface IDeleteTargetInput {
  /** Guarded path with identity checked by execute immediately before deletion. */
  path: string;
  kind: FileOpsKind;
  /** Preview measurement; used only for recycling. */
  apparentBytes: number;
}

/** Deletes exactly one target. Never throws or retries. */
export async function deleteTarget(
  input: IDeleteTargetInput,
  deps: IFileDeleterDeps,
): Promise<DeleteOutcome> {
  const method = methodForKind(input.kind);
  if (method === 'recycle') {
    const failed = {
      method,
      status: 'failed',
      errorCode: 'RECYCLE_FAILED',
      mayBePartial: false,
    } as const;
    if (!Number.isSafeInteger(input.apparentBytes) || input.apparentBytes < 0) {
      return failed;
    }
    try {
      const result = await deps.recycleBin.recycle(
        input.path,
        input.apparentBytes,
      );
      return result.status === 'recycled'
        ? { method, status: 'success' }
        : { ...failed, errorCode: result.code };
    } catch {
      // A broken adapter contract must never trigger permanent deletion.
      return failed;
    }
  }

  try {
    await deps.rm(input.path, PERMANENT_RM_OPTIONS);
    return { method, status: 'success' };
  } catch (error: unknown) {
    let code: DeleteErrorCode;
    switch (errorCode(error)) {
      case 'EBUSY':
        code = 'FILE_IN_USE';
        break;
      case 'EPERM':
      case 'EACCES':
        code = 'ACCESS_DENIED';
        break;
      case 'ENOENT':
        code = 'TARGET_GONE';
        break;
      case 'ENAMETOOLONG':
        code = 'PATH_TOO_LONG';
        break;
      default:
        code = 'DELETE_FAILED';
    }
    return {
      method,
      status: 'failed',
      errorCode: code,
      mayBePartial: code !== 'TARGET_GONE',
    };
  }
}
