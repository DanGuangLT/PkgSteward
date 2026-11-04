import type {
  GlobalProbeSpawn,
  IGlobalBinOwner,
  IGlobalPackageFacts,
  IGlobalProbeResult,
  IGlobalResolvedLocation,
} from '@/global-packages/interfaces/global-packages.runtime';
import type {
  GlobalManager,
  IGlobalPackage,
} from '@/global-packages/interfaces/global-packages.types';
import type { IRunnerFs } from '@/npm-runner/interfaces/npm-runner.types';
import { win32 } from 'node:path';
import { createHash } from 'node:crypto';
import { AppException } from '@/common/exceptions/app.exception';
import {
  assertGlobalPackageMutable,
  isGlobalPackageName,
  normalizeGlobalBins,
} from '@/global-packages/global-policy';
import {
  buildGlobalQuery,
  isGlobalAbsolutePath,
  isGlobalExactVersion,
} from '@/global-packages/global-command';
import {
  assertGlobalDirectory,
  readGlobalDirectory,
  runGlobalProbe,
} from '@/global-packages/global-location';
import { readRunnerFile, runnerIdentity } from '@/npm-runner/runner-tool';
import { isProjectRecord } from '@/projects/project-lock-common';
import type { GlobalEnvironmentCapture } from '@/global-packages/interfaces/global-packages.runtime';
import type {
  GlobalReasonCode,
  IGlobalBin,
} from '@/global-packages/interfaces/global-packages.types';

const failed = (): AppException =>
  new AppException(409, 'Global inventory is incomplete', 'CONFLICT', {
    reason: 'INVENTORY_FAILED',
  });
const key = (path: string): string => win32.resolve(path).toLowerCase();
const binKey = (name: string): string =>
  name.toLowerCase().replace(/\.(?:cmd|ps1|exe|bat|com)$/, '');

function parseJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  const objects: (Set<string> | null)[] = [];
  // JSON.parse alone silently discards duplicate keys. Tokenize only after syntax validation.
  const tokens = /"(?:[^"\\]|\\[\s\S])*"|[{}[\]]/g;
  for (const match of text.matchAll(tokens)) {
    const token = match[0];
    if (token === '{' || token === '[') {
      objects.push(token === '{' ? new Set() : null);
      if (objects.length > 64) throw failed();
    } else if (token === '}' || token === ']') objects.pop();
    else if (
      text
        .slice(match.index + token.length)
        .trimStart()
        .startsWith(':')
    ) {
      const keys = objects.at(-1);
      const name: unknown = JSON.parse(token);
      if (typeof name !== 'string' || !keys || keys.has(name)) throw failed();
      keys.add(name);
    }
  }
  return value;
}
const partial = (value: Record<string, unknown>): boolean =>
  value.error !== undefined ||
  value.missing === true ||
  value.invalid === true ||
  (value.problems !== undefined &&
    (!Array.isArray(value.problems) || value.problems.length !== 0));

export interface IGlobalListedPackage {
  name: string;
  version: string;
  path: string | null;
  linked: boolean;
}
export interface IGlobalInventoryResult {
  packages: IGlobalPackage[];
  facts: IGlobalPackageFacts[];
  binOwners: IGlobalBinOwner[];
  ownershipComplete: boolean;
}
export interface IGlobalInventoryDeps {
  fs: IRunnerFs;
  environment: Readonly<NodeJS.ProcessEnv>;
  signal: AbortSignal;
  spawn: GlobalProbeSpawn;
}

export function parseGlobalInventory(
  manager: GlobalManager,
  result: IGlobalProbeResult,
): IGlobalListedPackage[] {
  try {
    if (
      result.exitCode !== 0 ||
      !result.terminationVerified ||
      result.stdout.byteLength > 8 * 1024 * 1024 ||
      result.stderr.byteLength > 64 * 1024
    )
      throw failed();
    const raw = parseJson(
      new TextDecoder('utf-8', { fatal: true }).decode(result.stdout),
    );
    const root: unknown =
      manager === 'npm'
        ? raw
        : Array.isArray(raw) && raw.length === 1
          ? raw[0]
          : null;
    if (
      !isProjectRecord(root) ||
      partial(root) ||
      !isProjectRecord(root.dependencies)
    )
      throw failed();
    const entries = Object.entries(root.dependencies);
    if (entries.length > 10_000) throw failed();
    const packages: IGlobalListedPackage[] = [];
    for (const [name, entry] of entries) {
      if (
        !isGlobalPackageName(name) ||
        !isProjectRecord(entry) ||
        partial(entry) ||
        !isGlobalExactVersion(entry.version) ||
        (entry.path !== undefined &&
          (typeof entry.path !== 'string' || !isGlobalAbsolutePath(entry.path)))
      )
        throw failed();
      packages.push({
        name,
        version: entry.version,
        path: typeof entry.path === 'string' ? entry.path : null,
        linked:
          entry.linked === true ||
          entry.link === true ||
          (typeof entry.resolved === 'string' &&
            /^(?:link:|file:)/.test(entry.resolved)),
      });
    }
    return packages.sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
  } catch {
    throw failed();
  }
}

