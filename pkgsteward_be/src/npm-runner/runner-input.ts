import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { parseDocument } from 'yaml';
import * as semver from 'semver';
import {
  ForbiddenException,
  NotFoundException,
  ValidationException,
} from '@/common/exceptions/app.exception';
import {
  isSameOrInside,
  pathApi,
  toComparable,
} from '@/common/utils/path.util';
import { readProjectInput } from '@/projects/project-input';
import { createProjectFs } from '@/projects/project-fs';
import {
  isProjectRecord,
  jsonDepthWithinLimit,
  PROJECT_LOCK_BYTES,
} from '@/projects/project-lock-common';
import type {
  IProjectFs,
  ProjectLockName,
  ProjectManager,
  ProjectScanSnapshot,
} from '@/projects/interfaces/projects.types';
import type {
  IRunnerFileHandle,
  IRunnerFileIdentity,
  IRunnerFs,
  IRunnerInput,
  IRunnerInputDeps,
  IRunnerWorkspace,
  RunFailureCode,
} from './interfaces/npm-runner.types';
import { isRunnerPath } from './dto/runner-path-query.dto';
import {
  readRunnerFile,
  revalidateRunnerTool,
  runnerFailure,
  runnerIdentity,
  sameRunnerIdentity,
} from './runner-tool';
import type { IRunnerTextFile } from './runner-tool';

const SMALL_BYTES = 1024 * 1024;
const LOCKS: readonly ProjectLockName[] = [
  'npm-shrinkwrap.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
];
const CONFIGS = [
  '.npmrc',
  '.yarnrc',
  '.yarnrc.yml',
  'pnpm-workspace.yaml',
] as const;
const CONFIG_REDIRECTION =
  /^\s*(?:global|prefix|location|dir|modules-dir|virtual-store-dir|lockfile-dir|yarn-path|yarnPath)\s*[=:]/im;
const unsupportedConfig = (text: string): boolean =>
  CONFIG_REDIRECTION.test(text) ||
  text.split(/\r?\n/).some((line) => {
    const match =
      /^\s*(?:manage-package-manager-versions|managePackageManagerVersions)\s*[=:]\s*(.*?)\s*$/i.exec(
        line,
      );
    return !!match && !/^(?:false|"false"|'false')$/i.test(match[1]);
  });

export const createRunnerFs = (): IRunnerFs => ({
  ...createProjectFs(),
  async open(file: string): Promise<IRunnerFileHandle> {
    const handle = await open(file, 'r');
    return {
      stat: () => handle.stat(),
      close: () => handle.close(),
      async *readChunks(signal: AbortSignal) {
        let position = 0;
        while (true) {
          signal.throwIfAborted();
          const buffer = Buffer.alloc(64 * 1024);
          const { bytesRead } = await handle.read(
            buffer,
            0,
            buffer.length,
            position,
          );
          signal.throwIfAborted();
          if (!bytesRead) return;
          position += bytesRead;
          yield buffer.subarray(0, bytesRead);
        }
      },
    };
  },
});

const missingFile = () =>
  Object.assign(new Error('Missing snapshot input'), { code: 'ENOENT' });

