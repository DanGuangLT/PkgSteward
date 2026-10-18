import {
  ForbiddenException,
  InternalServerException,
  NotFoundException,
  ValidationException,
} from '@/common/exceptions/app.exception';
import {
  hasTraversalSegment,
  isFullyQualifiedPath,
  isSameOrInside,
  pathApi,
  toComparable,
} from '@/common/utils/path.util';
import type { PathPlatform } from '@/common/utils/path.util';
import type { ScanRoots } from '@/config/scan-roots';
import {
  findDenyMatch,
  isInsideProtectedTree,
} from '@/core/path-guard/denylist';
import type {
  IDenyEntry,
  IGuardedPath,
  IPathGuardFs,
  PathCheckFailureCode,
  PathCheckResult,
} from '@/core/path-guard/interfaces/path-guard.types';
import type { IDriveDetector } from '@/platform/interfaces/drive-detector.interface';

export interface IPathGuardDeps {
  platform: PathPlatform;
  scanRoots: ScanRoots;
  driveDetector: IDriveDetector;
  denylist: IDenyEntry[];
  fs: IPathGuardFs;
}

type PathCheckFailure = Extract<PathCheckResult, { allowed: false }>;

const fail = (
  code: PathCheckFailureCode,
  message: string,
): PathCheckFailure => ({
  allowed: false,
  code,
  message,
});

// D10: path.resolve → kiểm → realpath → kiểm lại (bắt junction/symlink, tên 8.3) → lstat.
export class PathGuard {
  constructor(private readonly deps: IPathGuardDeps) {}

  async check(inputPath: string): Promise<PathCheckResult> {
    const { platform, fs } = this.deps;
    if (
      typeof inputPath !== 'string' ||
      inputPath.trim() === '' ||
      inputPath.includes('\0')
    ) {
      return fail('INVALID_PATH', 'Path must be a non-empty string');
    }
    if (!isFullyQualifiedPath(inputPath, platform)) {
      const hint =
        platform === 'win32'
          ? ' with a drive letter (e.g. D:\\Projects\\app)'
          : '';
      return fail('INVALID_PATH', `Path must be absolute${hint}: ${inputPath}`);
    }
    if (hasTraversalSegment(inputPath)) {
      return fail(
        'INVALID_PATH',
        `Path must not contain ".." segments: ${inputPath}`,
      );
    }

    const resolvedPath = pathApi(platform).resolve(inputPath);
    const roots = await this.allowedRoots();
    const denylist = await this.effectiveDenylist();
    const lexical = this.evaluate(resolvedPath, roots, denylist, '');
    if (lexical) return lexical;

    let realPath: string;
    try {
      realPath = await fs.realpath(resolvedPath);
    } catch (error) {
      return this.handleFsError(error, resolvedPath);
    }
    const real = this.evaluate(
      realPath,
      roots,
      denylist,
      ' (after resolving links)',
    );
    if (real) return real;

    try {
      const stats = await fs.lstat(resolvedPath);
      return {
        allowed: true,
        path: {
          inputPath,
          resolvedPath,
          realPath,
          isSymbolicLink: stats.isSymbolicLink(),
        },
      };
    } catch (error) {
      return this.handleFsError(error, resolvedPath);
    }
  }

  async assertAllowed(inputPath: string): Promise<IGuardedPath> {
    const result = await this.check(inputPath);
    if (result.allowed) return result.path;
    switch (result.code) {
      case 'INVALID_PATH':
        throw new ValidationException(result.message);
      case 'NOT_FOUND':
        throw new NotFoundException(`Path "${inputPath}"`);
      default:
        throw new ForbiddenException(result.message);
    }
  }

  isInsideProtectedTree(absolutePath: string): boolean {
    const { platform, denylist } = this.deps;
    return isInsideProtectedTree(
      toComparable(absolutePath, platform),
      denylist,
      platform,
    );
  }

  private evaluate(
    absolutePath: string,
    roots: string[],
    denylist: IDenyEntry[],
    suffix: string,
  ): PathCheckFailure | null {
    const { platform } = this.deps;
    const target = toComparable(absolutePath, platform);
    const reason = findDenyMatch(target, denylist, platform);
    if (reason) {
      return fail(
        'DENYLISTED',
        `Path is protected (${reason})${suffix}: ${absolutePath}`,
      );
    }
    if (!roots.some((root) => isSameOrInside(target, root, platform))) {
      return fail(
        'OUTSIDE_ALLOWLIST',
        `Path is outside SCAN_ROOT_PATHS${suffix}: ${absolutePath}`,
      );
    }
    return null;
  }

  private handleFsError(
    error: unknown,
    absolutePath: string,
  ): PathCheckFailure {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return fail('NOT_FOUND', `Path does not exist: ${absolutePath}`);
    }
    throw new InternalServerException(
      `Cannot access path ${absolutePath}: ${(error as Error).message}`,
    );
  }

  // Bảo vệ cả đích thật của junction để không thể truy cập vòng qua tên khác.
  private async effectiveDenylist(): Promise<IDenyEntry[]> {
    const { denylist, fs, platform } = this.deps;
    const result = [...denylist];
    for (const entry of denylist) {
      try {
        const realPath = toComparable(await fs.realpath(entry.path), platform);
        if (realPath !== entry.path) result.push({ ...entry, path: realPath });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // Chỉ bỏ qua entry không tồn tại; lỗi khác phải chặn toàn bộ kiểm tra.
        if (code === 'ENOENT' || code === 'ENOTDIR') continue;
        throw new InternalServerException(
          `Cannot resolve protected path ${entry.path}: ${(error as Error).message}`,
        );
      }
    }
    return result;
  }

  // Allowlist = gốc quét (hoặc mọi ổ cố định với "*") + đích thật của gốc (gốc có thể là junction).
  private async allowedRoots(): Promise<string[]> {
    const { scanRoots, driveDetector, fs, platform } = this.deps;
    const roots =
      scanRoots.kind === 'all-fixed-drives'
        ? await driveDetector.listFixedDrives()
        : scanRoots.paths;
    const result = new Set<string>();
    for (const root of roots) {
      result.add(toComparable(root, platform));
      try {
        result.add(toComparable(await fs.realpath(root), platform));
      } catch {
        // D5: gốc không tồn tại → bỏ qua, không làm lỗi.
      }
    }
    return [...result];
  }
}
