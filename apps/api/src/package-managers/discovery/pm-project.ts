import { createHash } from 'node:crypto';
import {
  AppException,
  NotFoundException,
} from '@/common/exceptions/app.exception';
import { pathApi, toComparable } from '@/common/utils/path.util';
import { readRunnerInput } from '@/npm-runner/toolchain/runner-input';
import {
  readRunnerFile,
  runnerIdentity,
  sameRunnerIdentity,
} from '@/npm-runner/toolchain/runner-tool';
import type {
  IRunnerFs,
  IRunnerFileIdentity,
  IRunnerTool,
  IRunnerInput,
} from '@/npm-runner/interfaces/npm-runner.types';
import {
  isProjectRecord,
  jsonDepthWithinLimit,
} from '@/projects/locks/project-lock-common';
import { isRunnerPath } from '@/npm-runner/dto/runner-path-query.dto';
import {
  parsePmPin,
  getPmTargetReason,
  assessPmPinChange,
} from '@/package-managers/pinning/pm-policy';
import { planPinEdit } from '@/package-managers/pinning/pm-manifest';
import type { IPmPinEdit } from '@/package-managers/pinning/pm-manifest';
import type {
  IPmInstalledTool,
  PmReasonCode,
  PmWritableManager,
  PmManager,
} from '@/package-managers/interfaces/pm.types';
import type {
  IPmFileStat,
  IPmProjectDeps,
  IPmProjectFacts,
  IPmCommitDeps,
  IPmCommitResult,
  IPmOwnedTemp,
} from '@/package-managers/interfaces/pm.runtime';

const MIB = 1024 * 1024;
const LOCKS = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);
const fail = (reason: PmReasonCode, status = 409) =>
  new AppException(
    status,
    'Package manager project input unavailable',
    status === 400 ? 'VALIDATION_ERROR' : 'CONFLICT',
    { reason },
  );
const errno = (error: unknown): unknown =>
  isProjectRecord(error) ? error.code : undefined;
const reasonOf = (error: unknown): PmReasonCode | null => {
  if (!(error instanceof AppException)) return null;
  const details: unknown = error.details;
  return isProjectRecord(details) && typeof details.reason === 'string'
    ? (details.reason as PmReasonCode)
    : null;
};
const safeStat = (stat: IPmFileStat): IPmFileStat => ({
  ...runnerIdentity('', stat).stat,
  nlink: stat.nlink,
});
const singleFile = (stat: IPmFileStat) =>
  stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1;
const sameObject = (
  a: IRunnerFileIdentity['stat'],
  b: IRunnerFileIdentity['stat'],
) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  !a.isSymbolicLink() &&
  !b.isSymbolicLink() &&
  a.isFile() === b.isFile() &&
  a.isDirectory?.() === b.isDirectory?.();
const sameInputIdentity = (
  a: IRunnerFileIdentity['stat'],
  b: IRunnerFileIdentity['stat'],
) => (a.isDirectory?.() ? sameObject(a, b) : sameRunnerIdentity(a, b));

/** Fresh exact-scan membership, handle-bound bytes, and static npm/pnpm facts. */
export async function readPmProject(
  requestPath: string,
  deps: IPmProjectDeps,
): Promise<IPmProjectFacts> {
  try {
    return await readPmProjectInput(requestPath, deps);
  } catch (error) {
    deps.signal.throwIfAborted();
    if (error instanceof AppException) throw error;
    throw fail(
      errno(error) === 'EACCES' || errno(error) === 'EPERM'
        ? 'ACCESS_DENIED'
        : errno(error) === 'EBUSY'
          ? 'FILE_IN_USE'
          : 'CONFIG_UNSUPPORTED',
    );
  }
}