function captureLocation(
  location: IGlobalResolvedLocation,
): GlobalEnvironmentCapture {
  return {
    npm_config_userconfig: location.userConfig,
    npm_config_globalconfig: location.globalConfig,
    ...(location.prefix ? { npm_config_prefix: location.prefix } : {}),
    ...(location.cacheDir ? { npm_config_cache: location.cacheDir } : {}),
    ...(location.globalDir
      ? { pnpm_config_global_dir: location.globalDir }
      : {}),
    ...(location.storeDir ? { pnpm_config_store_dir: location.storeDir } : {}),
    ...(location.manager === 'pnpm'
      ? {
          PNPM_HOME: location.binDir,
          pnpm_config_global_bin_dir: location.binDir,
        }
      : {}),
  };
}

async function checkBinTargets(
  bins: IGlobalBin[],
  root: string,
  fs: IRunnerFs,
  signal: AbortSignal,
): Promise<IGlobalPackageFacts['binIdentities']> {
  const identities: IGlobalPackageFacts['binIdentities'] = [];
  for (const bin of bins) {
    const target = win32.resolve(root, bin.target);
    if (!key(target).startsWith(`${key(root)}\\`)) throw failed();
    await assertGlobalDirectory(win32.dirname(target), fs, signal);
    const stat = await fs.lstat(target);
    signal.throwIfAborted();
    if (!stat.isFile() || stat.isSymbolicLink()) throw failed();
    const real = await fs.realpath(target);
    signal.throwIfAborted();
    if (key(real) !== key(target)) throw failed();
    identities.push(runnerIdentity(target, stat));
  }
  return identities;
}

