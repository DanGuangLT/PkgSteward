import type {
  GlobalProbeSpawn,
  IGlobalCommand,
  IGlobalProbeResult,
  IGlobalResolvedLocation,
} from '@/global-packages/interfaces/global-packages.runtime';
import type { GlobalManager } from '@/global-packages/interfaces/global-packages.types';
import type {
  IRunnerFs,
  IRunnerTool,
} from '@/npm-runner/interfaces/npm-runner.types';
import { launchRun } from '@/npm-runner/runner-process';
import type {
  IRunProcess,
  IRunProcessDeps,
  IRunProcessExit,
} from '@/npm-runner/runner-process';
import { win32 } from 'node:path';
import { createHash } from 'node:crypto';
import { AppException } from '@/common/exceptions/app.exception';
import type { GlobalReasonCode } from '@/global-packages/interfaces/global-packages.types';
import {
  assertGlobalConfigUnchanged,
  captureGlobalEnvironment,
  GLOBAL_CONFIG_FILE_LIMIT,
  GLOBAL_CONFIG_TOTAL_LIMIT,
  parseGlobalNpmrc,
} from '@/global-packages/global-config';
import {
  buildGlobalQuery,
  isGlobalAbsolutePath,
} from '@/global-packages/global-command';
import type { GlobalQuery } from '@/global-packages/global-command';
import {
  readRunnerFile,
  resolveRunnerTool,
  revalidateRunnerTool,
} from '@/npm-runner/runner-tool';

const failure = (reason: GlobalReasonCode): AppException =>
  new AppException(409, 'Global location or probe is unavailable', 'CONFLICT', {
    reason,
  });
const comparable = (path: string) => win32.resolve(path).toLowerCase();
const inside = (path: string, parent: string): boolean =>
  comparable(path) === comparable(parent) ||
  comparable(path).startsWith(`${comparable(parent)}\\`);
const overlaps = (a: string, b: string): boolean =>
  inside(a, b) || inside(b, a);
const missing = (error: unknown): boolean =>
  error !== null &&
  typeof error === 'object' &&
  'code' in error &&
  error.code === 'ENOENT';

// Directory enumeration is required by this adapter; the runtime must supply it.
export interface IGlobalDirectoryAccess {
  readdir(path: string): Promise<readonly string[]>;
}
export async function readGlobalDirectory(
  fs: IRunnerFs,
  path: string,
  signal: AbortSignal,
): Promise<readonly string[]> {
  signal.throwIfAborted();
  const directoryFs = fs as unknown as IGlobalDirectoryAccess;
  if (typeof directoryFs.readdir !== 'function')
    throw failure('CONFIG_UNSUPPORTED');
  const rawNames: unknown = await directoryFs.readdir(path);
  signal.throwIfAborted();
  if (!Array.isArray(rawNames) || rawNames.length > 40_000)
    throw failure('CONFIG_UNSUPPORTED');
  const entries: readonly unknown[] = rawNames;
  const names: string[] = [];
  for (const name of entries) {
    if (
      typeof name !== 'string' ||
      !name ||
      /[\\/:]/.test(name) ||
      Array.from(name).some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      ) ||
      name === '.' ||
      name === '..'
    )
      throw failure('CONFIG_UNSUPPORTED');
    names.push(name);
  }
  return names;
}

