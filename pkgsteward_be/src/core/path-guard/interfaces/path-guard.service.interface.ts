import type {
  IGuardedPath,
  PathCheckResult,
} from '@/core/path-guard/interfaces/path-guard.types';

export interface IPathGuardService {
  check(inputPath: string): Promise<PathCheckResult>;
  assertAllowed(inputPath: string): Promise<IGuardedPath>;
  isInsideProtectedTree(absolutePath: string): Promise<boolean>;
}
