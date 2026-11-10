import * as semver from 'semver';

export const SUPPORTED_RUNNER_MAJORS = {
  npm: [11, 12],
  pnpm: [11],
} as const;

/** Pure installed-runner policy; pin targets apply their stricter checks too. */
export function isSupportedRunnerVersion(
  manager: string,
  version: string,
): boolean {
  if (manager !== 'npm' && manager !== 'pnpm') return false;
  const parsed = semver.parse(version);
  if (!parsed) return false;
  const canonical =
    parsed.version + (parsed.build.length ? `+${parsed.build.join('.')}` : '');
  if (canonical !== version) return false;
  return (
    SUPPORTED_RUNNER_MAJORS[manager].some((major) => major === parsed.major) &&
    !(manager === 'npm' && parsed.major === 12 && parsed.prerelease.length > 0)
  );
}