// M6 owns actual execa launch, output drain and verified process-tree stopping.
export interface IGlobalProbeBindings {
  launch?: typeof launchRun;
  retain?(process: IRunProcess): void;
  launchFailed?(): void;
}
export function createGlobalProbeSpawn(
  tool: IRunnerTool,
  deps: IRunProcessDeps,
  bindings: IGlobalProbeBindings = {},
): GlobalProbeSpawn {
  return async (file, args, options) => {
    options.signal.throwIfAborted();
    if (
      file !== tool.file ||
      args[0] !== tool.entry ||
      !Number.isFinite(options.timeout) ||
      options.timeout <= 0
    )
      throw failure('TOOL_LAYOUT_UNSUPPORTED');
    const stop = new AbortController();
    const signal = AbortSignal.any([options.signal, stop.signal]);
    let timedOut = false;
    let overflowed = false;
    const sizes = { stdout: 0, stderr: 0 };
    const output: Buffer[] = [];
    const timer = deps.clock.setTimeout(() => {
      if (signal.aborted) return;
      timedOut = true;
      stop.abort(new Error('Probe deadline exceeded'));
    }, options.timeout);
    try {
      let process: IRunProcess;
      try {
        process = (bindings.launch ?? launchRun)(
          {
            file,
            args: [...args],
            cwd: options.cwd,
            manager: tool.manager,
            version: tool.version,
          },
          options.env,
          {
            signal,
            onExit: () => undefined,
            onOutput: (stream: 'stdout' | 'stderr', chunk: Buffer) => {
              sizes[stream] += chunk.byteLength;
              if (sizes[stream] > options.maxBuffer[stream]) {
                overflowed = true;
                if (!signal.aborted)
                  stop.abort(new Error('Probe capture limit exceeded'));
              } else if (stream === 'stdout' && !overflowed)
                output.push(Buffer.from(chunk));
            },
          },
          deps,
        );
      } catch (error) {
        bindings.launchFailed?.();
        throw error;
      }
      bindings.retain?.(process);
      const result: IRunProcessExit = await process.settled;
      return {
        stdout: Buffer.concat(output),
        stderr: Buffer.alloc(0),
        exitCode: result.exitCode,
        terminationVerified: result.termination === 'verified',
        overflowed: overflowed || result.outputTruncated,
        timedOut,
      };
    } finally {
      deps.clock.clearTimeout(timer);
    }
  };
}

// Walk every ancestor: checking only a leaf realpath misses replaced junction parents.
export async function assertGlobalDirectory(
  path: string,
  fs: IRunnerFs,
  signal: AbortSignal,
  allowMissing = false,
): Promise<void> {
  if (!isGlobalAbsolutePath(path)) throw failure('LOCATION_AMBIGUOUS');
  const normalized = win32.resolve(path);
  const root = win32.parse(normalized).root;
  let current = root;
  for (const part of normalized.slice(root.length).split('\\')) {
    current = win32.join(current, part);
    signal.throwIfAborted();
    try {
      const stat = await fs.lstat(current);
      signal.throwIfAborted();
      if (stat.isSymbolicLink() || !stat.isDirectory?.())
        throw failure('LOCATION_AMBIGUOUS');
      const real = await fs.realpath(current);
      signal.throwIfAborted();
      if (comparable(real) !== comparable(current))
        throw failure('LOCATION_AMBIGUOUS');
    } catch (error) {
      signal.throwIfAborted();
      if (allowMissing && missing(error)) return;
      throw failure('LOCATION_AMBIGUOUS');
    }
  }
}

export interface IGlobalLocationDeps {
  fs: IRunnerFs;
  environment: Readonly<NodeJS.ProcessEnv>;
  execPath: string;
  paths: {
    cacheDir: string;
    appInstallDir: string;
    sourceCheckoutDir: string | null;
    dataDir: string;
  };
  scannedProjectPaths: readonly string[];
  signal: AbortSignal;
  spawn: GlobalProbeSpawn;
  makeDirectory(path: string): Promise<void>;
}