async function readPmProjectInput(
  requestPath: string,
  deps: IPmProjectDeps,
): Promise<IPmProjectFacts> {
  const { signal, fs, platform } = deps;
  signal.throwIfAborted();
  if (platform !== 'win32' || !isRunnerPath(requestPath))
    throw fail('CONFIG_UNSUPPORTED', 400);
  const api = pathApi(platform);
  const compare = (file: string) => toComparable(file, platform);
  const resolved = api.resolve(requestPath);
  const canonical = api.resolve(await deps.assertAllowed(resolved));
  signal.throwIfAborted();
  const scan = deps.getScanSnapshot();
  if (!scan) throw new NotFoundException('Latest scan');
  const scanId = scan.scanId;
  if (
    !scan.projects.some(
      (project) => compare(project.path) === compare(canonical),
    )
  )
    throw fail('PROJECT_NOT_SCANNED');
  if (compare(canonical) !== compare(resolved)) throw fail('INPUT_CHANGED');
  const root = runnerIdentity(canonical, await fs.lstat(canonical));
  signal.throwIfAborted();
  if (!root.stat.isDirectory?.() || root.stat.isSymbolicLink())
    throw fail('CONFIG_UNSUPPORTED');
  const checkRoot = async () => {
    const stat = await fs.lstat(canonical);
    signal.throwIfAborted();
    const real = await fs.realpath(canonical);
    signal.throwIfAborted();
    if (
      !sameInputIdentity(root.stat, stat) ||
      compare(real) !== compare(canonical)
    )
      throw fail('INPUT_CHANGED');
  };
  const manifestPath = api.join(canonical, 'package.json');
  const manifestStat = safeStat(await fs.lstat(manifestPath));
  signal.throwIfAborted();
  if (!singleFile(manifestStat)) throw fail('CONFIG_UNSUPPORTED');
  const checkedFs: IRunnerFs = {
    ...fs,
    async open(file) {
      const handle = await fs.open(file);
      return {
        ...handle,
        async stat() {
          const stat = await handle.stat();
          if (compare(file) === compare(manifestPath) && !singleFile(stat))
            throw fail('CONFIG_UNSUPPORTED');
          return stat;
        },
      };
    },
  };
  const initial = await readRunnerFile(
    manifestPath,
    MIB,
    checkedFs,
    signal,
    platform,
    { checkParent: checkRoot },
  );
  signal.throwIfAborted();
  if (!initial || !sameRunnerIdentity(manifestStat, initial.identity.stat))
    throw fail('INPUT_CHANGED');
  if (!jsonDepthWithinLimit(initial.text))
    throw fail('CONFIG_UNSUPPORTED', 400);
  let raw: unknown;
  try {
    raw = JSON.parse(initial.text);
  } catch {
    throw fail('CONFIG_UNSUPPORTED', 400);
  }
  if (!isProjectRecord(raw)) throw fail('CONFIG_UNSUPPORTED', 400);
  const pin = parsePmPin(
    raw.packageManager,
    Object.hasOwn(raw, 'packageManager'),
  );
  // M6 requires string/null. A read-only projection lets M9 display inert values;
  // private bytes/hash/identity below always describe the actual original file.
  const projected =
    raw.packageManager !== null &&
    raw.packageManager !== undefined &&
    typeof raw.packageManager !== 'string'
      ? Buffer.from(JSON.stringify({ ...raw, packageManager: null }))
      : null;
  let remaining = 8 * MIB;
  const account = (file: string, size: number) => {
    if (!LOCKS.has(api.basename(file))) {
      remaining -= size;
      if (remaining < 0) throw fail('LIMIT_EXCEEDED', 400);
    }
  };
  const view: IRunnerFs = {
    ...checkedFs,
    async lstat(file) {
      const stat = await fs.lstat(file);
      return projected && compare(file) === compare(manifestPath)
        ? { ...safeStat(stat), size: projected.length }
        : stat;
    },
    async open(file) {
      const handle = await checkedFs.open(file);
      const replacement =
        projected && compare(file) === compare(manifestPath) ? projected : null;
      return {
        close: () => handle.close(),
        async stat() {
          const stat = await handle.stat();
          return replacement
            ? { ...runnerIdentity(file, stat).stat, size: replacement.length }
            : stat;
        },
        async *readChunks(readSignal) {
          if (replacement) {
            readSignal.throwIfAborted();
            account(file, initial.bytes.length);
            yield replacement;
          } else
            for await (const chunk of handle.readChunks(readSignal)) {
              account(file, chunk.byteLength);
              yield chunk;
            }
        },
      };
    },
  };
  const tools: Partial<Record<PmWritableManager, IRunnerTool>> = {};
  const toolResults = await Promise.allSettled(
    (['npm', 'pnpm'] as const).map(
      async (manager): Promise<IPmInstalledTool> => {
        try {
          const tool = await deps.resolveTool(manager);
          signal.throwIfAborted();
          const reason =
            tool.manager !== manager
              ? 'TOOL_LAYOUT_UNSUPPORTED'
              : getPmTargetReason(manager, tool.version, tool.version, false);
          if (reason)
            return {
              manager,
              version: null,
              toolPath: null,
              status: 'unavailable',
              reason,
            };
          tools[manager] = tool;
          return {
            manager,
            version: tool.version,
            toolPath: tool.entry ?? tool.file,
            status: 'available',
            reason: null,
          };
        } catch (error) {
          signal.throwIfAborted();
          const reason = reasonOf(error);
          return {
            manager,
            version: null,
            toolPath: null,
            status: 'unavailable',
            reason:
              reason === 'TOOL_NOT_FOUND' || reason === 'TOOL_VERSION_MISMATCH'
                ? reason
                : 'TOOL_LAYOUT_UNSUPPORTED',
          };
        }
      },
    ),
  );
  signal.throwIfAborted();
  const installed = toolResults.map((result) => {
    if (result.status === 'rejected') throw result.reason;
    return result.value;
  });
  let input: IRunnerInput;
  try {
    input = await readRunnerInput(requestPath, scan, {
      ...deps,
      fs: view,
      resolveTool: (manager) => {
        const tool = tools[manager];
        return tool
          ? Promise.resolve(tool)
          : Promise.reject(
              fail(
                installed.find((item) => item.manager === manager)?.reason ??
                  'TOOL_NOT_FOUND',
              ),
            );
      },
    });
  } catch (error) {
    signal.throwIfAborted();
    const latest = deps.getScanSnapshot();
    if (
      !latest ||
      latest.scanId !== scanId ||
      !latest.projects.some(
        (project) => compare(project.path) === compare(canonical),
      )
    )
      throw fail('SCAN_CHANGED');
    throw error;
  }
  signal.throwIfAborted();
  const final = await readRunnerFile(
    manifestPath,
    MIB,
    checkedFs,
    signal,
    platform,
    { checkParent: checkRoot },
  );
  signal.throwIfAborted();
  const finalStat = await fs.lstat(manifestPath);
  signal.throwIfAborted();
  if (
    !final ||
    !singleFile(finalStat) ||
    !sameRunnerIdentity(manifestStat, final.identity.stat) ||
    !initial.bytes.equals(final.bytes)
  )
    throw fail('INPUT_CHANGED');
  const latest = deps.getScanSnapshot();
  if (
    !latest ||
    latest.scanId !== scanId ||
    !latest.projects.some(
      (project) => compare(project.path) === compare(canonical),
    )
  )
    throw fail('SCAN_CHANGED');
  const lockManagers = [
    ...new Set<PmManager>(
      input.lockFiles.map((name) =>
        name === 'pnpm-lock.yaml'
          ? 'pnpm'
          : name === 'yarn.lock'
            ? 'yarn'
            : 'npm',
      ),
    ),
  ];
  let reason: PmReasonCode | null = null;
  if (input.reason === 'CONFIG_UNSUPPORTED') reason = 'CONFIG_UNSUPPORTED';
  else if (input.workspace.kind === 'leaf') reason = 'WORKSPACE_LEAF';
  else if (lockManagers.length > 1 || input.reason === 'LOCKFILE_MISMATCH')
    reason = 'LOCKFILE_MISMATCH';
  else if (pin.pinReason) reason = pin.pinReason;
  else if (input.reason === 'TOOL_VERSION_MISMATCH') reason = input.reason;
  else if (
    input.reason === 'UNSUPPORTED_MANAGER' &&
    input.identities.some((item) => api.basename(item.path) === '.yarnrc.yml')
  )
    reason = 'CONFIG_UNSUPPORTED';
  const devEnginesPresent = Object.hasOwn(raw, 'devEngines');
  if (devEnginesPresent) reason = 'CONFIG_UNSUPPORTED';
  const identities = input.identities.map((item) =>
    compare(item.path) === compare(manifestPath) ? initial.identity : item,
  );
  // Stat-only activity; never read .git content or follow a redirected .git parent.
  const activity = identities
    .filter(
      (item) =>
        item.path === manifestPath || LOCKS.has(api.basename(item.path)),
    )
    .map((item) => item.stat.mtimeMs);
  const git = api.join(canonical, '.git');
  try {
    const stat = await fs.lstat(git);
    signal.throwIfAborted();
    const real = await fs.realpath(git);
    signal.throwIfAborted();
    if (
      stat.isDirectory?.() &&
      !stat.isSymbolicLink() &&
      compare(real) === compare(git)
    ) {
      for (const name of ['HEAD', 'index']) {
        const file = api.join(git, name);
        try {
          const observed = await fs.lstat(file);
          signal.throwIfAborted();
          const observedReal = await fs.realpath(file);
          signal.throwIfAborted();
          if (
            observed.isFile() &&
            !observed.isSymbolicLink() &&
            compare(observedReal) === compare(file)
          )
            activity.push(observed.mtimeMs);
        } catch {
          signal.throwIfAborted();
        }
      }
    }
  } catch {
    signal.throwIfAborted();
  }
  await checkRoot();
  signal.throwIfAborted();
  const atEnd = deps.getScanSnapshot();
  if (
    !atEnd ||
    atEnd.scanId !== scanId ||
    !atEnd.projects.some(
      (project) => compare(project.path) === compare(canonical),
    )
  )
    throw fail('SCAN_CHANGED');
  const toolFacts = Object.entries(tools)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([manager, tool]) => [
      manager,
      tool.version,
      tool.file,
      tool.entry,
      tool.identities.map((item) => [
        compare(item.path),
        item.stat.dev,
        item.stat.ino,
        item.stat.size,
        item.stat.mtimeMs,
        item.stat.ctimeMs,
      ]),
    ]);
  return {
    bytes: Buffer.from(initial.bytes),
    manifestPath,
    manifestIdentity: manifestStat,
    identities,
    tools,
    inputHash: createHash('sha256')
      .update(input.inputHash)
      .update(initial.bytes)
      .update(JSON.stringify(toolFacts))
      .digest('hex'),
    lastActivityAt: activity.length
      ? new Date(Math.max(...activity)).toISOString()
      : null,
    context: {
      ...pin,
      path: canonical,
      projectName:
        typeof raw.name === 'string' ? raw.name : api.basename(canonical),
      scanId,
      asOf: deps.now().toISOString(),
      installed: [
        ...installed,
        {
          manager: 'yarn',
          version: null,
          toolPath: null,
          status: 'unsupported',
          reason: 'UNSUPPORTED_MANAGER',
        },
      ],
      lockManagers,
      workspace: input.workspace,
      devEnginesPresent,
      reason,
      warnings: devEnginesPresent
        ? ['PIN_DOES_NOT_SWITCH_RUNNER', 'DEV_ENGINES_NOT_MANAGED']
        : ['PIN_DOES_NOT_SWITCH_RUNNER'],
    },
  };
}

