import type {
  IGuardedPath,
  PathChecker,
  PathCheckResult,
  ProtectedTreeMatcher,
} from '@/core/path-guard/interfaces/path-guard.types';

export interface IPathGuardService {
  checkMany(inputPaths: readonly string[]): Promise<PathCheckResult[]>;
  createOperationChecker(): PathChecker;
  check(inputPath: string): Promise<PathCheckResult>;
  assertAllowed(inputPath: string): Promise<IGuardedPath>;
  findDenyReason(absolutePath: string): Promise<string | null>;
  isInsideProtectedTree(absolutePath: string): Promise<boolean>;
  /** Chụp denylist một lần cho một lần quét; chỉ để cắt nhánh, không dùng để cấp quyền. */
  createProtectedTreeMatcher(): Promise<ProtectedTreeMatcher>;
  reloadScanRoots(rawScanRootPaths: string | undefined): void;
}