export async function runGlobalProbe(
  command: IGlobalCommand,
  kind: 'path' | 'list',
  signal: AbortSignal,
  spawn: GlobalProbeSpawn,
): Promise<IGlobalProbeResult> {
  signal.throwIfAborted();
  if (!isGlobalAbsolutePath(command.file) || !Array.isArray(command.args))
    throw failure('TOOL_LAYOUT_UNSUPPORTED');
  const maximum = (kind === 'path' ? 1 : 8) * 1024 * 1024;
  let result: IGlobalProbeResult;
  try {
    result = await spawn(command.file, command.args, {
      cwd: command.cwd,
      env: command.env,
      signal,
      timeout: 30_000,
      maxBuffer: { stdout: maximum, stderr: 64 * 1024 },
      shell: false,
      extendEnv: false,
      stdin: 'ignore',
      encoding: 'buffer',
      reject: false,
    });
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof AppException) throw error;
    throw failure('COMMAND_FAILED');
  }
  if (!result.terminationVerified) throw failure('TERMINATION_UNCONFIRMED');
  signal.throwIfAborted();
  if (result.timedOut) throw failure('TIMED_OUT');
  if (
    result.overflowed ||
    result.stdout.byteLength > maximum ||
    result.stderr.byteLength > 64 * 1024
  )
    throw failure('LIMIT_EXCEEDED');
  if (result.exitCode !== 0) throw failure('COMMAND_FAILED');
  // Stderr is deliberately not propagated: it can contain config values or credentials.
  return { ...result, stderr: Buffer.alloc(0) };
}

async function prepareCwd(deps: IGlobalLocationDeps): Promise<{
  cwd: string;
  ancestorConfigs: IGlobalResolvedLocation['configIdentities'];
}> {
  const cwd = win32.join(deps.paths.cacheDir, 'global-packages-cwd');
  await assertGlobalDirectory(cwd, deps.fs, deps.signal, true);
  const ancestorConfigs: IGlobalResolvedLocation['configIdentities'] = [];
  const budget = { remaining: GLOBAL_CONFIG_TOTAL_LIMIT };
  let ancestor = cwd;
  for (;;) {
    for (const name of [
      'package.json',
      '.npmrc',
      'pnpm-workspace.yaml',
      '.pnpmfile.cjs',
      'pnpmfile.cjs',
      '.pnp.cjs',
    ]) {
      try {
        await deps.fs.lstat(win32.join(ancestor, name));
        deps.signal.throwIfAborted();
        if (name === '.npmrc') {
          const file = win32.join(ancestor, name);
          const data = await readRunnerFile(
            file,
            GLOBAL_CONFIG_FILE_LIMIT,
            deps.fs,
            deps.signal,
            'win32',
            {
              budget,
              checkParent: () =>
                assertGlobalDirectory(ancestor, deps.fs, deps.signal),
            },
          );
          if (
            !data ||
            !parseGlobalNpmrc(data.text).provenanceKnown ||
            /^\s*(?:include|onload-script|pnpmfile|global-pnpmfile)\s*=/im.test(
              data.text,
            )
          )
            throw failure('CONFIG_UNSUPPORTED');
          ancestorConfigs.push({
            file: data.identity,
            sha256: createHash('sha256').update(data.bytes).digest('hex'),
          });
          continue;
        }
        throw failure('CONFIG_UNSUPPORTED');
      } catch (error) {
        deps.signal.throwIfAborted();
        if (!missing(error)) throw error;
      }
    }
    const parent = win32.dirname(ancestor);
    if (ancestor === parent) break;
    ancestor = parent;
  }
  try {
    await deps.fs.lstat(cwd);
  } catch (error) {
    deps.signal.throwIfAborted();
    if (!missing(error)) throw failure('CONFIG_UNSUPPORTED');
    await deps.makeDirectory(cwd);
    deps.signal.throwIfAborted();
  }
  await assertGlobalDirectory(cwd, deps.fs, deps.signal);
  if ((await readGlobalDirectory(deps.fs, cwd, deps.signal)).length !== 0)
    throw failure('CONFIG_UNSUPPORTED');
  return { cwd, ancestorConfigs };
}

