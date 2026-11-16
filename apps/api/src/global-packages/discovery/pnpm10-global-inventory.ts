import { win32 } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { valid as validVersion, validRange } from 'semver';
import { isAlias, isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { AppException } from '@/common/exceptions/app.exception';
import type {
  IGlobalInventoryDeps,
  IGlobalInventoryResult,
} from '@/global-packages/discovery/global-inventory';
import type {
  IGlobalConfigIdentity,
  IGlobalResolvedLocation,
} from '@/global-packages/interfaces/global-packages.runtime';
import type {
  IGlobalPackage,
  IGlobalBin,
} from '@/global-packages/interfaces/global-packages.types';
import type {
  IPnpm10DependencyFacts,
  IPnpm10GlobalProjectFacts,
} from '@/global-packages/interfaces/pnpm10-global.types';
import type { IRunnerFileIdentity } from '@/npm-runner/interfaces/npm-runner.types';
import { runnerIdentity } from '@/npm-runner/toolchain/runner-tool';
import {
  parsePnpm10Json,
  readPnpm10File,
} from '@/global-packages/config/pnpm10-global-config';
import {
  assertGlobalDirectory,
  readGlobalDirectory,
  assertPnpm10LocationLayout,
} from '@/global-packages/discovery/global-location';
import {
  isGlobalAbsolutePath,
  isGlobalExactVersion,
} from '@/global-packages/execution/global-command';
import {
  isGlobalPackageName,
  normalizeGlobalBins,
  assertGlobalPackageMutable,
} from '@/global-packages/policy/global-policy';
import {
  readPnpm10BinDirectory,
  provePnpm10BinSet,
} from '@/global-packages/policy/pnpm10-shim';
import type { IPnpm10BinDirectory } from '@/global-packages/policy/pnpm10-shim';

const failed = (reason = 'INVENTORY_FAILED'): never => {
  throw new AppException(
    409,
    'pnpm 10 global inventory is incomplete',
    'CONFLICT',
    { reason },
  );
};
const key = (p: string): string => win32.resolve(p).toLowerCase();
const inside = (p: string, parent: string): boolean =>
  key(p).startsWith(`${key(parent)}\\`);
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
// Same narrow registry resolution accepted by the direct reader. Locator text
// alone never proves registry provenance (a tarball can use the same key).
const registryResolution = (value: unknown): boolean =>
  record(value) &&
  Object.keys(value).length === 1 &&
  typeof value.integrity === 'string' &&
  /^sha(?:256|384|512)-[a-z0-9+/=]+$/i.test(value.integrity);
const missing = (e: unknown): boolean => record(e) && e.code === 'ENOENT';
const sameEntry = (a: IRunnerFileIdentity, b: IRunnerFileIdentity): boolean =>
  key(a.path) === key(b.path) &&
  (['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'] as const).every(
    (f) => a.stat[f] === b.stat[f],
  ) &&
  a.stat.isFile() === b.stat.isFile() &&
  a.stat.isDirectory?.() === b.stat.isDirectory?.() &&
  a.stat.isSymbolicLink() === b.stat.isSymbolicLink();

// pnpm.cjs:116033-116053,52303-52307. The dependency path includes peers;
// don't infer the store directory from just manifest name/version.
export function pnpm10DepPathToFilename(
  depPath: string,
  maximum: number,
): string {
  if (
    !Number.isSafeInteger(maximum) ||
    maximum < 34 ||
    maximum > 120 ||
    depPath.length > 8192
  )
    return failed();
  let filename = depPath.replace(/^\//, '').replace(/[\\/:*?"<>|#]/g, '+');
  if (filename.includes('('))
    filename = filename.replace(/\)$/, '').replace(/\)\(|\(|\)/g, '_');
  if (
    filename.length > maximum ||
    (filename !== filename.toLowerCase() && !filename.startsWith('file+'))
  )
    return `${filename.substring(0, maximum - 33)}_${createHash('sha256').update(filename).digest('hex').substring(0, 32)}`;
  return filename;
}

function dataObject(text: string, json: boolean): Record<string, unknown> {
  if (json) {
    const value = parsePnpm10Json(text);
    if (!record(value)) return failed();
    return value;
  }
  const doc = parseDocument(text, { uniqueKeys: true, merge: false });
  if (doc.errors.length || doc.warnings.length) return failed();
  let nodes = 0;
  const inspect = (node: unknown, depth: number): void => {
    if (++nodes > 200_000 || depth > 64 || isAlias(node)) return failed();
    if (isMap(node) || isSeq(node) || isScalar(node)) {
      if (node.tag || node.anchor) return failed();
      if (isMap(node))
        for (const pair of node.items) {
          if (
            !isScalar(pair.key) ||
            typeof pair.key.value !== 'string' ||
            ['__proto__', 'prototype', 'constructor', '<<'].includes(
              pair.key.value,
            )
          )
            return failed();
          inspect(pair.key, depth + 1);
          inspect(pair.value, depth + 1);
        }
      else if (isSeq(node))
        for (const value of node.items) inspect(value, depth + 1);
    }
  };
  inspect(doc.contents, 0);
  const value: unknown = doc.toJS({ maxAliasCount: 0 });
  if (!record(value)) return failed();
  return value;
}

class Pnpm10InventoryReader {
  private readonly budget = { remaining: 32 * 1024 * 1024 };
  private work = 0;
  private entryCount = 0;
  private readonly files: IGlobalConfigIdentity[] = [];
  private readonly absent: string[] = [];
  private readonly dependencies: IPnpm10DependencyFacts[] = [];
  private readonly ancillary: IPnpm10GlobalProjectFacts['ancillary'][number][] =
    [];
  private readonly enumerations = new Map<string, readonly string[]>();
  private readonly owners = new Map<string, string | null>();
  private readonly privateHoists: (Pick<
    IPnpm10DependencyFacts,
    'logicalPath' | 'realPath' | 'linkIdentity'
  > & { directoryIdentity: IRunnerFileIdentity })[] = [];

  constructor(
    private readonly location: IGlobalResolvedLocation,
    private readonly deps: IGlobalInventoryDeps,
    private readonly options: { allowMissingBinDir?: boolean },
  ) {}
  private async bins(): Promise<IPnpm10BinDirectory & { missing: boolean }> {
    const pinnedMissing = this.location.pnpm10?.missingDirectoryPaths.some(
      (p) => key(p) === key(this.location.binDir),
    );
    if (this.options.allowMissingBinDir || pinnedMissing) {
      try {
        await this.identity(this.location.binDir);
        if (pinnedMissing) return failed();
      } catch (error) {
        this.deps.signal.throwIfAborted();
        if (!missing(error)) throw error;
        await this.guard(this.location.binDir, true);
        if (!this.absent.includes(this.location.binDir))
          this.absent.push(this.location.binDir);
        return { complete: true, slots: [], texts: new Map(), missing: true };
      }
    }
    const directory = await readPnpm10BinDirectory({
      fs: this.deps.fs,
      signal: this.deps.signal,
      binDir: this.location.binDir,
      budget: this.budget,
    });
    return { ...directory, missing: false };
  }
  private async checkpoint(): Promise<void> {
    this.deps.signal.throwIfAborted();
    if (++this.work % 128 === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      this.deps.signal.throwIfAborted();
    }
  }
  private async identity(path: string): Promise<IRunnerFileIdentity> {
    await this.checkpoint();
    const stat = await this.deps.fs.lstat(path);
    this.deps.signal.throwIfAborted();
    return runnerIdentity(path, stat);
  }
  private guard(path: string, allowMissing = false): Promise<void> {
    if (!isGlobalAbsolutePath(path) || path.split(/[\\/]+/).length > 64)
      return failed('LIMIT_EXCEEDED');
    return assertGlobalDirectory(
      path,
      this.deps.fs,
      this.deps.signal,
      allowMissing,
    );
  }
  private async directory(path: string): Promise<readonly string[]> {
    await this.guard(path);
    const names = [
      ...(await readGlobalDirectory(this.deps.fs, path, this.deps.signal)),
    ].sort();
    this.entryCount += names.length;
    if (this.entryCount > 40_000) return failed('LIMIT_EXCEEDED');
    if (new Set(names.map((n) => n.toLowerCase())).size !== names.length)
      return failed();
    // Later structural traversal must preserve the names used by an earlier
    // semantic proof, rather than replacing that proof's baseline.
    const previous = this.enumerations.get(path);
    if (previous) {
      if (!isDeepStrictEqual(previous, names)) return failed();
    } else this.enumerations.set(path, names);
    return names;
  }
  private async data(
    path: string,
    optional = false,
  ): Promise<Record<string, unknown> | null> {
    await this.checkpoint();
    const data = await readPnpm10File(
      path,
      1024 * 1024,
      this.deps.fs,
      this.deps.signal,
      this.budget,
      () => this.guard(win32.dirname(path), optional),
    );
    if (!data) {
      if (!optional) return failed();
      this.absent.push(path);
      return null;
    }
    const previous = this.files.find(
      (file) => key(file.file.path) === key(path),
    );
    if (previous) {
      if (
        !sameEntry(previous.file, data.identity.file) ||
        previous.sha256 !== data.identity.sha256
      )
        return failed();
    } else this.files.push(data.identity);
    return dataObject(data.text, win32.extname(path).toLowerCase() === '.json');
  }
  private dependencyMap(value: unknown): Record<string, string> {
    if (value === undefined) return {};
    if (!record(value)) return failed();
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
  private importer(lock: Record<string, unknown>): Record<string, unknown> {
    if (
      String(lock.lockfileVersion) !== '9.0' ||
      !record(lock.importers) ||
      Object.keys(lock.importers).length !== 1 ||
      !record(lock.importers['.'])
    )
      return failed();
    const importer = lock.importers['.'];
    for (const field of ['devDependencies', 'optionalDependencies'])
      if (
        importer[field] !== undefined &&
        (!record(importer[field]) || Object.keys(importer[field]).length)
      )
        return failed();
    if (importer.dependencies === undefined) return {};
    if (!record(importer.dependencies)) return failed();
    return importer.dependencies;
  }
  private async proveStore(
    modules: Record<string, unknown>,
    root: IRunnerFileIdentity,
  ): Promise<IRunnerFileIdentity> {
    const config = this.location.pnpm10!;
    const store = modules.storeDir;
    const virtual = modules.virtualStoreDir;
    if (
      typeof store !== 'string' ||
      !isGlobalAbsolutePath(store) ||
      typeof virtual !== 'string' ||
      key(virtual) !== key(win32.join(root.path, '.pnpm'))
    )
      return failed();
    // pnpm.cjs:49009-49049: corroborate the default candidates using device
    // facts; never reproduce pnpm's write-based hardlink probe.
    const candidates = config.storeDir
      ? [config.storeDir]
      : [
          win32.join(config.homeDir, 'store', 'v10'),
          win32.join(win32.parse(root.path).root, '.pnpm-store', 'v10'),
        ];
    if (!candidates.some((p) => key(p) === key(store))) return failed();
    assertPnpm10LocationLayout(config, store);
    await this.guard(store);
    await this.guard(virtual);
    const identity = await this.identity(store);
    if (!config.storeDir && identity.stat.dev !== root.stat.dev)
      return failed();
    return identity;
  }
  private async recheckLink(
    fact: Pick<
      IPnpm10DependencyFacts,
      'logicalPath' | 'realPath' | 'linkIdentity'
    >,
  ): Promise<void> {
    await this.guard(win32.dirname(fact.logicalPath));
    if (!sameEntry(fact.linkIdentity, await this.identity(fact.logicalPath)))
      return failed();
    const real = await this.deps.fs.realpath(fact.logicalPath);
    this.deps.signal.throwIfAborted();
    if (key(real) !== key(fact.realPath)) return failed();
  }
  private own(bin: string, owner: string): void {
    const name = bin.toLowerCase().replace(/\.(?:cmd|ps1|exe|bat|com)$/i, '');
    if (this.owners.has(name) && this.owners.get(name) !== owner)
      this.owners.set(name, null);
    else this.owners.set(name, owner);
  }
  private proveBins(
    directory: IPnpm10BinDirectory,
    fact: IPnpm10DependencyFacts,
    nodePaths: readonly string[],
  ): boolean {
    let valid = true;
    const hashes: IGlobalConfigIdentity[] = [];
    for (const bin of fact.bins) {
      const proven = provePnpm10BinSet({
        directory,
        binName: bin.name,
        target: win32.join(fact.realPath, bin.target),
        nodePath: this.location.tool.file,
        nodePaths,
      });
      if (!proven) {
        valid = false;
        this.own(bin.name, fact.name);
        this.owners.set(bin.name.toLowerCase(), null);
      } else {
        hashes.push(...proven);
        this.own(bin.name, fact.name);
        for (const file of proven) {
          const slot = directory.slots.find(
            (s) => key(s.identity.path) === key(file.file.path),
          )!;
          slot.owner = fact.name;
        }
      }
    }
    fact.shims = hashes;
    return valid;
  }
  private linkedBins(
    directory: IPnpm10BinDirectory,
    real: string,
  ): IGlobalBin[] {
    const bins: IGlobalBin[] = [];
    for (const slot of directory.slots) {
      if (!slot.name.toLowerCase().endsWith('.cmd')) continue;
      const text = directory.texts.get(slot.name.toLowerCase());
      if (!text) continue;
      // Text is only a candidate, never a read destination. The whole three-file
      // family must prove the operand inside the already-proven link source.
      for (const match of text.matchAll(/"%~dp0\\([^"\r\n]+)"/g)) {
        const target = win32.resolve(this.location.binDir, match[1]);
        if (!inside(target, real)) continue;
        const name = slot.name.slice(0, -4);
        if (
          provePnpm10BinSet({
            directory,
            binName: name,
            target,
            nodePath: this.location.tool.file,
            nodePaths: [
              win32.join(this.location.globalRoot, '.pnpm', 'node_modules'),
            ],
          }) &&
          !bins.some((bin) => bin.name.toLowerCase() === name.toLowerCase())
        )
          bins.push({ name, target: win32.relative(real, target) });
      }
    }
    return bins;
  }
  private async direct(
    name: string,
    spec: string,
    reference: unknown,
    lock: Record<string, unknown>,
    maximum: number,
    directory: IPnpm10BinDirectory,
  ): Promise<{ row: IGlobalPackage; valid: boolean }> {
    if (
      !record(reference) ||
      reference.specifier !== spec ||
      typeof reference.version !== 'string'
    )
      return failed();
    const ref = reference.version;
    const logicalPath = win32.join(
      this.location.globalRoot,
      'node_modules',
      name,
    );
    await this.guard(win32.dirname(logicalPath));
    const linkIdentity = await this.identity(logicalPath);
    if (!linkIdentity.stat.isSymbolicLink()) return failed();
    const realPath = await this.deps.fs.realpath(logicalPath);
    this.deps.signal.throwIfAborted();
    if (!isGlobalAbsolutePath(realPath)) return failed();
    const linked = spec.startsWith('link:');
    const fact: IPnpm10DependencyFacts = {
      name,
      spec,
      version: ref,
      linked,
      logicalPath,
      realPath,
      linkIdentity,
      directoryIdentity: null,
      manifest: null,
      bins: [],
      binIdentities: [],
      shims: [],
    };
    if (linked) {
      if (
        ref !== spec ||
        key(realPath) !==
          key(win32.resolve(this.location.globalRoot, spec.slice(5)))
      )
        return failed();
      // No lstat/open/guard of the external destination. Pin only junction facts.
      fact.bins = this.linkedBins(directory, realPath);
      this.proveBins(directory, fact, [
        win32.join(this.location.globalRoot, '.pnpm', 'node_modules'),
      ]);
      await this.recheckLink(fact);
      this.dependencies.push(fact);
      return {
        row: {
          name,
          version: ref,
          bins: [...fact.bins],
          status: 'linked',
          reason: 'LINKED_PACKAGE',
        },
        valid: true,
      };
    }
    const version = ref.split('(')[0];
    const unsupportedSpec =
      validRange(spec) === null && !/^[a-z][a-z0-9._-]*$/i.test(spec);
    const degrade = async (): Promise<{
      row: IGlobalPackage;
      valid: boolean;
    }> => {
      // Unsupported installs remain visible, but carry junction facts only. Never
      // open their destination (which may be outside the global project).
      await this.recheckLink(fact);
      this.dependencies.push(fact);
      return {
        row: {
          name,
          version: ref,
          bins: [],
          status: 'invalid',
          reason: 'INVENTORY_FAILED',
        },
        valid: false,
      };
    };
    if (validVersion(version) === null) {
      if (
        !ref ||
        ref.length > 8192 ||
        Array.from(ref).some(
          (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
        )
      )
        return failed();
      const entry =
        record(lock.packages) &&
        (lock.packages[`${name}@${version}`] ?? lock.packages[version]);
      if (
        !record(entry) ||
        !record(entry.resolution) ||
        !Object.keys(entry.resolution).length ||
        Object.values(entry.resolution).some(
          (v) => typeof v !== 'string' || !v,
        ) ||
        (!unsupportedSpec &&
          Object.keys(entry.resolution).every(
            (name) => name === 'integrity',
          )) ||
        !record(lock.snapshots) ||
        !record(lock.snapshots[`${name}@${ref}`] ?? lock.snapshots[ref])
      )
        return failed();
      return degrade();
    }
    if (!isGlobalExactVersion(version) || !/^[a-z0-9@._+()/-]+$/i.test(ref))
      return failed();
    const depPath = `${name}@${ref}`;
    const packageKey = `${name}@${version}`;
    if (
      !record(lock.packages) ||
      !record(lock.packages[packageKey]) ||
      !record(lock.snapshots) ||
      !record(lock.snapshots[depPath])
    )
      return failed();
    const entry = lock.packages[packageKey];
    if (
      !record(entry.resolution) ||
      !Object.keys(entry.resolution).length ||
      Object.values(entry.resolution).some((v) => typeof v !== 'string' || !v)
    )
      return failed();
    const unsupportedResolution = Object.keys(entry.resolution).some(
      (name) => name !== 'integrity',
    );
    if (!unsupportedResolution && !registryResolution(entry.resolution))
      return failed();
    const expected = win32.join(
      this.location.globalRoot,
      '.pnpm',
      pnpm10DepPathToFilename(depPath, maximum),
      'node_modules',
      name,
    );
    if (key(expected) !== key(realPath)) return failed();
    if (unsupportedSpec || unsupportedResolution) return degrade();
    await this.guard(realPath);
    fact.directoryIdentity = await this.identity(realPath);
    const manifest = await this.data(win32.join(realPath, 'package.json'));
    if (!manifest || manifest.name !== name || manifest.version !== version)
      return failed();
    fact.manifest = this.files.find(
      (file) =>
        key(file.file.path) === key(win32.join(realPath, 'package.json')),
    )!;
    fact.version = version;
    fact.bins = normalizeGlobalBins(name, manifest.bin);
    const binIdentities: IRunnerFileIdentity[] = [];
    for (const bin of fact.bins) {
      const target = win32.resolve(realPath, bin.target);
      if (!inside(target, realPath)) return failed();
      await this.guard(win32.dirname(target));
      const identity = await this.identity(target);
      if (
        !identity.stat.isFile() ||
        identity.stat.isSymbolicLink() ||
        key(await this.deps.fs.realpath(target)) !== key(target)
      )
        return failed();
      this.deps.signal.throwIfAborted();
      binIdentities.push(identity);
    }
    fact.binIdentities = binIdentities;
    let modulesDir = realPath;
    for (let index = 0; index < name.split('/').length; index++) {
      modulesDir = win32.dirname(modulesDir);
    }
    let valid = this.proveBins(directory, fact, [
      win32.join(realPath, 'node_modules'),
      modulesDir,
      win32.join(this.location.globalRoot, '.pnpm', 'node_modules'),
    ]);
    // Scoped packages' second NODE_PATH is the virtual package node_modules,
    // obtained by removing all segments of the package name.
    const row: IGlobalPackage = {
      name,
      version,
      bins: [...fact.bins],
      status: valid ? 'manageable' : 'invalid',
      reason: valid ? null : 'BIN_CONFLICT',
    };
    try {
      assertGlobalPackageMutable({
        packageName: name,
        packageRoot: realPath,
        linked: false,
        currentBins: fact.bins,
        targetBins: [],
        binOwners: [],
        ownershipComplete: true,
        protectedPaths: this.location.protectedPaths,
      });
    } catch (error) {
      this.deps.signal.throwIfAborted();
      if (
        error instanceof AppException &&
        record(error.details) &&
        error.details.reason === 'PROTECTED_PACKAGE'
      ) {
        row.status = 'protected';
        row.reason = 'PROTECTED_PACKAGE';
      } else {
        valid = false;
        row.status = 'invalid';
        row.reason = 'BIN_CONFLICT';
      }
    }
    await this.recheckLink(fact);
    this.dependencies.push(fact);
    return { row, valid };
  }
  private async provePrivateHoists(
    value: unknown,
    lock: Record<string, unknown>,
    current: Record<string, unknown> | null,
    maximum: number,
  ): Promise<void> {
    if (!record(value)) return failed();
    const entries = Object.entries(value);
    if (entries.length > 10_000) return failed('LIMIT_EXCEEDED');
    if (entries.length && !current) return failed();
    const names = new Set<string>();
    const declarations: { name: string; version: string; locator: string }[] =
      [];
    for (const [locator, aliases] of entries) {
      await this.checkpoint();
      const separator = locator.lastIndexOf('@');
      const name = locator.slice(0, separator);
      const version = locator.slice(separator + 1);
      if (
        separator <= 0 ||
        !isGlobalPackageName(name) ||
        name !== name.toLowerCase() ||
        names.has(name) ||
        !isGlobalExactVersion(version) ||
        !/^\d+\.\d+\.\d+(?:\+[a-z0-9.-]+)?$/i.test(version) ||
        !record(aliases) ||
        Object.keys(aliases).length !== 1 ||
        aliases[name] !== 'private' ||
        !record(lock.packages) ||
        !record(lock.packages[locator]) ||
        !registryResolution(lock.packages[locator].resolution) ||
        !record(lock.snapshots) ||
        !record(lock.snapshots[locator])
      )
        return failed();
      names.add(name);
      declarations.push({ name, version, locator });
    }
    const directory = win32.join(
      this.location.globalRoot,
      '.pnpm',
      'node_modules',
    );
    try {
      await this.identity(directory);
    } catch (error) {
      this.deps.signal.throwIfAborted();
      if (!missing(error)) throw error;
      if (entries.length) return failed();
      await this.guard(directory, true);
      this.absent.push(directory);
      return;
    }
    const actual = new Set<string>();
    for (const name of await this.directory(directory)) {
      // No observed/generated private .bin proof yet. Refuse rather than grant
      // private shims any global ownership or silently accept unknown content.
      if (name.startsWith('@')) {
        const children = await this.directory(win32.join(directory, name));
        if (!children.length) return failed();
        for (const child of children) actual.add(`${name}/${child}`);
      } else actual.add(name);
    }
    if (!isDeepStrictEqual([...actual].sort(), [...names].sort()))
      return failed();
    for (const { name, version, locator } of declarations) {
      const logicalPath = win32.join(directory, name);
      await this.guard(win32.dirname(logicalPath));
      const linkIdentity = await this.identity(logicalPath);
      if (!linkIdentity.stat.isSymbolicLink()) return failed();
      const realPath = await this.deps.fs.realpath(logicalPath);
      this.deps.signal.throwIfAborted();
      const expected = win32.join(
        this.location.globalRoot,
        '.pnpm',
        pnpm10DepPathToFilename(locator, maximum),
        'node_modules',
        name,
      );
      // Compare before guarding/opening the target: foreign destinations must
      // never become read paths, even when the entry itself is a valid junction.
      if (!isGlobalAbsolutePath(realPath) || key(realPath) !== key(expected))
        return failed();
      await this.guard(expected);
      const directoryIdentity = await this.identity(expected);
      const manifest = await this.data(win32.join(expected, 'package.json'));
      if (!manifest || manifest.name !== name || manifest.version !== version)
        return failed();
      const fact = {
        logicalPath,
        realPath: expected,
        linkIdentity,
        directoryIdentity,
      };
      await this.recheckLink(fact);
      this.privateHoists.push(fact);
      // Existing structural traversal pins both link and directory identities;
      // data() contributes the previously unpinned manifest identity and hash.
    }
  }
  // Structural facts only. In R\.pnpm: <id> (depth 0), <id>\node_modules
  // (depth 1), <name> or @scope (depth 2), @scope\<name> (depth 3). Package
  // directories are pinned by identity but never enumerated: real globals hold
  // tens of thousands of package files there. R\node_modules\.bin is flat.
  private async scanAncillary(
    path: string,
    virtualStore: boolean,
    depth = 0,
  ): Promise<void> {
    if (depth > 3) return failed('LIMIT_EXCEEDED');
    for (const name of await this.directory(path)) {
      const child = win32.join(path, name);
      const identity = await this.identity(child);
      let realPath = child;
      if (identity.stat.isSymbolicLink()) {
        realPath = await this.deps.fs.realpath(child);
        this.deps.signal.throwIfAborted();
        if (!inside(realPath, this.location.globalRoot)) return failed();
        if (!sameEntry(identity, await this.identity(child))) return failed();
        // Never recurse through a junction, including transitive dependencies.
      } else if (identity.stat.isDirectory?.()) {
        await this.guard(child);
        if (
          virtualStore &&
          (depth < 2 || (depth === 2 && name.startsWith('@')))
        )
          await this.scanAncillary(child, virtualStore, depth + 1);
      } else if (!identity.stat.isFile()) return failed();
      let sha256: string | null = null;
      if (
        inside(
          child,
          win32.join(this.location.globalRoot, 'node_modules', '.bin'),
        ) &&
        identity.stat.isFile()
      ) {
        const data = await readPnpm10File(
          child,
          64 * 1024,
          this.deps.fs,
          this.deps.signal,
          this.budget,
          () => this.guard(win32.dirname(child)),
        );
        if (!data) return failed();
        sha256 = data.identity.sha256;
      }
      this.ancillary.push({ identity, realPath, sha256 });
    }
  }
  private async checkDirectNames(names: readonly string[]): Promise<void> {
    const expected = new Set(names.map((n) => n.toLowerCase()));
    const nodeModules = win32.join(this.location.globalRoot, 'node_modules');
    for (const name of await this.directory(nodeModules)) {
      if (
        [
          '.modules.yaml',
          '.pnpm-workspace-state-v1.json',
          '.pnpm',
          '.bin',
        ].includes(name)
      )
        continue;
      if (name.startsWith('@')) {
        for (const child of await this.directory(win32.join(nodeModules, name)))
          if (!expected.has(`${name}/${child}`.toLowerCase())) return failed();
      } else if (!expected.has(name.toLowerCase())) return failed();
    }
  }
  private async recheck(): Promise<void> {
    for (const fact of this.dependencies) await this.recheckLink(fact);
    for (const file of this.files) {
      if (
        !sameEntry(file.file, await this.identity(file.file.path)) ||
        key(await this.deps.fs.realpath(file.file.path)) !== key(file.file.path)
      )
        return failed();
      this.deps.signal.throwIfAborted();
    }
    for (const path of this.absent) {
      try {
        await this.identity(path);
      } catch (error) {
        this.deps.signal.throwIfAborted();
        if (missing(error)) continue;
        throw error;
      }
      return failed();
    }
    for (const [path, names] of this.enumerations) {
      await this.checkpoint();
      await this.guard(path);
      const now = [
        ...(await readGlobalDirectory(this.deps.fs, path, this.deps.signal)),
      ].sort();
      if (!isDeepStrictEqual(now, names)) return failed();
    }
    for (const fact of this.privateHoists) {
      await this.recheckLink(fact);
      await this.guard(fact.realPath);
      if (
        !sameEntry(fact.directoryIdentity, await this.identity(fact.realPath))
      )
        return failed();
    }
  }
  async read(): Promise<IGlobalInventoryResult> {
    const config = this.location.pnpm10;
    if (
      this.location.manager !== 'pnpm' ||
      !config ||
      key(config.globalRoot) !== key(this.location.globalRoot) ||
      key(config.binDir) !== key(this.location.binDir)
    )
      return failed();
    const directory = await this.bins();
    this.entryCount += directory.slots.length;
    const result: IGlobalInventoryResult = {
      packages: [],
      facts: [],
      binOwners: [],
      ownershipComplete: directory.complete,
    };
    let root: IRunnerFileIdentity | null = null;
    try {
      root = await this.identity(this.location.globalRoot);
    } catch (error) {
      this.deps.signal.throwIfAborted();
      if (!missing(error)) throw error;
    }
    let store: IRunnerFileIdentity | null = null;
    if (!root) {
      if (directory.missing) return failed('PNPM_GLOBAL_NOT_CONFIGURED');
      await this.guard(this.location.globalRoot, true);
      this.absent.push(this.location.globalRoot);
    } else {
      await this.guard(this.location.globalRoot);
      const manifest = (await this.data(
        win32.join(root.path, 'package.json'),
      ))!;
      const dependencies = this.dependencyMap(manifest.dependencies);
      for (const field of ['devDependencies', 'optionalDependencies'])
        if (Object.keys(this.dependencyMap(manifest[field])).length)
          return failed();
      const wanted = (await this.data(
        win32.join(root.path, 'pnpm-lock.yaml'),
      ))!;
      const importer = this.importer(wanted);
      const names = Object.keys(dependencies).sort((a, b) =>
        a.localeCompare(b),
      );
      if (!isDeepStrictEqual(Object.keys(importer).sort(), [...names].sort()))
        return failed();
      const modules = (await this.data(
        win32.join(root.path, 'node_modules', '.modules.yaml'),
      ))!;
      if (
        modules.layoutVersion !== 5 ||
        modules.nodeLinker !== 'isolated' ||
        typeof modules.packageManager !== 'string' ||
        !/^pnpm@10\.\d+\.\d+$/.test(modules.packageManager) ||
        !Number.isSafeInteger(modules.virtualStoreDirMaxLength)
      )
        return failed();
      store = await this.proveStore(modules, root);
      const workspace = (await this.data(
        win32.join(root.path, 'node_modules', '.pnpm-workspace-state-v1.json'),
      ))!;
      if (
        !Array.isArray(workspace.pnpmfiles) ||
        workspace.pnpmfiles.length ||
        !record(workspace.projects) ||
        Object.keys(workspace.projects).length ||
        !record(workspace.settings) ||
        workspace.settings.nodeLinker !== 'isolated' ||
        workspace.filteredInstall !== false
      )
        return failed();
      const current = await this.data(
        win32.join(root.path, 'node_modules', '.pnpm', 'lock.yaml'),
        !names.length,
      );
      if (
        current &&
        (!isDeepStrictEqual(this.importer(current), importer) ||
          !isDeepStrictEqual(current, wanted))
      )
        return failed();
      await this.provePrivateHoists(
        modules.hoistedDependencies,
        wanted,
        current,
        modules.virtualStoreDirMaxLength as number,
      );
      await this.checkDirectNames(names);
      if (
        directory.missing &&
        names.some((name) => dependencies[name].startsWith('link:'))
      )
        return failed('PNPM_GLOBAL_NOT_CONFIGURED');
      for (const name of names) {
        const { row, valid } = await this.direct(
          name,
          dependencies[name],
          importer[name],
          wanted,
          modules.virtualStoreDirMaxLength as number,
          directory,
        );
        result.packages.push(row);
        result.ownershipComplete &&= valid;
        const fact = this.dependencies.at(-1)!;
        if (fact.manifest && fact.directoryIdentity)
          result.facts.push({
            name,
            version: fact.version,
            packageRoot: fact.realPath,
            manifest: fact.manifest,
            bins: [...fact.bins],
            binIdentities: [...fact.binIdentities],
          });
      }
      if (
        directory.missing &&
        (!result.ownershipComplete ||
          result.packages.some((row) => row.status !== 'manageable') ||
          this.dependencies.some(
            (dep) =>
              dep.linked ||
              !dep.manifest ||
              !dep.directoryIdentity ||
              dep.bins.length > 0,
          ))
      )
        return failed('PNPM_GLOBAL_NOT_CONFIGURED');
      // Ancillary trees are structural facts, never an alternate source of rows.
      for (const path of [
        win32.join(root.path, '.pnpm'),
        win32.join(root.path, 'node_modules', '.bin'),
      ]) {
        try {
          const identity = await this.identity(path);
          if (!identity.stat.isDirectory?.() || identity.stat.isSymbolicLink())
            return failed();
          this.ancillary.push({ identity, realPath: path, sha256: null });
          await this.scanAncillary(
            path,
            key(path) === key(win32.join(root.path, '.pnpm')),
          );
        } catch (error) {
          this.deps.signal.throwIfAborted();
          if (!missing(error)) throw error;
          this.absent.push(path);
        }
      }
    }
    for (const slot of directory.slots) {
      if (slot.owner) continue;
      const binName = slot.name
        .toLowerCase()
        .replace(/\.(?:cmd|ps1|exe|bat|com)$/i, '');
      // Arbitrary reserved entries remain in binSlots. Only valid executable
      // names belong in the shared protection contract's binOwners list.
      try {
        normalizeGlobalBins('test-package', { [binName]: 'bin.js' });
      } catch {
        continue;
      }
      if (!this.owners.has(binName)) this.owners.set(binName, null);
    }
    result.binOwners = [...this.owners]
      .map(([name, owner]) => ({ name, owner }))
      .sort((a, b) => a.name.localeCompare(b.name));
    await this.recheck();
    // B can change while the project is read. Compare enumeration and bytes too.
    const afterBins = await this.bins();
    if (afterBins.missing !== directory.missing) return failed();
    if (
      !afterBins.complete ||
      afterBins.slots.length !== directory.slots.length ||
      afterBins.slots.some(
        (s, i) =>
          !sameEntry(s.identity, directory.slots[i].identity) ||
          s.sha256 !== directory.slots[i].sha256,
      )
    )
      result.ownershipComplete = false;
    result.pnpm10Inventory = {
      project: {
        root,
        files: this.files,
        missingPaths: this.absent,
        storeDir: store?.path ?? null,
        storeIdentity: store,
        dependencies: this.dependencies,
        ancillary: this.ancillary,
      },
      binSlots: directory.slots,
      ownershipComplete: result.ownershipComplete,
    };
    return result;
  }
}

export async function readPnpm10GlobalInventory(
  location: IGlobalResolvedLocation,
  deps: IGlobalInventoryDeps,
  options: { allowMissingBinDir?: boolean } = {},
): Promise<IGlobalInventoryResult> {
  deps.signal.throwIfAborted();
  try {
    return await new Pnpm10InventoryReader(location, deps, options).read();
  } catch (error) {
    deps.signal.throwIfAborted();
    if (
      error instanceof AppException &&
      record(error.details) &&
      (error.details.reason === 'LIMIT_EXCEEDED' ||
        error.details.reason === 'PNPM_GLOBAL_NOT_CONFIGURED')
    )
      throw error;
    return failed();
  }
}
