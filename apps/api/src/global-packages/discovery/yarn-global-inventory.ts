import * as classicLock from '@yarnpkg/lockfile';
import { win32 } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { AppException } from '@/common/exceptions/app.exception';
import {
  parsePnpm10Json,
  readPnpm10File,
} from '@/global-packages/config/pnpm10-global-config';
import type {
  IGlobalInventoryDeps,
  IGlobalInventoryResult,
} from '@/global-packages/discovery/global-inventory';
import {
  assertGlobalDirectory,
  readGlobalDirectory,
} from '@/global-packages/discovery/global-location';
import { isGlobalAbsolutePath } from '@/global-packages/execution/global-command';
import type {
  IGlobalBinOwner,
  IGlobalConfigIdentity,
  IGlobalPackageFacts,
  IGlobalResolvedLocation,
} from '@/global-packages/interfaces/global-packages.runtime';
import type {
  IGlobalPackage,
  GlobalReasonCode,
} from '@/global-packages/interfaces/global-packages.types';
import type {
  IYarnDependencyFacts,
  IYarnGlobalInventoryFacts,
} from '@/global-packages/interfaces/yarn-global.types';
import {
  assertGlobalPackageMutable,
  isGlobalPackageName,
  normalizeGlobalBins,
} from '@/global-packages/policy/global-policy';
import {
  proveYarnBinSet,
  proveYarnLocalBinShim,
  readYarnBinDirectory,
} from '@/global-packages/policy/yarn-shim';
import type {
  IRunnerFileIdentity,
  IRunnerFs,
} from '@/npm-runner/interfaces/npm-runner.types';
import {
  runnerIdentity,
  sameRunnerIdentity,
} from '@/npm-runner/toolchain/runner-tool';
import {
  isProjectRecord,
  PROJECT_LOCK_BYTES,
  PROJECT_LOCK_RECORDS,
  registrySourceName,
  yamlDepthWithinLimit,
} from '@/projects/locks/project-lock-common';
import * as semver from 'semver';

const key = (path: string) => win32.resolve(path).toLowerCase();
const inside = (path: string, parent: string): boolean =>
  key(path) === key(parent) || key(path).startsWith(`${key(parent)}\\`);
const binStem = (name: string): string =>
  name.toLowerCase().replace(/\.(?:cmd|ps1|exe|bat|com)$/i, '');

const failed = (reason: GlobalReasonCode = 'INVENTORY_FAILED'): never => {
  throw new AppException(
    409,
    'Yarn global inventory could not be read',
    'CONFLICT',
    {
      reason,
    },
  );
};

const isExactSemver = (v: unknown): v is string => {
  if (typeof v !== 'string') return false;
  const parsed = semver.parse(v);
  if (!parsed) return false;
  const canonical =
    parsed.version + (parsed.build.length ? `+${parsed.build.join('.')}` : '');
  return v === canonical;
};

const isTrustedLockProvenance = (
  depName: string,
  expectedVersion: string,
  lockEntry: unknown,
): boolean => {
  if (!isProjectRecord(lockEntry)) return false;
  if (lockEntry.version !== expectedVersion) return false;
  if (registrySourceName(lockEntry.resolved, true) !== depName) return false;
  const hasIntegrity =
    typeof lockEntry.integrity === 'string' &&
    lockEntry.integrity.trim().length > 0;
  const hasSha1Fragment =
    typeof lockEntry.resolved === 'string' &&
    /#[0-9a-f]{40}$/i.test(lockEntry.resolved);
  return hasIntegrity || hasSha1Fragment;
};

function parseDependencyMap(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!isProjectRecord(value)) return failed();
  const entries = Object.entries(value);
  if (entries.length > 10_000) return failed('LIMIT_EXCEEDED');
  const names = new Set<string>();
  for (const [name, spec] of entries) {
    if (
      !isGlobalPackageName(name) ||
      names.has(name.toLowerCase()) ||
      typeof spec !== 'string' ||
      !spec ||
      spec.length > 8192 ||
      Array.from(spec).some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      )
    )
      return failed();
    names.add(name.toLowerCase());
  }
  return value as Record<string, string>;
}

