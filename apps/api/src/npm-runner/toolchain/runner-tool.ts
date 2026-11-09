import type {
  IProjectFileStat,
  ProjectManager,
} from '@/projects/interfaces/projects.types';
import type {
  IRunnerFileIdentity,
  IRunnerFs,
  IRunnerTool,
  IRunnerToolSnapshot,
  RunFailureCode,
} from '@/npm-runner/interfaces/npm-runner.types';
import { AppException } from '@/common/exceptions/app.exception';
import {
  isFullyQualifiedPath,
  isSameOrInside,
  pathApi,
  toComparable,
} from '@/common/utils/path.util';
import type { PathPlatform } from '@/common/utils/path.util';
import {
  isProjectRecord,
  jsonDepthWithinLimit,
} from '@/projects/locks/project-lock-common';
import * as semver from 'semver';

export const runnerFailure = (reason: RunFailureCode): AppException =>
  new AppException(
    409,
    'Runner input or installed tool is unavailable',
    'CONFLICT',
    { reason },
  );

const IDENTITY_FIELDS = ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'] as const;
export const sameRunnerIdentity = (
  a: IProjectFileStat,
  b: IProjectFileStat,
): boolean =>
  IDENTITY_FIELDS.every((field) => a[field] === b[field]) &&
  a.isFile() === b.isFile() &&
  a.isDirectory?.() === b.isDirectory?.() &&
  !a.isSymbolicLink() &&
  !b.isSymbolicLink();

// Snapshot native Stats: mocks and adapters must not change prechecked identity in place.
export const runnerIdentity = (
  file: string,
  stat: IProjectFileStat,
): IRunnerFileIdentity => {
  const regular = stat.isFile();
  const symbolic = stat.isSymbolicLink();
  const directory = stat.isDirectory?.();
  return {
    path: file,
    stat: {
      size: stat.size,
      ino: stat.ino,
      dev: stat.dev,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      isFile: () => regular,
      isSymbolicLink: () => symbolic,
      ...(directory === undefined ? {} : { isDirectory: () => directory }),
    },
  };
};

export interface IRunnerReadBudget {
  remaining: number;
}
export interface IRunnerTextFile {
  bytes: Buffer;
  text: string;
  identity: IRunnerFileIdentity;
}

// M5's parser is reused by input; this handle-bound reader supplies M6's extra F4 check.
export async function readRunnerFile(
  file: string,
  maximum: number,
  fs: IRunnerFs,
  signal: AbortSignal,
  platform: PathPlatform,
  options: {
    optional?: boolean;
    budget?: IRunnerReadBudget;
    checkParent?: () => Promise<void>;
    reason?: RunFailureCode;
  } = {},
): Promise<IRunnerTextFile | null> {
  const invalid = () => runnerFailure(options.reason ?? 'CONFIG_UNSUPPORTED');
  const comparable = (value: string) => toComparable(value, platform);
  signal.throwIfAborted();
  let before: IRunnerFileIdentity;
  try {
    before = runnerIdentity(file, await fs.lstat(file));
    signal.throwIfAborted();
  } catch (error) {
    signal.throwIfAborted();
    if (isProjectRecord(error) && error.code === 'ENOENT' && options.optional)
      return null;
    throw error;
  }
  if (
    !before.stat.isFile() ||
    before.stat.isSymbolicLink() ||
    !Number.isSafeInteger(before.stat.size) ||
    before.stat.size < 0 ||
    before.stat.size > maximum ||
    (options.budget && before.stat.size > options.budget.remaining)
  )
    throw invalid();
  const real = await fs.realpath(file);
  signal.throwIfAborted();
  if (comparable(real) !== comparable(file)) throw invalid();
  const handle = await fs.open(file);
  try {
    signal.throwIfAborted();
    const opened = await handle.stat();
    signal.throwIfAborted();
    if (!sameRunnerIdentity(before.stat, opened))
      throw runnerFailure('INPUT_CHANGED');
    await options.checkParent?.();
    signal.throwIfAborted();
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of handle.readChunks(signal)) {
      signal.throwIfAborted();
      size += chunk.byteLength;
      if (options.budget) options.budget.remaining -= chunk.byteLength;
      if (size > maximum || (options.budget && options.budget.remaining < 0))
        throw invalid();
      chunks.push(Buffer.from(chunk));
    }
    signal.throwIfAborted();
    const afterHandle = await handle.stat();
    signal.throwIfAborted();
    const after = await fs.lstat(file);
    signal.throwIfAborted();
    const afterReal = await fs.realpath(file);
    signal.throwIfAborted();
    await options.checkParent?.();
    signal.throwIfAborted();
    if (
      !sameRunnerIdentity(before.stat, afterHandle) ||
      !sameRunnerIdentity(before.stat, after) ||
      comparable(afterReal) !== comparable(real) ||
      size !== before.stat.size
    )
      throw runnerFailure('INPUT_CHANGED');
    const bytes = Buffer.concat(chunks, size);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw invalid();
    }
    return { bytes, text, identity: before };
  } finally {
    await handle.close();
    signal.throwIfAborted();
  }
}