function assertLocationScope(path: string, deps: IGlobalLocationDeps): void {
  if (!isGlobalAbsolutePath(path)) throw failure('LOCATION_AMBIGUOUS');
  const root = win32.parse(path).root;
  const forbiddenTrees = [
    'Windows',
    'ProgramData',
    '$Recycle.Bin',
    'System Volume Information',
    'Recovery',
  ];
  if (forbiddenTrees.some((name) => inside(path, win32.join(root, name))))
    throw failure('LOCATION_AMBIGUOUS');
  if (
    ['Program Files', 'Program Files (x86)', 'Users'].some(
      (name) => comparable(path) === comparable(win32.join(root, name)),
    )
  )
    throw failure('LOCATION_AMBIGUOUS');
  const profile = Object.entries(deps.environment).find(
    ([key]) => key.toUpperCase() === 'USERPROFILE',
  )?.[1];
  if (profile && comparable(path) === comparable(profile))
    throw failure('LOCATION_AMBIGUOUS');
  for (const protectedPath of [
    deps.paths.appInstallDir,
    deps.paths.sourceCheckoutDir,
    deps.paths.dataDir,
    ...deps.scannedProjectPaths,
  ])
    if (protectedPath && overlaps(path, protectedPath))
      throw failure('LOCATION_AMBIGUOUS');
}