function parseYarnLockRecords(text: string): Record<string, unknown> {
  if (Buffer.byteLength(text) > PROJECT_LOCK_BYTES)
    return failed('LIMIT_EXCEEDED');
  if (text.includes('<<<<<<<')) return failed();
  if (/^[ \t]*(?:__metadata|"__metadata"|'__metadata')\s*:/m.test(text))
    return failed();
  if (!yamlDepthWithinLimit(text)) return failed();
  const boundedText = `${text}\n# "\n`;
  let parsed: unknown;
  try {
    parsed = classicLock.parse(boundedText);
  } catch {
    return failed();
  }
  if (
    !isProjectRecord(parsed) ||
    parsed.type !== 'success' ||
    !isProjectRecord(parsed.object)
  )
    return failed();
  if (Object.keys(parsed.object).length > PROJECT_LOCK_RECORDS)
    return failed('LIMIT_EXCEEDED');
  return parsed.object;
}

class YarnInventoryReader {
  private readonly budget = { remaining: 32 * 1024 * 1024 };
  private work = 0;
  private entryCount = 0;
  private readonly files: IGlobalConfigIdentity[] = [];
  private readonly missingPaths: string[] = [];
  private readonly enumerations: { path: string; entries: string[] }[] = [];
  private readonly dependencies: IYarnDependencyFacts[] = [];
  private readonly owners = new Map<string, string | null>();

  constructor(
    private readonly location: IGlobalResolvedLocation,
    private readonly fs: IRunnerFs,
    private readonly signal: AbortSignal,
  ) {}

  private async checkpoint(): Promise<void> {
    this.signal.throwIfAborted();
    if (++this.work % 128 === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      this.signal.throwIfAborted();
    }
  }

  private async guard(path: string, allowMissing = false): Promise<void> {
    if (!isGlobalAbsolutePath(path) || path.split(/[\\/]+/).length > 64)
      return failed('LIMIT_EXCEEDED');
    await assertGlobalDirectory(path, this.fs, this.signal, allowMissing);
  }

  private async identity(path: string): Promise<IRunnerFileIdentity> {
    await this.checkpoint();
    const stat = await this.fs.lstat(path);
    this.signal.throwIfAborted();
    return runnerIdentity(path, stat);
  }

  private async readJson(
    path: string,
    optional = false,
  ): Promise<{
    value: Record<string, unknown>;
    identity: IGlobalConfigIdentity;
  } | null> {
    await this.checkpoint();
    const data = await readPnpm10File(
      path,
      1024 * 1024,
      this.fs,
      this.signal,
      this.budget,
      () => this.guard(win32.dirname(path), optional),
    );
    if (!data) {
      if (!optional) return failed();
      this.missingPaths.push(path);
      return null;
    }
    this.recordFile(data.identity);
    const parsed = parsePnpm10Json(data.text);
    if (!isProjectRecord(parsed)) return failed();
    return { value: parsed, identity: data.identity };
  }

  private async readLockText(path: string): Promise<{
    records: Record<string, unknown>;
    identity: IGlobalConfigIdentity;
  } | null> {
    await this.checkpoint();
    const data = await readPnpm10File(
      path,
      PROJECT_LOCK_BYTES,
      this.fs,
      this.signal,
      this.budget,
      () => this.guard(win32.dirname(path), true),
    );
    if (!data) {
      this.missingPaths.push(path);
      return null;
    }
    this.recordFile(data.identity);
    return {
      records: parseYarnLockRecords(data.text),
      identity: data.identity,
    };
  }