function workspacePatterns(
  raw: Record<string, unknown>,
  yaml: IRunnerTextFile | null,
): string[] | null {
  let declared: unknown = raw.workspaces;
  if (isProjectRecord(declared)) {
    if (!Object.hasOwn(declared, 'packages'))
      throw runnerFailure('CONFIG_UNSUPPORTED');
    declared = declared.packages;
  }
  if (yaml) {
    const doc = parseDocument(yaml.text, { uniqueKeys: true, strict: true });
    if (doc.errors.length || doc.warnings.length)
      throw runnerFailure('CONFIG_UNSUPPORTED');
    const value: unknown = doc.toJS({ maxAliasCount: 0 });
    if (!isProjectRecord(value)) throw runnerFailure('CONFIG_UNSUPPORTED');
    if (!Object.hasOwn(value, 'packages'))
      throw runnerFailure('CONFIG_UNSUPPORTED');
    // Version substitution and path redirection remain unsupported in this config too.
    for (const key of Object.keys(value)) {
      if (
        /^(?:global|prefix|location|dir|modulesDir|modules-dir|virtualStoreDir|virtual-store-dir|lockfileDir|lockfile-dir|yarnPath|yarn-path)$/i.test(
          key,
        ) ||
        (/^(?:managePackageManagerVersions|manage-package-manager-versions)$/i.test(
          key,
        ) &&
          value[key] !== false)
      )
        throw runnerFailure('CONFIG_UNSUPPORTED');
    }
    if (value.packages !== undefined) {
      if (declared !== undefined) {
        if (!Array.isArray(declared) || !Array.isArray(value.packages))
          throw runnerFailure('CONFIG_UNSUPPORTED');
        declared = [
          ...(declared as unknown[]),
          ...(value.packages as unknown[]),
        ];
      } else declared = value.packages;
    }
  }
  if (declared === undefined) return null;
  if (
    !Array.isArray(declared) ||
    declared.length > 4096 ||
    declared.some((item: unknown) => typeof item !== 'string')
  )
    throw runnerFailure('CONFIG_UNSUPPORTED');
  const patterns = declared as string[];
  for (const pattern of patterns) {
    const glob = pattern.startsWith('!') ? pattern.slice(1) : pattern;
    if (
      !glob ||
      glob.length > 32767 ||
      glob.includes('..') ||
      /^[A-Za-z]:|^[\\/]/.test(glob) ||
      ['\0', '\r', '\n', '{', '}', '[', ']'].some((char) => glob.includes(char))
    )
      throw runnerFailure('CONFIG_UNSUPPORTED');
  }
  return patterns;
}

// Match bounded relative paths only. No directory enumeration or filesystem globbing.
function workspaceMatches(
  relative: string,
  patterns: readonly string[],
): boolean {
  let included = false;
  let excluded = false;
  let steps = 1_000_000;
  const tick = () => {
    if (--steps < 0) throw runnerFailure('CONFIG_UNSUPPORTED');
  };
  const parts = relative.replaceAll('\\', '/').toLowerCase().split('/');
  const matchPart = (text: string, pattern: string) => {
    let t = 0;
    let p = 0;
    let star = -1;
    let retry = 0;
    while (t < text.length) {
      tick();
      if (
        p < pattern.length &&
        (pattern[p] === '?' || pattern[p] === text[t])
      ) {
        t++;
        p++;
      } else if (pattern[p] === '*') {
        star = p++;
        retry = t;
      } else if (star >= 0) {
        p = star + 1;
        t = ++retry;
      } else return false;
    }
    while (pattern[p] === '*') {
      tick();
      p++;
    }
    return p === pattern.length;
  };
  for (const pattern of patterns) {
    const negative = pattern.startsWith('!');
    const glob = (negative ? pattern.slice(1) : pattern)
      .replaceAll('\\', '/')
      .replace(/\/$/, '')
      .toLowerCase();
    const segments = glob.split('/');
    let previous = Array<boolean>(parts.length + 1).fill(false);
    previous[0] = true;
    for (const segment of segments) {
      const next = Array<boolean>(parts.length + 1).fill(false);
      for (let index = 0; index <= parts.length; index++) {
        tick();
        next[index] =
          segment === '**'
            ? previous[index] || (index > 0 && next[index - 1])
            : index > 0 &&
              previous[index - 1] &&
              matchPart(parts[index - 1], segment);
      }
      previous = next;
    }
    if (previous[parts.length]) {
      if (negative) excluded = true;
      else included = true;
    }
  }
  return included && !excluded;
}

