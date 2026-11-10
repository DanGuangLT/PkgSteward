import { createHash } from 'node:crypto';
import * as semver from 'semver';
import {
  AppException,
  ForbiddenException,
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
import { isSupportedRunnerVersion } from '@/npm-runner/toolchain/runner-version-policy';
import type {
  IManifestDependency,
  IManifestInput,
  IProjectFileStat,
  IProjectInput,
  IProjectInputDeps,
  ProjectAnalysisCode,
  ProjectLockName,
  ProjectManager,
  ProjectScanSnapshot,
} from '@/projects/interfaces/projects.types';
import {
  compareProjectText,
  isProjectRecord,
  jsonDepthWithinLimit,
  PROJECT_DEPENDENCY_GROUPS,
  PROJECT_LOCK_BYTES,
} from '@/projects/locks/project-lock-common';

const SMALL_INPUT_BYTES = 1024 * 1024;
const LOCK_NAMES: readonly ProjectLockName[] = [
  'npm-shrinkwrap.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
];
const CONFIG_NAMES = [
  '.npmrc',
  '.yarnrc',
  '.yarnrc.yml',
  'pnpm-workspace.yaml',
] as const;
const REGISTRY_CONFIG_KEY =
  /\b(?:registry|npmRegistryServer|npmScopes|_auth|_authToken|_password)\b/i;
interface IInputFile {
  bytes: Buffer;
  text: string;
}

const changedInput = () =>
  new AppException(409, 'Project input changed while reading', 'CONFLICT', {
    reason: 'INPUT_CHANGED',
  });
const inputLimit = () =>
  new ValidationException('Project input exceeds the supported limit', {
    reason: 'LIMIT_EXCEEDED',
  });
const errorCode = (error: unknown): unknown =>
  isProjectRecord(error) ? error.code : undefined;
const sameStat = (before: IProjectFileStat, after: IProjectFileStat) =>
  before.size === after.size &&
  before.mtimeMs === after.mtimeMs &&
  before.ctimeMs === after.ctimeMs &&
  before.ino === after.ino &&
  before.dev === after.dev &&
  after.isFile() &&
  !after.isSymbolicLink();

function parseManifest(text: string): IManifestInput {
  let raw: unknown;
  try {
    if (!jsonDepthWithinLimit(text))
      throw new ValidationException('Invalid package manifest');
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new ValidationException('Invalid package manifest');
  }
  if (!isProjectRecord(raw))
    throw new ValidationException('Invalid package manifest');
  for (const field of ['name', 'version', 'packageManager']) {
    if (
      raw[field] !== undefined &&
      raw[field] !== null &&
      typeof raw[field] !== 'string'
    ) {
      throw new ValidationException('Invalid package manifest');
    }
  }
  const dependencies = new Map<string, IManifestDependency>();
  for (const group of PROJECT_DEPENDENCY_GROUPS) {
    const declarations: unknown = raw[group] === undefined ? {} : raw[group];
    if (!isProjectRecord(declarations))
      throw new ValidationException('Invalid dependency declarations');
    for (const [name, spec] of Object.entries(declarations)) {
      if (typeof spec !== 'string')
        throw new ValidationException('Invalid dependency declarations');
      const dependency: IManifestDependency = dependencies.get(name) ?? {
        name,
        declarations: [],
      };
      dependency.declarations.push({ group, spec });
      dependencies.set(name, dependency);
    }
  }
  const scripts: unknown = raw.scripts === undefined ? {} : raw.scripts;
  if (
    !isProjectRecord(scripts) ||
    Object.values(scripts).some((command) => typeof command !== 'string')
  ) {
    throw new ValidationException('Invalid script declarations');
  }
  return {
    name: typeof raw.name === 'string' ? raw.name : null,
    version: typeof raw.version === 'string' ? raw.version : null,
    packageManager:
      typeof raw.packageManager === 'string' ? raw.packageManager : null,
    dependencies: [...dependencies.values()].sort((a, b) =>
      compareProjectText(a.name, b.name),
    ),
    scripts: Object.entries(scripts)
      .map(([name, command]) => ({ name, command: command as string }))
      .sort((a, b) => compareProjectText(a.name, b.name)),
  };
}

function selectLock(
  manifest: IManifestInput,
  locks: ReadonlyMap<ProjectLockName, IInputFile | null>,
  warnings: Set<ProjectAnalysisCode>,
): { manager: ProjectManager; name: ProjectLockName | null } {
  const pin = manifest.packageManager?.match(
    /^(npm|pnpm|yarn)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\+[0-9A-Za-z.-]+)?$/,
  );
  const packageLockOnly =
    pin?.[1] === 'npm' &&
    isSupportedRunnerVersion('npm', pin[2]) &&
    semver.major(pin[2]) === 12;
  const npm =
    !packageLockOnly && locks.get('npm-shrinkwrap.json')
      ? 'npm-shrinkwrap.json'
      : locks.get('package-lock.json')
        ? 'package-lock.json'
        : null;
  const available = new Map<ProjectManager, ProjectLockName>();
  if (npm) available.set('npm', npm);
  if (locks.get('pnpm-lock.yaml')) available.set('pnpm', 'pnpm-lock.yaml');
  if (locks.get('yarn.lock')) available.set('yarn', 'yarn.lock');
  if (pin && semver.valid(pin[2])) {
    const manager = pin[1] as 'npm' | 'pnpm' | 'yarn';
    const name = available.get(manager) ?? null;
    if (!name)
      warnings.add(available.size ? 'LOCKFILE_MISMATCH' : 'NO_LOCKFILE');
    return { manager, name };
  }
  if (manifest.packageManager !== null) warnings.add('UNSUPPORTED_MANAGER');
  if (available.size > 1) {
    warnings.add('LOCKFILE_MISMATCH');
    return { manager: 'ambiguous', name: null };
  }
  const only = available.entries().next();
  if (!only.done) return { manager: only.value[0], name: only.value[1] };
  warnings.add('NO_LOCKFILE');
  return { manager: 'unknown', name: null };
}