export async function resolveRunnerTool(
  manager: ProjectManager,
  snapshot: IRunnerToolSnapshot,
  fs: IRunnerFs,
): Promise<IRunnerTool> {
  const { platform, signal } = snapshot;
  signal.throwIfAborted();
  if (manager !== 'npm' && manager !== 'pnpm')
    throw runnerFailure('UNSUPPORTED_MANAGER');
  if (platform !== 'win32') throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
  const api = pathApi(platform);
  const compare = (value: string) => toComparable(value, platform);
  const controlled = (value: string) =>
    snapshot.projectPaths.some(
      (project) =>
        isSameOrInside(compare(value), compare(project), platform) ||
        isSameOrInside(compare(project), compare(value), platform),
    );
  const local = (value: string) =>
    isFullyQualifiedPath(value, platform) &&
    !value.includes('\0') &&
    !value.includes('\r') &&
    !value.includes('\n') &&
    !/(?:^|[\\/])node_modules[\\/]\.bin(?:[\\/]|$)/i.test(value) &&
    !controlled(value);
  const regularIdentity = async (
    file: string,
  ): Promise<IRunnerFileIdentity> => {
    if (!local(file)) throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
    const observed = runnerIdentity(file, await fs.lstat(file));
    signal.throwIfAborted();
    if (!observed.stat.isFile() || observed.stat.isSymbolicLink())
      throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
    const real = await fs.realpath(file);
    signal.throwIfAborted();
    if (compare(real) !== compare(file) || !local(real))
      throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
    return observed;
  };
  let node = api.resolve(snapshot.execPath);
  if (
    !isFullyQualifiedPath(snapshot.execPath, platform) ||
    api.basename(node).toLowerCase() !== 'node.exe'
  )
    throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
  let nodeIdentity: IRunnerFileIdentity;
  try {
    node = api.resolve(await fs.realpath(node));
    signal.throwIfAborted();
    if (api.basename(node).toLowerCase() !== 'node.exe')
      throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
    nodeIdentity = await regularIdentity(node);
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof AppException) throw error;
    throw runnerFailure('TOOL_NOT_FOUND');
  }
  const pathValue =
    Object.entries(snapshot.env).find(
      ([key]) => key.toUpperCase() === 'PATH',
    )?.[1] ?? '';
  const prefixes =
    manager === 'npm' ? [api.dirname(node)] : pathValue.split(';');
  const seen = new Set<string>();
  let lastFailure: RunFailureCode = 'TOOL_NOT_FOUND';
  for (const prefix of prefixes) {
    signal.throwIfAborted();
    if (
      !isFullyQualifiedPath(prefix, platform) ||
      prefix.includes('\0') ||
      prefix.includes('\r') ||
      prefix.includes('\n') ||
      /(?:^|[\\/])node_modules[\\/]\.bin(?:[\\/]|$)/i.test(prefix)
    )
      continue;
    const normalized = api.resolve(prefix);
    try {
      const canonicalPrefix = api.resolve(await fs.realpath(normalized));
      signal.throwIfAborted();
      if (!local(canonicalPrefix))
        throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
      const prefixKey = compare(canonicalPrefix);
      if (seen.has(prefixKey)) continue;
      seen.add(prefixKey);
      const packageDir = api.resolve(
        await fs.realpath(api.join(canonicalPrefix, 'node_modules', manager)),
      );
      signal.throwIfAborted();
      if (!local(packageDir)) throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
      const directory = await fs.lstat(packageDir);
      signal.throwIfAborted();
      if (!directory.isDirectory?.() || directory.isSymbolicLink())
        throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
      const metadata = api.join(packageDir, 'package.json');
      const data = await readRunnerFile(
        metadata,
        1024 * 1024,
        fs,
        signal,
        platform,
        { optional: true, reason: 'TOOL_LAYOUT_UNSUPPORTED' },
      );
      signal.throwIfAborted();
      if (!data) continue;
      if (!jsonDepthWithinLimit(data.text))
        throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
      const raw: unknown = JSON.parse(data.text);
      if (
        !isProjectRecord(raw) ||
        raw.name !== manager ||
        typeof raw.version !== 'string' ||
        !semver.valid(raw.version) ||
        !isProjectRecord(raw.bin) ||
        !Object.hasOwn(raw.bin, manager)
      )
        throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
      const bin: unknown = raw.bin[manager];
      if (typeof bin !== 'string')
        throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
      if (semver.major(raw.version) !== 11)
        throw runnerFailure('TOOL_VERSION_MISMATCH');
      const entryPath = api.resolve(packageDir, bin);
      if (
        api.isAbsolute(bin) ||
        /^[A-Za-z]:/.test(bin) ||
        !isSameOrInside(compare(entryPath), compare(packageDir), platform) ||
        !/\.(?:mjs|cjs|js)$/i.test(entryPath)
      )
        throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
      const entry = api.resolve(await fs.realpath(entryPath));
      signal.throwIfAborted();
      if (
        !local(entry) ||
        !isSameOrInside(compare(entry), compare(packageDir), platform) ||
        !/\.(?:mjs|cjs|js)$/i.test(entry)
      )
        throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
      const entryIdentity = await regularIdentity(entry);
      signal.throwIfAborted();
      const selected: IRunnerTool = {
        manager,
        version: raw.version,
        file: node,
        entry,
        packageDir,
        identities: [
          nodeIdentity,
          data.identity,
          entryIdentity,
          runnerIdentity(packageDir, directory),
        ],
      };
      await revalidateRunnerTool(selected, fs, signal);
      signal.throwIfAborted();
      return selected;
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof AppException) {
        const details: unknown = isProjectRecord(error)
          ? error.details
          : undefined;
        const reason = isProjectRecord(details) ? details.reason : undefined;
        if (reason === 'INPUT_CHANGED') throw error;
        lastFailure =
          reason === 'TOOL_VERSION_MISMATCH'
            ? reason
            : 'TOOL_LAYOUT_UNSUPPORTED';
      } else if (!isProjectRecord(error) || error.code !== 'ENOENT')
        lastFailure = 'TOOL_LAYOUT_UNSUPPORTED';
    }
  }
  throw runnerFailure(lastFailure);
}

export async function revalidateRunnerTool(
  tool: IRunnerTool,
  fs: IRunnerFs,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  for (const identity of tool.identities) {
    try {
      const stat = await fs.lstat(identity.path);
      signal.throwIfAborted();
      const real = await fs.realpath(identity.path);
      signal.throwIfAborted();
      if (
        !sameRunnerIdentity(identity.stat, stat) ||
        toComparable(real, 'win32') !== toComparable(identity.path, 'win32')
      )
        throw runnerFailure('INPUT_CHANGED');
    } catch {
      signal.throwIfAborted();
      throw runnerFailure('INPUT_CHANGED');
    }
  }
}
