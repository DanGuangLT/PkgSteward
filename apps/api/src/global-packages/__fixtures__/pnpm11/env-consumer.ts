// TEST không phải yêu cầu nghiệp vụ. Pinned pnpm 11.22.0 env-consumer subset.
// parseEnvVars:166491-166508; constructors:166555-166583; types2:168242-168245.
export const PNPM11_EMITTED_ENV_SCHEMA: Readonly<
  Partial<Record<string, 'string' | 'path' | 'boolean'>>
> = {
  'npmrc-auth-file': 'path', // 168168: path66
  'cache-dir': 'string', // 168096: String
  'state-dir': 'string', // 168204: String
  'config-dir': 'string', // 168102: String
  'verify-deps-before-run': 'boolean', // 168216: Boolean
  'update-notifier': 'boolean', // 168232: Boolean
};

export function consumePnpm11Environment(
  environment: Readonly<NodeJS.ProcessEnv>,
): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (
      value === undefined ||
      !/^pnpm_config_[a-z0-9]+(?:_[a-z0-9]+)*$/.test(key)
    )
      continue;
    const suffix = key.slice('pnpm_config_'.length);
    const schema = PNPM11_EMITTED_ENV_SCHEMA[suffix.replace(/_/g, '-')];
    if (!schema) continue;
    const parsed =
      schema === 'boolean'
        ? value === 'true'
          ? true
          : value === 'false'
            ? false
            : undefined
        : value;
    if (parsed === undefined) continue;
    result[
      suffix.replace(/_([a-z0-9])/g, (_match: string, char: string) =>
        char.toUpperCase(),
      )
    ] = parsed;
  }
  return result;
}