export async function readRunnerInput(
  requestPath: string,
  scan: ProjectScanSnapshot | null,
  deps: IRunnerInputDeps,
): Promise<IRunnerInput> {
  const { signal, fs, platform } = deps;
  signal.throwIfAborted();
  if (!isRunnerPath(requestPath) || platform !== 'win32')
    throw new ValidationException('Invalid runner project path');
  const api = pathApi(platform);
  const compare = (value: string) => toComparable(value, platform);
  const resolved = api.resolve(requestPath);
  const canonical = api.resolve(await deps.assertAllowed(resolved));
  signal.throwIfAborted();
  if (!scan) throw new NotFoundException('Latest scan');
  const scanId = scan.scanId;
  if (
    !scan.projects.some(
      (project) =>
        compare(project.path) === compare(resolved) ||
        compare(project.path) === compare(canonical),
    )
  )
    throw runnerFailure('PROJECT_NOT_SCANNED');
  if (compare(canonical) !== compare(resolved))
    throw runnerFailure('INPUT_CHANGED');
  const rootIdentity = runnerIdentity(canonical, await fs.lstat(canonical));
  signal.throwIfAborted();
  if (rootIdentity.stat.isSymbolicLink() || !rootIdentity.stat.isDirectory?.())
    throw runnerFailure('CONFIG_UNSUPPORTED');
  const checkRoot = async () => {
    const observed = await fs.lstat(canonical);
    signal.throwIfAborted();
    const real = await fs.realpath(canonical);
    signal.throwIfAborted();
    if (
      !sameRunnerIdentity(rootIdentity.stat, observed) ||
      compare(real) !== compare(canonical)
    )
      throw runnerFailure('INPUT_CHANGED');
  };
  await checkRoot();
  signal.throwIfAborted();
  const files = new Map<string, IRunnerTextFile | null>();
  const failures = new Set<string>();
  const identities: IRunnerFileIdentity[] = [rootIdentity];
  const hash = createHash('sha256');
  const hashField = (name: string, bytes: Buffer | null) => {
    hash.update(JSON.stringify([name, bytes?.byteLength ?? null]));
    hash.update('\0');
    if (bytes) hash.update(bytes);
    hash.update('\0');
  };
  hashField('root', Buffer.from(compare(canonical)));
  hashField('scanId', Buffer.from(scanId));
  const budget = { remaining: 8 * SMALL_BYTES };
  let reason: RunFailureCode | null = null;
  const read = async (
    file: string,
    maximum: number,
    required = false,
    lock = false,
  ): Promise<IRunnerTextFile | null> => {
    const fileKey = compare(file);
    if (files.has(fileKey)) return files.get(fileKey)!;
    try {
      const data = await readRunnerFile(file, maximum, fs, signal, platform, {
        optional: !required,
        budget: lock ? undefined : budget,
        checkParent: checkRoot,
      });
      signal.throwIfAborted();
      files.set(fileKey, data);
      hashField(fileKey, data?.bytes ?? null);
      if (data) identities.push(data.identity);
      return data;
    } catch (error) {
      signal.throwIfAborted();
      const details: unknown = isProjectRecord(error)
        ? error.details
        : undefined;
      if (isProjectRecord(details) && details.reason === 'INPUT_CHANGED')
        throw error;
      if (required) {
        if (isProjectRecord(error) && error.code === 'ENOENT')
          throw new NotFoundException('Project manifest');
        throw runnerFailure('CONFIG_UNSUPPORTED');
      }
      reason = 'CONFIG_UNSUPPORTED';
      failures.add(fileKey);
      files.set(fileKey, null);
      hashField(`unreadable:${fileKey}`, Buffer.from('CONFIG_UNSUPPORTED'));
      return null;
    }
  };
  const manifestFile = await read(
    api.join(canonical, 'package.json'),
    SMALL_BYTES,
    true,
  );
  signal.throwIfAborted();
  if (!manifestFile) throw new NotFoundException('Project manifest');
  const lockFiles: ProjectLockName[] = [];
  for (const name of LOCKS) {
    if (await read(api.join(canonical, name), PROJECT_LOCK_BYTES, false, true))
      lockFiles.push(name);
    signal.throwIfAborted();
  }
  for (const name of CONFIGS) {
    await read(api.join(canonical, name), SMALL_BYTES);
    signal.throwIfAborted();
  }
  // Reuse M5 parsing and validation over an immutable, already bounded/handle-checked snapshot.
  const cachedFs: IProjectFs = {
    lstat: (file) => {
      const data = files.get(compare(file));
      return data
        ? Promise.resolve(data.identity.stat)
        : Promise.reject(missingFile());
    },
    realpath: (file) => Promise.resolve(api.resolve(file)),
    async *readChunks(file, readSignal) {
      readSignal.throwIfAborted();
      const data = files.get(compare(file));
      if (!data) throw missingFile();
      await Promise.resolve();
      readSignal.throwIfAborted();
      yield data.bytes;
    },
  };
  const parsed = await readProjectInput(
    requestPath,
    { scanId, projects: scan.projects.map((project) => ({ ...project })) },
    signal,
    {
      platform,
      fs: cachedFs,
      assertAllowed: () => Promise.resolve(canonical),
      now: () => deps.now(),
    },
  );
  signal.throwIfAborted();
  const raw: unknown = JSON.parse(manifestFile.text);
  if (!isProjectRecord(raw))
    throw new ValidationException('Invalid project manifest');
  const scripts: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const script of parsed.manifest.scripts)
    scripts[script.name] = script.command;
  let workspace: IRunnerWorkspace = { kind: 'standalone', root: null };
  let yarnMarker =
    lockFiles.includes('yarn.lock') ||
    !!files.get(compare(api.join(canonical, '.yarnrc.yml')));
  const config = files.get(compare(api.join(canonical, '.npmrc')));
  if (config && unsupportedConfig(config.text)) reason = 'CONFIG_UNSUPPORTED';
  const inspectWorkspace = (
    at: string,
    manifest: Record<string, unknown>,
    yaml: IRunnerTextFile | null,
  ) => {
    try {
      const patterns = workspacePatterns(manifest, yaml);
      if (patterns !== null) {
        if (compare(at) === compare(canonical))
          workspace = { kind: 'root', root: at };
        else if (workspaceMatches(api.relative(at, canonical), patterns))
          workspace = { kind: 'leaf', root: at };
      }
    } catch {
      reason = 'CONFIG_UNSUPPORTED';
    }
  };
  inspectWorkspace(
    canonical,
    raw,
    files.get(compare(api.join(canonical, 'pnpm-workspace.yaml'))) ?? null,
  );
  const boundaries = deps.scanRoots
    .filter((entry) => entry !== '*')
    .map((entry) => api.resolve(entry))
    .filter((entry) =>
      isSameOrInside(compare(canonical), compare(entry), platform),
    )
    .sort((a, b) => b.length - a.length);
  const boundary =
    boundaries[0] ??
    (deps.scanRoots.includes('*') ? api.parse(canonical).root : null);
  if (!boundary) reason = 'CONFIG_UNSUPPORTED';
  else {
    let at = api.dirname(canonical);
    let count = 0;
    if (compare(canonical) !== compare(boundary)) {
      while (isSameOrInside(compare(at), compare(boundary), platform)) {
        if (++count > 256) {
          reason = 'CONFIG_UNSUPPORTED';
          break;
        }
        try {
          let allowed: string;
          try {
            allowed = await deps.assertAllowed(at);
            signal.throwIfAborted();
          } catch (error: unknown) {
            signal.throwIfAborted();
            // A denied ancestor is an exclusive boundary, never a read target.
            if (error instanceof ForbiddenException) break;
            throw error;
          }
          const stat = await fs.lstat(at);
          signal.throwIfAborted();
          const real = await fs.realpath(at);
          signal.throwIfAborted();
          if (
            compare(allowed) !== compare(at) ||
            compare(real) !== compare(at) ||
            stat.isSymbolicLink() ||
            !stat.isDirectory?.()
          )
            throw runnerFailure('CONFIG_UNSUPPORTED');
          identities.push(runnerIdentity(at, stat));
          const ancestorManifest = await read(
            api.join(at, 'package.json'),
            SMALL_BYTES,
          );
          signal.throwIfAborted();
          const yaml = await read(
            api.join(at, 'pnpm-workspace.yaml'),
            SMALL_BYTES,
          );
          signal.throwIfAborted();
          const npmrc = await read(api.join(at, '.npmrc'), SMALL_BYTES);
          signal.throwIfAborted();
          if (npmrc && unsupportedConfig(npmrc.text))
            reason = 'CONFIG_UNSUPPORTED';
          if (await read(api.join(at, '.yarnrc.yml'), SMALL_BYTES))
            yarnMarker = true;
          signal.throwIfAborted();
          if (ancestorManifest && !jsonDepthWithinLimit(ancestorManifest.text))
            throw runnerFailure('CONFIG_UNSUPPORTED');
          const ancestorRaw: unknown = ancestorManifest
            ? JSON.parse(ancestorManifest.text)
            : {};
          if (!isProjectRecord(ancestorRaw))
            throw runnerFailure('CONFIG_UNSUPPORTED');
          if (
            typeof ancestorRaw.packageManager === 'string' &&
            ancestorRaw.packageManager.startsWith('yarn@')
          )
            yarnMarker = true;
          inspectWorkspace(at, ancestorRaw, yaml);
        } catch {
          signal.throwIfAborted();
          reason = 'CONFIG_UNSUPPORTED';
          break;
        }
        if (compare(at) === compare(boundary)) break;
        const parent = api.dirname(at);
        if (parent === at) break;
        at = parent;
      }
    }
  }
  const families = new Set<ProjectManager>(
    lockFiles.map((name) =>
      name === 'pnpm-lock.yaml'
        ? 'pnpm'
        : name === 'yarn.lock'
          ? 'yarn'
          : 'npm',
    ),
  );
  let manager: ProjectManager = parsed.manager;
  let pinVersion: string | null = null;
  const pin = parsed.manifest.packageManager;
  if (pin !== null) {
    const match =
      /^(npm|pnpm|yarn)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\+[0-9A-Za-z.-]+)?$/.exec(
        pin,
      );
    if (!match || match[0] !== pin || !semver.valid(match[2])) {
      reason ??= 'UNSUPPORTED_MANAGER';
    } else {
      manager = match[1] as ProjectManager;
      pinVersion = match[2];
      if ([...families].some((family) => family !== manager))
        reason ??= 'LOCKFILE_MISMATCH';
    }
  } else if (families.size > 1) {
    manager = 'ambiguous';
    reason ??= 'UNSUPPORTED_MANAGER';
  } else if (families.size === 0) manager = 'npm';
  if (manager === 'yarn' || yarnMarker) reason ??= 'UNSUPPORTED_MANAGER';
  const warnings: IRunnerInput['warnings'] = [
    'LOGS_MAY_CONTAIN_SECRETS',
    'PROJECT_CODE_EXECUTION',
    'PATH_RACE_RESIDUAL',
  ];
  if (!lockFiles.length) warnings.push('NO_LOCKFILE');
  let selectedTool: IRunnerInput['tool'] = null;
  if (!reason && (manager === 'npm' || manager === 'pnpm')) {
    try {
      selectedTool = await deps.resolveTool(manager);
      signal.throwIfAborted();
      if (
        selectedTool.manager !== manager ||
        !semver.valid(selectedTool.version) ||
        semver.major(selectedTool.version) !== 11 ||
        (pinVersion &&
          semver.major(pinVersion) !== semver.major(selectedTool.version))
      )
        reason = 'TOOL_VERSION_MISMATCH';
      else if (pinVersion && pinVersion !== selectedTool.version)
        warnings.push('PACKAGE_MANAGER_PIN_DIFFERS');
    } catch (error) {
      signal.throwIfAborted();
      const details: unknown = isProjectRecord(error)
        ? error.details
        : undefined;
      const code = isProjectRecord(details) ? details.reason : undefined;
      reason =
        code === 'TOOL_NOT_FOUND' ||
        code === 'TOOL_LAYOUT_UNSUPPORTED' ||
        code === 'TOOL_VERSION_MISMATCH'
          ? code
          : 'TOOL_LAYOUT_UNSUPPORTED';
    }
  }
  if (selectedTool)
    hashField(
      'tool',
      Buffer.from(
        JSON.stringify({
          manager: selectedTool.manager,
          version: selectedTool.version,
          file: compare(selectedTool.file),
          entry: selectedTool.entry && compare(selectedTool.entry),
          packageDir: compare(selectedTool.packageDir),
          identities: selectedTool.identities.map((item) => [
            compare(item.path),
            item.stat.dev,
            item.stat.ino,
            item.stat.size,
            item.stat.mtimeMs,
            item.stat.ctimeMs,
          ]),
        }),
      ),
    );
  else hashField('tool', null);
  hashField('failures', Buffer.from(JSON.stringify([...failures].sort())));
  await checkRoot();
  signal.throwIfAborted();
  const latest = deps.getScanSnapshot();
  if (
    !latest ||
    latest.scanId !== scanId ||
    !latest.projects.some(
      (project) => compare(project.path) === compare(canonical),
    )
  )
    throw runnerFailure('INPUT_CHANGED');
  return {
    requestPath,
    path: canonical,
    scanId,
    inputHash: hash.digest('hex'),
    manifest: parsed.manifest,
    scripts,
    manager,
    tool: selectedTool,
    reason,
    warnings,
    workspace,
    lockFiles,
    identities,
  };
}