function shimTargetsPackage(
  text: string,
  file: string,
  binDir: string,
  facts: IGlobalPackageFacts,
  name: string,
): boolean {
  const extension = win32.extname(file).toLowerCase();
  if (extension !== '' && extension !== '.cmd' && extension !== '.ps1')
    return false;
  const targets = new Set(
    facts.bins
      .filter((bin) => binKey(bin.name) === name)
      .map((bin) => key(win32.join(facts.packageRoot, bin.target))),
  );
  let invocations = 0;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^(?:#|::|@?rem\s)/i.test(trimmed)) continue;
    const invocation =
      extension === '.cmd'
        ? line.includes('%*') && /(?:%_prog%|node(?:\.exe)?)/i.test(line)
        : extension === '.ps1'
          ? line.includes('&') && line.includes('$args')
          : /^exec\s/.test(trimmed) && line.includes('"$@"');
    if (!invocation) continue;
    const quoted = [...line.matchAll(/"([^"\r\n]+)"/g)].map(
      (match) => match[1],
    );
    const matches = quoted.filter((argument) => {
      const expanded = argument.replace(
        /^(?:%~dp0|%dp0%|\$\{basedir\}|\$basedir)/i,
        binDir,
      );
      if (/[$%`]/.test(expanded) || !isGlobalAbsolutePath(expanded))
        return false;
      return targets.has(key(expanded));
    });
    if (matches.length !== 1) return false;
    invocations++;
  }
  return invocations > 0;
}

export async function readGlobalInventory(
  location: IGlobalResolvedLocation,
  deps: IGlobalInventoryDeps,
): Promise<IGlobalInventoryResult> {
  const { fs, signal } = deps;
  signal.throwIfAborted();
  try {
    await assertGlobalDirectory(location.globalRoot, fs, signal);
    await assertGlobalDirectory(location.binDir, fs, signal);
    const command = buildGlobalQuery({
      manager: location.manager,
      tool: location.tool,
      cwd: location.cwd,
      environment: deps.environment,
      captured: captureLocation(location),
      query: 'list',
    });
    const listed = parseGlobalInventory(
      location.manager,
      await runGlobalProbe(command, 'list', signal, deps.spawn),
    );
    const result: IGlobalInventoryResult = {
      packages: [],
      facts: [],
      binOwners: [],
      ownershipComplete: true,
    };
    const budget = { remaining: 32 * 1024 * 1024 };
    const owners = new Map<string, string | null>();
    for (let index = 0; index < listed.length; index++) {
      signal.throwIfAborted();
      if (index > 0 && index % 128 === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        signal.throwIfAborted();
      }
      const entry = listed[index];
      const root = win32.join(location.globalRoot, ...entry.name.split('/'));
      if (entry.path !== null && key(entry.path) !== key(root)) throw failed();
      await assertGlobalDirectory(win32.dirname(root), fs, signal);
      const stat = await fs.lstat(root);
      signal.throwIfAborted();
      // A linked root is display-only. Do not realpath or open its outside manifest.
      if (entry.linked || stat.isSymbolicLink()) {
        result.packages.push({
          name: entry.name,
          version: entry.version,
          bins: [],
          status: 'linked',
          reason: 'LINKED_PACKAGE',
        });
        result.ownershipComplete = false;
        continue;
      }
      const real = await fs.realpath(root);
      signal.throwIfAborted();
      if (!stat.isDirectory?.() || key(real) !== key(root)) throw failed();
      const manifest = await readRunnerFile(
        win32.join(root, 'package.json'),
        1024 * 1024,
        fs,
        signal,
        'win32',
        {
          budget,
          checkParent: () => assertGlobalDirectory(root, fs, signal),
        },
      );
      if (!manifest) throw failed();
      const raw = parseJson(manifest.text);
      const row: IGlobalPackage = {
        name: entry.name,
        version: entry.version,
        bins: [],
        status: 'manageable',
        reason: null,
      };
      if (
        !isProjectRecord(raw) ||
        raw.name !== entry.name ||
        raw.version !== entry.version
      ) {
        row.status = 'invalid';
        row.reason = 'INVENTORY_FAILED';
        result.ownershipComplete = false;
        result.packages.push(row);
        continue;
      }
      let identities: IGlobalPackageFacts['binIdentities'] = [];
      try {
        row.bins = normalizeGlobalBins(entry.name, raw.bin);
        identities = await checkBinTargets(row.bins, root, fs, signal);
        assertGlobalPackageMutable({
          packageName: entry.name,
          packageRoot: root,
          linked: false,
          currentBins: row.bins,
          targetBins: [],
          binOwners: [],
          ownershipComplete: true,
          protectedPaths: location.protectedPaths,
        });
      } catch (error) {
        signal.throwIfAborted();
        const reason: GlobalReasonCode =
          error instanceof AppException &&
          (error.details as { reason?: string } | undefined)?.reason ===
            'PROTECTED_PACKAGE'
            ? 'PROTECTED_PACKAGE'
            : 'BIN_CONFLICT';
        row.status = reason === 'PROTECTED_PACKAGE' ? 'protected' : 'invalid';
        row.reason = reason;
        if (row.status === 'invalid') result.ownershipComplete = false;
      }
      for (const bin of row.bins) {
        const name = binKey(bin.name);
        if (owners.has(name) && owners.get(name) !== entry.name) {
          owners.set(name, null);
          result.ownershipComplete = false;
        } else owners.set(name, entry.name);
      }
      if (row.status !== 'invalid')
        result.facts.push({
          name: entry.name,
          version: entry.version,
          packageRoot: root,
          manifest: {
            file: manifest.identity,
            sha256: createHash('sha256').update(manifest.bytes).digest('hex'),
          },
          bins: row.bins,
          binIdentities: identities,
        });
      result.packages.push(row);
    }
    const physical = await readGlobalDirectory(fs, location.binDir, signal);
    const factsByName = new Map(
      result.facts.map((facts) => [facts.name, facts]),
    );
    for (const name of physical) {
      const file = win32.join(location.binDir, name);
      const stat = await fs.lstat(file);
      signal.throwIfAborted();
      if (
        stat.isDirectory?.() ||
        !/^[a-z0-9][a-z0-9._-]*$/i.test(name) ||
        /\.(?:json|txt|md|yaml|yml)$/i.test(name)
      )
        continue;
      const normalized = binKey(name);
      const owner = owners.get(normalized);
      const facts = owner ? factsByName.get(owner) : undefined;
      // Read shim launch arguments as inert data; never run a shim to learn its owner.
      let proved = false;
      if (facts && stat.isSymbolicLink()) {
        const target = await fs.realpath(file);
        signal.throwIfAborted();
        proved = facts.bins.some(
          (bin) =>
            binKey(bin.name) === normalized &&
            key(win32.join(facts.packageRoot, bin.target)) === key(target),
        );
      } else if (facts && stat.isFile()) {
        const shim = await readRunnerFile(
          file,
          64 * 1024,
          fs,
          signal,
          'win32',
          {
            budget,
            checkParent: () =>
              assertGlobalDirectory(location.binDir, fs, signal),
          },
        );
        signal.throwIfAborted();
        proved =
          shim !== null &&
          shimTargetsPackage(
            shim.text,
            file,
            location.binDir,
            facts,
            normalized,
          );
      }
      if (!proved) owners.set(normalized, null);
      if (facts) facts.binIdentities.push(runnerIdentity(file, stat));
    }
    for (const row of result.packages) {
      if (
        row.status === 'manageable' &&
        row.bins.some((bin) => owners.get(binKey(bin.name)) !== row.name)
      ) {
        row.status = 'invalid';
        row.reason = 'BIN_CONFLICT';
        result.ownershipComplete = false;
      }
    }
    result.binOwners = [...owners]
      .map(([name, owner]) => ({ name, owner }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));
    return result;
  } catch (error) {
    signal.throwIfAborted();
    if (
      error instanceof AppException &&
      (error.details as { reason?: string } | undefined)?.reason ===
        'TERMINATION_UNCONFIRMED'
    )
      throw error;
    throw failed();
  }
}