  private recordFile(identity: IGlobalConfigIdentity): void {
    const previous = this.files.find(
      (f) => key(f.file.path) === key(identity.file.path),
    );
    if (previous) {
      if (
        !sameRunnerIdentity(previous.file.stat, identity.file.stat) ||
        previous.sha256 !== identity.sha256
      )
        return failed();
      return;
    }
    this.files.push(identity);
  }

  private async listDirectory(path: string): Promise<readonly string[]> {
    await this.guard(path);
    const names = [
      ...(await readGlobalDirectory(this.fs, path, this.signal)),
    ].sort();
    this.entryCount += names.length;
    if (this.entryCount > 40_000) return failed('LIMIT_EXCEEDED');
    if (new Set(names.map((n) => n.toLowerCase())).size !== names.length)
      return failed();
    const previous = this.enumerations.find((e) => key(e.path) === key(path));
    if (previous) {
      if (!isDeepStrictEqual(previous.entries, names)) return failed();
    } else {
      this.enumerations.push({ path, entries: names });
    }
    return names;
  }

  private own(bin: string, owner: string | null): void {
    const stem = binStem(bin);
    if (owner === null) {
      this.owners.set(stem, null);
      return;
    }
    if (this.owners.has(stem) && this.owners.get(stem) !== owner)
      this.owners.set(stem, null);
    else this.owners.set(stem, owner);
  }

