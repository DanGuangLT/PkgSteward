import type {
  IRunRequest,
  IRunnerCommand,
  IRunnerInput,
  IRunnerPackageSpec,
} from '@/npm-runner/interfaces/npm-runner.types';
import { AppException } from '@/common/exceptions/app.exception';
import * as semver from 'semver';
import { RUN_ACTIONS } from '@/npm-runner/interfaces/npm-runner.types';
import { isSupportedRunnerVersion } from '@/npm-runner/toolchain/runner-version-policy';

export const isRunnerScriptName = (name: string): boolean =>
  name.trim() === name && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(name);
const invalidPackage = (): never => {
  throw new AppException(
    400,
    'Unsupported registry package spec',
    'VALIDATION_ERROR',
    { reason: 'INVALID_PACKAGE_SPEC' },
  );
};

export function parseRunnerPackageSpec(
  value: string,
  allowVersion: boolean,
): IRunnerPackageSpec {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\0') ||
    /[\s"'`%!^&|<>();\\]/.test(value)
  )
    return invalidPackage();
  const split = value.indexOf('@', value.startsWith('@') ? 1 : 0);
  const name = split < 0 ? value : value.slice(0, split);
  const version = split < 0 ? null : value.slice(split + 1);
  if (
    name.length > 214 ||
    name.includes('..') ||
    !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)
  )
    return invalidPackage();
  if (
    version !== null &&
    (!allowVersion ||
      !version ||
      version.length > 128 ||
      (!semver.valid(version) && !/^[a-z][a-z0-9-]{0,63}$/.test(version)))
  )
    return invalidPackage();
  return { name, version, spec: value };
}

export function buildRunCommand(
  context: IRunnerInput,
  input: IRunRequest,
): IRunnerCommand {
  const fail = (reason: string): never => {
    throw new AppException(
      400,
      'Unsupported runner command',
      'VALIDATION_ERROR',
      { reason },
    );
  };
  const { manager, tool, path: cwd } = context;
  if (manager !== 'npm' && manager !== 'pnpm')
    return fail('UNSUPPORTED_MANAGER');
  if (context.reason) return fail(context.reason);
  if (!tool) return fail('TOOL_NOT_FOUND');
  if (tool.manager !== manager) return fail('UNSUPPORTED_MANAGER');
  if (!isSupportedRunnerVersion(manager, tool.version))
    return fail('TOOL_VERSION_MISMATCH');
  if (!RUN_ACTIONS.includes(input.action)) return fail('INVALID_PACKAGE_SPEC');
  if (context.workspace.kind === 'leaf' && input.action !== 'script')
    return fail('WORKSPACE_LEAF');
  const packageAction = ['install_one', 'update_one', 'uninstall_one'].includes(
    input.action,
  );
  if (
    (!packageAction && Object.hasOwn(input, 'package')) ||
    (input.action !== 'script' && Object.hasOwn(input, 'script'))
  )
    return fail('INVALID_PACKAGE_SPEC');
  let spec: string | undefined;
  if (packageAction) {
    const parsed = parseRunnerPackageSpec(
      input.package ?? '',
      input.action === 'install_one',
    );
    spec = parsed.spec;
    if (
      input.action !== 'install_one' &&
      !context.manifest.dependencies.some(
        (item) => item.name === parsed.name && item.declarations.length > 0,
      )
    )
      return fail('INVALID_PACKAGE_SPEC');
  }
  const script = input.script ?? '';
  if (input.action === 'script') {
    if (!isRunnerScriptName(script)) return fail('SCRIPT_NAME_UNSUPPORTED');
    if (
      !Object.hasOwn(context.scripts, script) ||
      typeof context.scripts[script] !== 'string' ||
      !context.scripts[script].trim()
    )
      return fail('SCRIPT_NOT_FOUND');
  }
  const npm = manager === 'npm';
  const args = npm
    ? [
        '--prefix',
        cwd,
        '--global=false',
        '--no-audit',
        '--no-fund',
        '--no-progress',
        '--update-notifier=false',
      ]
    : // pnpm 11.22 (RT1): only add/update accept --global (set below); the
      // version switch is pm-on-fail, default "download" when a pin exists.
      // update-notifier / verify-deps-before-run go through the child env.
      ['--dir', cwd, '--pm-on-fail=warn'];
  switch (input.action) {
    case 'install_all':
      args.push(
        ...(npm
          ? ['install']
          : ['install', '--no-frozen-lockfile', '--reporter=append-only']),
      );
      break;
    case 'install_one':
      args.push(
        ...(npm
          ? ['install', '--save-prod', '--', spec!]
          : [
              'add',
              '--global=false',
              '--save-prod',
              '--reporter=append-only',
              '--',
              spec!,
            ]),
      );
      break;
    case 'update_all':
      args.push(
        ...(npm
          ? ['update']
          : ['update', '--global=false', '--reporter=append-only']),
      );
      break;
    case 'update_one':
      args.push(
        ...(npm
          ? ['update', '--', spec!]
          : [
              'update',
              '--global=false',
              '--reporter=append-only',
              '--',
              spec!,
            ]),
      );
      break;
    case 'uninstall_one':
      args.push(
        ...(npm
          ? ['uninstall', '--', spec!]
          : ['remove', '--reporter=append-only', '--', spec!]),
      );
      break;
    case 'script':
      args.push(...(npm ? ['run-script', '--', script] : ['run', script]));
      break;
  }
  if (tool.entry) args.unshift(tool.entry);
  return { file: tool.file, args, cwd, manager, version: tool.version };
}
