import type {
  IGuardedPath,
  PathCheckResult,
  ProtectedTreeMatcher,
} from '@/core/path-guard/interfaces/path-guard.types';

export interface IPathGuardService {
  check(inputPath: string): Promise<PathCheckResult>;
  assertAllowed(inputPath: string): Promise<IGuardedPath>;
  isInsideProtectedTree(absolutePath: string): Promise<boolean>;
  /** Chụp denylist một lần cho một lần quét; chỉ để cắt nhánh, không dùng để cấp quyền. */
  createProtectedTreeMatcher(): Promise<ProtectedTreeMatcher>;
}
