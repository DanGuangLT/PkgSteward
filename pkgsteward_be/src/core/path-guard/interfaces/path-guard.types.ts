export type DenyScope = 'self' | 'subtree';

export interface IDenyEntry {
  path: string; // dạng toComparable
  scope: DenyScope; // self: chỉ chính nó (và cha); subtree: cả cây (và cha)
  reason: string;
}

export type PathCheckFailureCode =
  'INVALID_PATH' | 'NOT_FOUND' | 'DENYLISTED' | 'OUTSIDE_ALLOWLIST';

export interface IGuardedPath {
  inputPath: string;
  resolvedPath: string; // path.resolve của input (giữ hoa thường gốc)
  realPath: string; // fs.realpath — đã đi qua junction/symlink
  isSymbolicLink: boolean; // lstat(resolvedPath); junction cũng là symlink trong Node
}

export type PathCheckResult =
  | { allowed: true; path: IGuardedPath }
  | { allowed: false; code: PathCheckFailureCode; message: string };

export interface IPathGuardFs {
  realpath(filePath: string): Promise<string>;
  lstat(filePath: string): Promise<{ isSymbolicLink(): boolean }>;
}