function assertSameFacts(
  previous: IPmProjectFacts,
  current: IPmProjectFacts,
  deps: IPmProjectDeps,
): void {
  if (previous.context.scanId !== current.context.scanId)
    throw fail('SCAN_CHANGED');
  if (
    previous.inputHash !== current.inputHash ||
    !previous.bytes.equals(current.bytes) ||
    !sameRunnerIdentity(previous.manifestIdentity, current.manifestIdentity) ||
    previous.identities.length !== current.identities.length
  )
    throw fail('PREVIEW_CHANGED');
  const compare = (file: string) => toComparable(file, deps.platform);
  for (const item of previous.identities) {
    const now = current.identities.find(
      (other) => compare(item.path) === compare(other.path),
    );
    if (!now || !sameInputIdentity(item.stat, now.stat))
      throw fail('PREVIEW_CHANGED');
  }
}

/** Cleanup-only retry: proves wx-owned inode and parent; never targets package.json. */
export async function cleanupPmTemp(
  temp: IPmOwnedTemp,
  deps: IPmProjectDeps,
): Promise<void> {
  const { fs, platform } = deps;
  try {
    if (temp.handle) {
      temp.identity ??= safeStat(await temp.handle.stat());
      await temp.handle.close();
      temp.handle = null;
    }
    if (
      !temp.identity ||
      !/package\.json\.[a-f0-9-]+\.pkgsteward-tmp$/i.test(
        pathApi(platform).basename(temp.path),
      )
    )
      throw fail('TEMP_CLEANUP_FAILED');
    const stat = await fs.lstat(temp.path);
    const real = await fs.realpath(temp.path);
    const allowed = await deps.assertAllowed(
      pathApi(platform).dirname(temp.path),
    );
    if (
      !singleFile(stat) ||
      !sameObject(temp.identity, stat) ||
      toComparable(real, platform) !== toComparable(temp.path, platform) ||
      toComparable(allowed, platform) !==
        toComparable(pathApi(platform).dirname(temp.path), platform)
    )
      throw fail('TEMP_CLEANUP_FAILED');
    await fs.unlink(temp.path);
  } catch (error) {
    if (errno(error) === 'ENOENT' && !temp.handle && temp.identity) return;
    throw fail('TEMP_CLEANUP_FAILED');
  }
}

