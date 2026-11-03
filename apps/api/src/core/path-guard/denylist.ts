import {
  isFullyQualifiedPath,
  isSameOrInside,
  pathApi,
  toComparable,
} from '@/common/utils/path.util';
import type { PathPlatform } from '@/common/utils/path.util';
import type {
  DenyScope,
  IDenyEntry,
} from '@/core/path-guard/interfaces/path-guard.types';

// Tên thư mục hệ thống ở gốc MỌI ổ đĩa Windows (chữ thường) — cấm cả cây.
export const WIN32_DRIVE_LEVEL_SUBTREE_NAMES = [
  'windows',
  'program files',
  'program files (x86)',
  'programdata',
  '$recycle.bin',
  'system volume information',
  'recovery',
];
// Ở gốc ổ chỉ cấm chính nó (con vẫn được phép): X:\Users.
const WIN32_DRIVE_LEVEL_SELF_NAMES = ['users'];
const WIN32_SYSTEM_ENV_KEYS = [
  'SystemRoot',
  'windir',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'ProgramData',
];

export interface IDenylistSources {
  platform: PathPlatform;
  env: Record<string, string | undefined>; // Windows: truyền thẳng process.env (không phân biệt hoa thường)
  homeDir: string;
  appInstallDir: string;
  sourceCheckoutDir: string | null;
  dataDir: string;
}

// D10: denylist cứng, không cấu hình tắt được.
export const buildDenylist = (sources: IDenylistSources): IDenyEntry[] => {
  const { platform } = sources;
  const entries: IDenyEntry[] = [];
  const add = (
    value: string | null | undefined,
    scope: DenyScope,
    reason: string,
  ) => {
    if (!value || !isFullyQualifiedPath(value, platform)) return;
    entries.push({ path: toComparable(value, platform), scope, reason });
  };
  if (platform === 'win32') {
    for (const key of WIN32_SYSTEM_ENV_KEYS) {
      add(sources.env[key], 'subtree', `system folder %${key}%`);
    }
  }
  add(sources.homeDir, 'self', 'user profile folder');
  add(
    pathApi(platform).dirname(sources.homeDir),
    'self',
    'folder that holds user profiles',
  );
  add(sources.appInstallDir, 'subtree', 'PkgSteward installation folder');
  add(sources.sourceCheckoutDir, 'subtree', 'PkgSteward source repository');
  add(sources.dataDir, 'subtree', 'PkgSteward data folder');
  return entries;
};

const firstSegment = (target: string, platform: PathPlatform) => {
  const api = pathApi(platform);
  const { root } = api.parse(target);
  const segments = target.slice(root.length).split(api.sep).filter(Boolean);
  return { root, segments };
};

/** Lý do bị cấm, hoặc null. `target` ở dạng toComparable. Cấm: chính mục, cha của mục, con của mục "subtree". */
export const findDenyMatch = (
  target: string,
  entries: IDenyEntry[],
  platform: PathPlatform,
): string | null => {
  const { root, segments } = firstSegment(target, platform);
  if (segments.length === 0) {
    return platform === 'win32' ? `drive root ${root}` : 'filesystem root';
  }
  if (platform === 'win32') {
    if (WIN32_DRIVE_LEVEL_SUBTREE_NAMES.includes(segments[0])) {
      return `system folder ${root}${segments[0]}`;
    }
    if (
      segments.length === 1 &&
      WIN32_DRIVE_LEVEL_SELF_NAMES.includes(segments[0])
    ) {
      return `folder that holds user profiles ${target}`;
    }
  }
  for (const entry of entries) {
    if (target === entry.path) return entry.reason;
    if (
      entry.scope === 'subtree' &&
      isSameOrInside(target, entry.path, platform)
    ) {
      return entry.reason;
    }
    // Xoá cha = xoá luôn mục được bảo vệ.
    if (isSameOrInside(entry.path, target, platform))
      return `parent of ${entry.reason}`;
  }
  return null;
};

/** Scanner (M1b) cắt nhánh: true với mục "cả cây" và con của chúng; gốc ổ, Users, profile → false. */
export const isInsideProtectedTree = (
  target: string,
  entries: IDenyEntry[],
  platform: PathPlatform,
): boolean => {
  if (platform === 'win32') {
    const { segments } = firstSegment(target, platform);
    if (
      segments.length > 0 &&
      WIN32_DRIVE_LEVEL_SUBTREE_NAMES.includes(segments[0])
    ) {
      return true;
    }
  }
  return entries.some(
    (entry) =>
      entry.scope === 'subtree' && isSameOrInside(target, entry.path, platform),
  );
};