export async function revalidateRunnerInput(
  previous: IRunnerInput,
  expectedHash: string,
  deps: IRunnerInputDeps,
): Promise<IRunnerInput> {
  deps.signal.throwIfAborted();
  if (expectedHash !== previous.inputHash) throw runnerFailure('INPUT_CHANGED');
  try {
    const current = await readRunnerInput(
      previous.requestPath,
      deps.getScanSnapshot(),
      deps,
    );
    deps.signal.throwIfAborted();
    if (
      current.inputHash !== expectedHash ||
      current.scanId !== previous.scanId ||
      toComparable(current.path, deps.platform) !==
        toComparable(previous.path, deps.platform)
    )
      throw runnerFailure('INPUT_CHANGED');
    const previousIdentities = new Map(
      previous.identities.map((identity) => [
        toComparable(identity.path, deps.platform),
        identity.stat,
      ]),
    );
    if (
      current.identities.length !== previous.identities.length ||
      current.identities.some((identity) => {
        const before = previousIdentities.get(
          toComparable(identity.path, deps.platform),
        );
        return !before || !sameRunnerIdentity(before, identity.stat);
      })
    )
      throw runnerFailure('INPUT_CHANGED');
    if (current.tool) {
      await revalidateRunnerTool(current.tool, deps.fs, deps.signal);
      deps.signal.throwIfAborted();
    }
    const present = new Set(
      current.identities.map((identity) =>
        toComparable(identity.path, deps.platform),
      ),
    );
    const api = pathApi(deps.platform);
    // Also recheck absence: a newly created config/lock/workspace marker changes policy.
    for (const directory of current.identities.filter((identity) =>
      identity.stat.isDirectory?.(),
    )) {
      const names: readonly string[] =
        toComparable(directory.path, deps.platform) ===
        toComparable(current.path, deps.platform)
          ? ['package.json', ...LOCKS, ...CONFIGS]
          : ['package.json', 'pnpm-workspace.yaml', '.npmrc', '.yarnrc.yml'];
      for (const name of names) {
        const file = api.join(directory.path, name);
        if (present.has(toComparable(file, deps.platform))) continue;
        try {
          await deps.fs.lstat(file);
          deps.signal.throwIfAborted();
          throw runnerFailure('INPUT_CHANGED');
        } catch (error) {
          deps.signal.throwIfAborted();
          if (!isProjectRecord(error) || error.code !== 'ENOENT')
            throw runnerFailure('INPUT_CHANGED');
        }
      }
    }
    for (const identity of current.identities) {
      const stat = await deps.fs.lstat(identity.path);
      deps.signal.throwIfAborted();
      const real = await deps.fs.realpath(identity.path);
      deps.signal.throwIfAborted();
      if (
        !sameRunnerIdentity(identity.stat, stat) ||
        toComparable(real, deps.platform) !==
          toComparable(identity.path, deps.platform)
      )
        throw runnerFailure('INPUT_CHANGED');
    }
    return current;
  } catch {
    deps.signal.throwIfAborted();
    throw runnerFailure('INPUT_CHANGED');
  }
}