/** Returns complete private outcome even on ambiguous writes; caller keeps the gate. */
export async function commitPmPin(
  facts: IPmProjectFacts,
  edit: IPmPinEdit,
  signal: AbortSignal,
  deps: IPmCommitDeps,
): Promise<IPmCommitResult> {
  const state: IPmCommitResult = {
    mutationStarted: false,
    mayHaveChanged: false,
    fileCommitted: false,
    observedPin: null,
    cleanupRequired: false,
    failureCode: null,
    temp: null,
  };
  const local = { ...deps, signal };
  const compare = (file: string) => toComparable(file, deps.platform);
  try {
    signal.throwIfAborted();
    const target = parsePmPin(edit.summary.after).parsedPin;
    if (!target || target.manager === 'yarn')
      throw fail('TARGET_VERSION_UNSUPPORTED');
    const planned = planPinEdit(facts.bytes, edit.summary.after);
    if (!planned.bytes.equals(edit.bytes)) throw fail('PREVIEW_CHANGED');
    const current = await readPmProject(facts.context.path, local);
    signal.throwIfAborted();
    assertSameFacts(facts, current, local);
    const installed = current.context.installed.find(
      (item) => item.manager === target.manager,
    )!;
    const decision = assessPmPinChange({
      pin: current.context,
      manager: target.manager,
      installed,
      targetVersion: target.version,
      lockManagers: current.context.lockManagers,
      workspace: current.context.workspace,
      devEnginesPresent: current.context.devEnginesPresent,
      inputReason: current.context.reason,
    });
    if (!decision.eligible) throw fail(decision.reason ?? 'PREVIEW_CHANGED');
    const uuid = deps.uuid();
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
        uuid,
      )
    )
      throw fail('MANIFEST_WRITE_FAILED');
    const tempPath = `${facts.manifestPath}.${uuid}.pkgsteward-tmp`;
    state.mutationStarted = true;
    const handle = await deps.fs.openExclusive(tempPath, 'wx');
    state.temp = { path: tempPath, identity: null, handle };
    // Never race a write/close against an abort or free the gate before settlement.
    state.temp.identity = safeStat(await handle.stat());
    signal.throwIfAborted();
    if (!singleFile(state.temp.identity)) throw fail('MANIFEST_WRITE_FAILED');
    await handle.write(planned.bytes);
    signal.throwIfAborted();
    await handle.sync();
    signal.throwIfAborted();
    await handle.close();
    state.temp.handle = null;
    signal.throwIfAborted();
    const final = await readPmProject(facts.context.path, local);
    signal.throwIfAborted();
    assertSameFacts(facts, final, local);
    await deps.beforeRename();
    signal.throwIfAborted();
    const tempStat = await deps.fs.lstat(tempPath);
    signal.throwIfAborted();
    const tempReal = await deps.fs.realpath(tempPath);
    signal.throwIfAborted();
    if (
      !singleFile(tempStat) ||
      !sameObject(state.temp.identity, tempStat) ||
      compare(tempReal) !== compare(tempPath)
    )
      throw fail('PREVIEW_CHANGED');
    const present = new Set(final.identities.map((item) => compare(item.path)));
    for (const directory of final.identities.filter((item) =>
      item.stat.isDirectory?.(),
    )) {
      const names =
        compare(directory.path) === compare(facts.context.path)
          ? [
              'package.json',
              ...LOCKS,
              '.npmrc',
              '.yarnrc',
              '.yarnrc.yml',
              'pnpm-workspace.yaml',
            ]
          : ['package.json', 'pnpm-workspace.yaml', '.npmrc', '.yarnrc.yml'];
      for (const name of names) {
        const file = pathApi(deps.platform).join(directory.path, name);
        if (present.has(compare(file))) continue;
        try {
          await deps.fs.lstat(file);
          throw fail('PREVIEW_CHANGED');
        } catch (error) {
          signal.throwIfAborted();
          if (errno(error) !== 'ENOENT') throw fail('PREVIEW_CHANGED');
        }
      }
    }
    // Repeat path/scan/root/file identity checks at the final local boundary.
    const allowed = await deps.assertAllowed(facts.context.path);
    signal.throwIfAborted();
    if (compare(allowed) !== compare(facts.context.path))
      throw fail('PREVIEW_CHANGED');
    const boundaryIdentities = [
      ...final.identities.filter(
        (item) =>
          compare(item.path) !== compare(facts.context.path) &&
          compare(item.path) !== compare(facts.manifestPath),
      ),
      ...final.identities.filter(
        (item) => compare(item.path) === compare(facts.context.path),
      ),
      ...final.identities.filter(
        (item) => compare(item.path) === compare(facts.manifestPath),
      ),
    ];
    for (const item of boundaryIdentities) {
      const stat = await deps.fs.lstat(item.path);
      signal.throwIfAborted();
      const real = await deps.fs.realpath(item.path);
      signal.throwIfAborted();
      if (
        !sameInputIdentity(item.stat, stat) ||
        compare(real) !== compare(item.path) ||
        (compare(item.path) === compare(facts.manifestPath) &&
          !singleFile(stat))
      )
        throw fail('PREVIEW_CHANGED');
    }
    const scan = deps.getScanSnapshot();
    if (
      !scan ||
      scan.scanId !== facts.context.scanId ||
      !scan.projects.some(
        (item) => compare(item.path) === compare(facts.context.path),
      )
    )
      throw fail('SCAN_CHANGED');
    await deps.beforeRename();
    signal.throwIfAborted();
    state.mayHaveChanged = true; // Set BEFORE the uninterruptible rename await.
    try {
      await deps.fs.rename(tempPath, facts.manifestPath);
      state.fileCommitted = true;
    } catch (error) {
      // Windows reports a locked target as EBUSY or EPERM.
      const code = errno(error);
      state.failureCode =
        code === 'EBUSY' || code === 'EPERM'
          ? 'FILE_IN_USE'
          : code === 'EACCES'
            ? 'ACCESS_DENIED'
            : 'MANIFEST_WRITE_FAILED';
    }
    // Cancellation after rename must not prevent observing the actual outcome.
    const observationSignal = new AbortController().signal;
    try {
      const observed = await readRunnerFile(
        facts.manifestPath,
        MIB,
        deps.fs,
        observationSignal,
        deps.platform,
        {
          checkParent: async () => {
            const root = facts.identities.find(
              (item) => compare(item.path) === compare(facts.context.path),
            );
            const stat = await deps.fs.lstat(facts.context.path);
            const real = await deps.fs.realpath(facts.context.path);
            if (
              !root ||
              !sameObject(root.stat, stat) ||
              compare(real) !== compare(facts.context.path)
            )
              throw fail('POSTCONDITION_FAILED');
          },
        },
      );
      const stat = await deps.fs.lstat(facts.manifestPath);
      const value: unknown = observed ? JSON.parse(observed.text) : null;
      if (isProjectRecord(value))
        state.observedPin = parsePmPin(value.packageManager).rawPin;
      const verified =
        !!observed &&
        singleFile(stat) &&
        sameObject(state.temp.identity, observed.identity.stat) &&
        observed.bytes.equals(planned.bytes) &&
        state.observedPin === planned.summary.after;
      if (verified) state.fileCommitted = true;
      else if (
        !state.fileCommitted &&
        !!observed &&
        observed.bytes.equals(facts.bytes) &&
        sameRunnerIdentity(facts.manifestIdentity, observed.identity.stat)
      )
        // The rename failed and the original manifest is proven intact.
        state.mayHaveChanged = false;
      else if (!state.failureCode) state.failureCode = 'POSTCONDITION_FAILED';
    } catch {
      state.failureCode ??= 'POSTCONDITION_FAILED';
    }
  } catch (error) {
    state.failureCode =
      signal.aborted && !state.mayHaveChanged
        ? 'CANCELLED'
        : (reasonOf(error) ??
          (errno(error) === 'EACCES'
            ? 'ACCESS_DENIED'
            : errno(error) === 'EBUSY'
              ? 'FILE_IN_USE'
              : 'MANIFEST_WRITE_FAILED'));
  }
  if (state.temp) {
    try {
      await cleanupPmTemp(state.temp, {
        ...deps,
        signal: new AbortController().signal,
      });
      state.temp = null;
    } catch {
      state.cleanupRequired = true;
      state.failureCode ??= 'TEMP_CLEANUP_FAILED';
    }
  }
  return state;
}