  async read(): Promise<IGlobalInventoryResult> {
    const config = this.location.yarn;
    if (!config || this.location.manager !== 'yarn') return failed();
    await this.guard(config.globalDir, true);
    const manifestRes = await this.readJson(
      win32.join(config.globalDir, 'package.json'),
      true,
    );
    const lockRes = await this.readLockText(
      win32.join(config.globalDir, 'yarn.lock'),
    );
    const globalBinDirRes = await readYarnBinDirectory({
      fs: this.fs,
      signal: this.signal,
      binDir: config.binDir,
      budget: this.budget,
      allowMissing: true,
    });
    if (globalBinDirRes.missing) this.missingPaths.push(config.binDir);

    if (!manifestRes) {
      const binOwners = this.buildBinOwners(globalBinDirRes.slots);
      return {
        packages: [],
        facts: [],
        binOwners,
        ownershipComplete: globalBinDirRes.complete,
        yarnInventory: {
          ownershipComplete: globalBinDirRes.complete,
          project: {
            manifest: null,
            lockfile: lockRes?.identity ?? null,
            dependencies: [],
            missingPaths: [...new Set(this.missingPaths)].sort(),
            files: this.files,
            enumerations: this.enumerations,
          },
          binSlots: globalBinDirRes.slots,
        },
      };
    }

    const manifest = manifestRes.value;
    for (const field of ['devDependencies', 'optionalDependencies']) {
      if (
        manifest[field] !== undefined &&
        (!isProjectRecord(manifest[field]) ||
          Object.keys(manifest[field]).length > 0)
      )
        return failed();
    }
    const depsMap = parseDependencyMap(manifest.dependencies);
    const depNames = Object.keys(depsMap).sort();

    if (depNames.length === 0) {
      const binOwners = this.buildBinOwners(globalBinDirRes.slots);
      return {
        packages: [],
        facts: [],
        binOwners,
        ownershipComplete: globalBinDirRes.complete,
        yarnInventory: {
          ownershipComplete: globalBinDirRes.complete,
          project: {
            manifest: manifestRes.identity,
            lockfile: lockRes?.identity ?? null,
            dependencies: [],
            missingPaths: [...new Set(this.missingPaths)].sort(),
            files: this.files,
            enumerations: this.enumerations,
          },
          binSlots: globalBinDirRes.slots,
        },
      };
    }

    if (!lockRes) return failed();
    await this.guard(config.globalRoot);
    await this.listDirectory(config.globalRoot);

    const globalDotBinDir = win32.join(config.globalRoot, '.bin');
    const localBinDirRes = await readYarnBinDirectory({
      fs: this.fs,
      signal: this.signal,
      binDir: globalDotBinDir,
      budget: this.budget,
      allowMissing: true,
    });
    if (localBinDirRes.missing) this.missingPaths.push(globalDotBinDir);
    const hasRogueLocalNode = localBinDirRes.slots.some((s) =>
      /^node(?:\.(?:exe|cmd|bat|com|ps1))?$/i.test(s.name),
    );

    const rows: IGlobalPackage[] = [];
    const facts: IGlobalPackageFacts[] = [];
    let ownershipComplete =
      globalBinDirRes.complete && localBinDirRes.complete && !hasRogueLocalNode;

    for (const depName of depNames) {
      await this.checkpoint();
      const spec = depsMap[depName];
      const logicalPath = win32.join(config.globalRoot, ...depName.split('/'));
      await this.guard(win32.dirname(logicalPath));
      const rootIdentity = await this.identity(logicalPath);
      const realPath = await this.fs.realpath(logicalPath);
      this.signal.throwIfAborted();
      if (!isGlobalAbsolutePath(realPath)) return failed();

      const descriptor = `${depName}@${spec}`;
      const lockEntry = lockRes.records[descriptor];
      const isLinked =
        rootIdentity.stat.isSymbolicLink() ||
        key(realPath) !== key(logicalPath) ||
        /^(?:link:|file:|git\+|git:|github:|gitlab:|bitbucket:|https?:|ssh:|workspace:|npm:)/i.test(
          spec,
        ) ||
        (!spec.startsWith('@') && spec.includes('/'));

      if (isLinked) {
        this.dependencies.push({
          name: depName,
          spec,
          version: spec,
          linked: true,
          logicalPath,
          realPath,
          linkIdentity: rootIdentity,
          manifest: null,
          bins: [],
          binIdentities: [],
          shims: [],
        });
        rows.push({
          name: depName,
          version: spec,
          bins: [],
          status: 'linked',
          reason: 'LINKED_PACKAGE',
        });
        facts.push({
          name: depName,
          version: spec,
          packageRoot: logicalPath,
          manifest: manifestRes.identity,
          bins: [],
          binIdentities: [],
        });
        continue;
      }

      if (!rootIdentity.stat.isDirectory?.()) return failed();
      await this.guard(realPath);
      const pkgManifestRes = await this.readJson(
        win32.join(realPath, 'package.json'),
      );
      if (!pkgManifestRes) return failed();
      const pkgManifest = pkgManifestRes.value;
      if (
        pkgManifest.name !== depName ||
        !isExactSemver(pkgManifest.version) ||
        !isTrustedLockProvenance(depName, pkgManifest.version, lockEntry)
      )
        return failed();

      const bins = normalizeGlobalBins(depName, pkgManifest.bin);
      const binIdentities: IRunnerFileIdentity[] = [];
      let shimsValid = globalBinDirRes.complete && localBinDirRes.complete;
      const shims: IGlobalConfigIdentity[] = [];

      for (const bin of bins) {
        const targetFile = win32.resolve(realPath, bin.target);
        if (!inside(targetFile, realPath)) return failed();
        await this.guard(win32.dirname(targetFile));
        const targetId = await this.identity(targetFile);
        if (
          !targetId.stat.isFile() ||
          targetId.stat.isSymbolicLink() ||
          key(await this.fs.realpath(targetFile)) !== key(targetFile)
        )
          return failed();
        this.signal.throwIfAborted();
        binIdentities.push(targetId);

        let localOk = !localBinDirRes.missing && !hasRogueLocalNode;
        for (const ext of ['', '.cmd']) {
          const nameLower = `${bin.name}${ext}`.toLowerCase();
          const localSlot = localBinDirRes.slots.find(
            (s) => s.name.toLowerCase() === nameLower,
          );
          const localText = localBinDirRes.texts.get(nameLower);
          if (
            !localSlot ||
            localText === undefined ||
            !localSlot.sha256 ||
            !proveYarnLocalBinShim({
              text: localText,
              shimPath: localSlot.identity.path,
              globalDotBinDir,
              targetFile,
              binName: bin.name,
            })
          ) {
            localOk = false;
          } else {
            localSlot.owner = depName;
          }
        }
        const globalSet = proveYarnBinSet({
          directory: globalBinDirRes,
          binDir: config.binDir,
          globalDotBinDir,
          binName: bin.name,
          nodePath: this.location.tool.file,
        });
        if (!localOk || !globalSet) {
          shimsValid = false;
          this.own(bin.name, null);
          ownershipComplete = false;
        } else {
          shims.push(...globalSet);
          this.own(bin.name, depName);
          for (const provenFile of globalSet) {
            const slot = globalBinDirRes.slots.find(
              (s) => key(s.identity.path) === key(provenFile.file.path),
            )!;
            slot.owner = depName;
          }
        }
      }

      const depFact: IYarnDependencyFacts = {
        name: depName,
        spec,
        version: pkgManifest.version,
        linked: false,
        logicalPath,
        realPath,
        linkIdentity: null,
        manifest: pkgManifestRes.identity,
        bins,
        binIdentities,
        shims,
      };
      this.dependencies.push(depFact);
      facts.push({
        name: depName,
        version: pkgManifest.version,
        packageRoot: realPath,
        manifest: pkgManifestRes.identity,
        bins: [...bins],
        binIdentities,
      });

      const row: IGlobalPackage = {
        name: depName,
        version: pkgManifest.version,
        bins: [...bins],
        status: shimsValid ? 'manageable' : 'invalid',
        reason: shimsValid ? null : 'BIN_CONFLICT',
      };
      try {
        assertGlobalPackageMutable({
          packageName: depName,
          packageRoot: realPath,
          linked: false,
          currentBins: bins,
          targetBins: [],
          binOwners: [],
          ownershipComplete: true,
          protectedPaths: this.location.protectedPaths,
        });
      } catch (error) {
        this.signal.throwIfAborted();
        if (
          error instanceof AppException &&
          isProjectRecord(error.details) &&
          error.details.reason === 'PROTECTED_PACKAGE'
        ) {
          row.status = 'protected';
          row.reason = 'PROTECTED_PACKAGE';
        } else {
          row.status = 'invalid';
          row.reason = 'BIN_CONFLICT';
        }
      }
      rows.push(row);
    }

    const binOwners = this.buildBinOwners(globalBinDirRes.slots);
    for (const row of rows) {
      if (
        row.status === 'manageable' &&
        row.bins.some((bin) => this.owners.get(binStem(bin.name)) !== row.name)
      ) {
        row.status = 'invalid';
        row.reason = 'BIN_CONFLICT';
        ownershipComplete = false;
      }
    }
    const inventoryFacts: IYarnGlobalInventoryFacts = {
      ownershipComplete,
      project: {
        manifest: manifestRes.identity,
        lockfile: lockRes.identity,
        dependencies: this.dependencies,
        missingPaths: [...new Set(this.missingPaths)].sort(),
        files: this.files,
        enumerations: this.enumerations,
      },
      binSlots: globalBinDirRes.slots,
    };
    return {
      packages: rows.sort((a, b) => a.name.localeCompare(b.name)),
      facts: facts.sort((a, b) => a.name.localeCompare(b.name)),
      binOwners,
      ownershipComplete,
      yarnInventory: inventoryFacts,
    };
  }

  private buildBinOwners(
    slots: readonly IYarnGlobalInventoryFacts['binSlots'][number][],
  ): IGlobalBinOwner[] {
    for (const slot of slots) {
      if (slot.owner === null) this.own(slot.name, null);
    }
    return [...this.owners.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, owner]) => ({ name, owner }));
  }
}

export async function readYarnGlobalInventory(
  location: IGlobalResolvedLocation,
  deps: IGlobalInventoryDeps,
): Promise<IGlobalInventoryResult> {
  return await new YarnInventoryReader(location, deps.fs, deps.signal).read();
}