export async function readProjectInput(
  requestPath: string,
  scanSnapshot: ProjectScanSnapshot | null,
  signal: AbortSignal,
  deps: IProjectInputDeps,
): Promise<IProjectInput> {
  signal.throwIfAborted();
  if (
    !requestPath ||
    requestPath.length > 32_768 ||
    requestPath.includes('\0') ||
    !isFullyQualifiedPath(requestPath, deps.platform) ||
    hasTraversalSegment(requestPath)
  ) {
    throw new ValidationException('Invalid project path');
  }
  const api = pathApi(deps.platform);
  const resolvedRequest = api.resolve(requestPath);
  const canonical = api.resolve(await deps.assertAllowed(resolvedRequest));
  signal.throwIfAborted();
  const comparable = (value: string) => toComparable(value, deps.platform);
  const rootKey = comparable(canonical);
  if (!scanSnapshot) throw new NotFoundException('Latest scan');
  const scanId = scanSnapshot.scanId;
  const requestKey = comparable(resolvedRequest);
  const member = scanSnapshot.projects.some((project) => {
    const scanned = comparable(api.resolve(project.path));
    return scanned === requestKey || scanned === rootKey;
  });
  if (!member)
    throw new AppException(
      409,
      'Project is not in the latest scan',
      'CONFLICT',
      { reason: 'PROJECT_NOT_SCANNED' },
    );

  // Sequential fixed-file reads keep outstanding reads below the four-file cap.
  const readFixed = async (
    name: string,
    maximum: number,
    required = false,
  ): Promise<IInputFile | null> => {
    signal.throwIfAborted();
    const file = api.join(canonical, name);
    let before: IProjectFileStat;
    try {
      const observed = await deps.fs.lstat(file);
      const regular = observed.isFile();
      const symbolic = observed.isSymbolicLink();
      before = {
        size: observed.size,
        mtimeMs: observed.mtimeMs,
        ctimeMs: observed.ctimeMs,
        ino: observed.ino,
        dev: observed.dev,
        isFile: () => regular,
        isSymbolicLink: () => symbolic,
      };
      signal.throwIfAborted();
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof Error && error.name === 'AbortError') throw error;
      if (errorCode(error) === 'ENOENT') {
        if (required) throw new NotFoundException('Project manifest');
        return null;
      }
      throw new ValidationException('Cannot read project input', {
        reason: 'UNREADABLE_INPUT',
      });
    }
    try {
      if (before.isSymbolicLink())
        throw new ForbiddenException('Linked project input is unsupported');
      if (!before.isFile())
        throw new ValidationException('Project input must be a regular file');
      const real = await deps.fs.realpath(file);
      signal.throwIfAborted();
      if (!isSameOrInside(comparable(real), rootKey, deps.platform))
        throw new ForbiddenException('Project input escapes the project');
      if (
        !Number.isSafeInteger(before.size) ||
        before.size < 0 ||
        before.size > maximum
      )
        throw inputLimit();
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of deps.fs.readChunks(file, signal)) {
        signal.throwIfAborted();
        size += chunk.byteLength;
        if (size > maximum) throw inputLimit();
        chunks.push(Buffer.from(chunk));
      }
      signal.throwIfAborted();
      const after = await deps.fs.lstat(file);
      signal.throwIfAborted();
      const afterReal = await deps.fs.realpath(file);
      signal.throwIfAborted();
      if (
        !sameStat(before, after) ||
        comparable(afterReal) !== comparable(real) ||
        size !== before.size
      )
        throw changedInput();
      const bytes = Buffer.concat(chunks, size);
      return {
        bytes,
        text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      };
    } catch (error) {
      signal.throwIfAborted();
      if (
        error instanceof AppException ||
        (error instanceof Error && error.name === 'AbortError')
      )
        throw error;
      if (errorCode(error) === 'ENOENT') throw changedInput();
      throw new ValidationException('Cannot read project input', {
        reason: 'UNREADABLE_INPUT',
      });
    }
  };

  const manifestFile = await readFixed('package.json', SMALL_INPUT_BYTES, true);
  signal.throwIfAborted();
  if (!manifestFile) throw new NotFoundException('Project manifest');
  const manifest = parseManifest(manifestFile.text);
  const warnings = new Set<ProjectAnalysisCode>();
  if (manifest.dependencies.length > 2000) warnings.add('LIMIT_EXCEEDED');
  const failedInputs = new Map<string, 'LIMIT_EXCEEDED' | 'UNREADABLE_INPUT'>();
  const readOptional = async (
    name: string,
    maximum: number,
  ): Promise<IInputFile | null> => {
    try {
      return await readFixed(name, maximum);
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof Error && error.name === 'AbortError') throw error;
      const reason: unknown =
        isProjectRecord(error) && isProjectRecord(error.details)
          ? error.details.reason
          : null;
      if (reason === 'INPUT_CHANGED') throw error;
      const code =
        reason === 'LIMIT_EXCEEDED' ? 'LIMIT_EXCEEDED' : 'UNREADABLE_INPUT';
      failedInputs.set(name, code);
      warnings.add(code);
      return null;
    }
  };
  const locks = new Map<ProjectLockName, IInputFile | null>();
  for (const name of LOCK_NAMES)
    locks.set(name, await readOptional(name, PROJECT_LOCK_BYTES));
  const selected = selectLock(manifest, locks, warnings);
  const configs = new Map<string, IInputFile | null>();
  let registryPolicy: 'REGISTRY_CONFIG_UNSUPPORTED' | null = null;
  for (const name of CONFIG_NAMES) {
    const config = await readOptional(name, SMALL_INPUT_BYTES);
    configs.set(name, config);
    if (
      failedInputs.has(name) ||
      (config && REGISTRY_CONFIG_KEY.test(config.text))
    )
      registryPolicy = 'REGISTRY_CONFIG_UNSUPPORTED';
  }
  if (registryPolicy) warnings.add(registryPolicy);
  signal.throwIfAborted();
  const hash = createHash('sha256');
  const hashField = (name: string, bytes: Buffer | null) => {
    hash.update(JSON.stringify([name, bytes?.length ?? null]));
    hash.update('\0');
    if (bytes) hash.update(bytes);
    hash.update('\0');
  };
  hashField('root', Buffer.from(rootKey));
  hashField('scanId', Buffer.from(scanId));
  hashField('package.json', manifestFile.bytes);
  for (const name of LOCK_NAMES) {
    const file = locks.get(name);
    // Keep ignored npm 12 shrinkwrap bytes in the input-change fingerprint.
    const hashContents =
      selected.name === name ||
      (selected.manager === 'npm' && name === 'npm-shrinkwrap.json');
    hashField(
      name,
      file ? (hashContents ? file.bytes : Buffer.alloc(0)) : null,
    );
  }
  for (const name of CONFIG_NAMES)
    hashField(name, configs.get(name)?.bytes ?? null);
  for (const name of [...LOCK_NAMES, ...CONFIG_NAMES]) {
    hashField(
      `failure:${name}`,
      failedInputs.has(name) ? Buffer.from(failedInputs.get(name)!) : null,
    );
  }
  const lock = selected.name ? locks.get(selected.name) : null;
  return {
    path: canonical,
    requestPath,
    scanId,
    inputHash: hash.digest('hex'),
    readAt: deps.now().toISOString(),
    manifest,
    manager: selected.manager,
    lock:
      selected.name && lock ? { name: selected.name, text: lock.text } : null,
    registryPolicy,
    warningCodes: [...warnings].sort(compareProjectText),
  };
}