export async function discoverGlobalLocation(
  manager: GlobalManager,
  deps: IGlobalLocationDeps,
): Promise<IGlobalResolvedLocation> {
  deps.signal.throwIfAborted();
  const captured = captureGlobalEnvironment(deps.environment);
  const snapshot = {
    platform: 'win32' as const,
    execPath: deps.execPath,
    env: deps.environment,
    projectPaths: deps.scannedProjectPaths,
    signal: deps.signal,
  };
  const tool = await resolveRunnerTool(manager, snapshot, deps.fs);
  deps.signal.throwIfAborted();
  await revalidateRunnerTool(tool, deps.fs, deps.signal);
  deps.signal.throwIfAborted();
  const tools = [tool];
  try {
    tools.push(
      await resolveRunnerTool(
        manager === 'npm' ? 'pnpm' : 'npm',
        snapshot,
        deps.fs,
      ),
    );
  } catch (error) {
    deps.signal.throwIfAborted();
    // An absent second manager is not a fallback candidate.
    if (
      !(error instanceof AppException) ||
      ![
        'TOOL_NOT_FOUND',
        'TOOL_VERSION_MISMATCH',
        'TOOL_LAYOUT_UNSUPPORTED',
      ].includes(
        String((error.details as { reason?: string } | undefined)?.reason),
      )
    )
      throw error;
  }
  const { cwd, ancestorConfigs } = await prepareCwd(deps);
  const queries: GlobalQuery[] =
    manager === 'npm'
      ? ['prefix', 'root', 'userconfig', 'globalconfig', 'cache']
      : ['global-dir', 'root', 'bin', 'store', 'userconfig', 'globalconfig'];
  const found = new Map<GlobalQuery, string>();
  for (const query of queries) {
    const result = await runGlobalProbe(
      buildGlobalQuery({
        manager,
        tool,
        cwd,
        environment: deps.environment,
        captured,
        query,
      }),
      'path',
      deps.signal,
      deps.spawn,
    );
    deps.signal.throwIfAborted();
    let path: string;
    try {
      path = new TextDecoder('utf-8', { fatal: true })
        .decode(result.stdout)
        .replace(/\r?\n$/, '');
    } catch {
      throw failure('LOCATION_AMBIGUOUS');
    }
    if (!isGlobalAbsolutePath(path)) throw failure('LOCATION_AMBIGUOUS');
    found.set(query, win32.resolve(path));
  }
  const globalRoot = found.get('root')!;
  const prefix = found.get('prefix') ?? null;
  const globalDir = found.get('global-dir') ?? null;
  const binDir = manager === 'npm' ? prefix! : found.get('bin')!;
  const cacheDir = found.get('cache') ?? null;
  const storeDir = found.get('store') ?? null;
  if (
    comparable(globalRoot) !==
    comparable(win32.join(prefix ?? globalDir!, 'node_modules'))
  )
    throw failure('LOCATION_AMBIGUOUS');
  for (const path of [
    prefix,
    globalDir,
    globalRoot,
    binDir,
    cacheDir,
    storeDir,
  ]) {
    if (path === null) continue;
    assertLocationScope(path, deps);
    await assertGlobalDirectory(path, deps.fs, deps.signal);
  }
  const userConfig = found.get('userconfig')!;
  const globalConfig = found.get('globalconfig')!;
  const overrides: [string | undefined, string | null][] = [
    [captured.npm_config_userconfig, userConfig],
    [captured.npm_config_globalconfig, globalConfig],
    ...((manager === 'npm'
      ? [
          [captured.npm_config_prefix, prefix],
          [captured.npm_config_cache, cacheDir],
        ]
      : [
          [captured.pnpm_config_global_dir, globalDir],
          [captured.pnpm_config_global_bin_dir, binDir],
          [captured.pnpm_config_store_dir, storeDir],
          [captured.PNPM_HOME, binDir],
        ]) as [string | undefined, string | null][]),
  ];
  if (
    overrides.some(
      ([expected, actual]) =>
        expected !== undefined &&
        (actual === null || comparable(expected) !== comparable(actual)),
    )
  )
    throw failure('LOCATION_AMBIGUOUS');
  const configIdentities: IGlobalResolvedLocation['configIdentities'] = [];
  const missingConfigPaths: string[] = [];
  const budget = { remaining: GLOBAL_CONFIG_TOTAL_LIMIT };
  const configs = new Map(
    [userConfig, globalConfig].map((file) => [comparable(file), file]),
  );
  for (const file of configs.values()) {
    await assertGlobalDirectory(
      win32.dirname(file),
      deps.fs,
      deps.signal,
      true,
    );
    try {
      const data = await readRunnerFile(
        file,
        GLOBAL_CONFIG_FILE_LIMIT,
        deps.fs,
        deps.signal,
        'win32',
        {
          optional: true,
          budget,
          checkParent: () =>
            assertGlobalDirectory(win32.dirname(file), deps.fs, deps.signal),
        },
      );
      deps.signal.throwIfAborted();
      if (!data) {
        missingConfigPaths.push(file);
        continue;
      }
      configIdentities.push({
        file: data.identity,
        sha256: createHash('sha256').update(data.bytes).digest('hex'),
      });
    } catch (error) {
      deps.signal.throwIfAborted();
      if (error instanceof AppException) throw error;
      throw failure('CONFIG_UNSUPPORTED');
    }
  }
  await revalidateRunnerTool(tool, deps.fs, deps.signal);
  if (
    ancestorConfigs.some(
      (identity) =>
        ![userConfig, globalConfig].some(
          (path) => comparable(path) === comparable(identity.file.path),
        ),
    )
  )
    throw failure('CONFIG_UNSUPPORTED');
  assertGlobalConfigUnchanged(
    ancestorConfigs,
    configIdentities.filter((identity) =>
      ancestorConfigs.some(
        (ancestor) =>
          comparable(ancestor.file.path) === comparable(identity.file.path),
      ),
    ),
  );
  return {
    manager,
    tool,
    prefix,
    globalDir,
    globalRoot,
    binDir,
    cacheDir,
    storeDir,
    userConfig,
    globalConfig,
    configIdentities,
    missingConfigPaths,
    cwd,
    protectedPaths: [
      ...new Set([
        ...tools.map((installed) => installed.packageDir),
        tool.file,
        deps.paths.appInstallDir,
        ...(deps.paths.sourceCheckoutDir ? [deps.paths.sourceCheckoutDir] : []),
        deps.paths.dataDir,
      ]),
    ],
  };
}

export function assertGlobalLocationsDistinct(
  locations: readonly IGlobalResolvedLocation[],
): void {
  for (let i = 0; i < locations.length; i++) {
    for (let j = i + 1; j < locations.length; j++) {
      const a = locations[i];
      const b = locations[j];
      if (
        a.manager === b.manager ||
        overlaps(a.globalRoot, b.globalRoot) ||
        overlaps(a.binDir, b.binDir) ||
        inside(a.binDir, b.globalRoot) ||
        inside(b.binDir, a.globalRoot)
      )
        throw failure('LOCATION_AMBIGUOUS');
    }
  }
}
