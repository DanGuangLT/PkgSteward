import { win32 } from 'node:path';
import { createHash } from 'node:crypto';
import { isAlias, isMap, isScalar, isSeq, parseDocument } from 'yaml';
import * as semver from 'semver';
import { AppException } from '@/common/exceptions/app.exception';
import type {
  IGlobalInventoryDeps,
  IGlobalInventoryResult,
} from '@/global-packages/discovery/global-inventory';
import type {
  IGlobalConfigIdentity,
  IGlobalPackageFacts,
  IGlobalResolvedLocation,
} from '@/global-packages/interfaces/global-packages.runtime';
import type {
  IGlobalPackage,
  GlobalReasonCode,
} from '@/global-packages/interfaces/global-packages.types';
import type {
  IPnpmGlobalGroupFacts,
  IPnpmGlobalLinkFacts,
} from '@/global-packages/interfaces/pnpm-global.types';
import type { IRunnerFileIdentity } from '@/npm-runner/interfaces/npm-runner.types';
import {
  readRunnerFile,
  runnerIdentity,
} from '@/npm-runner/toolchain/runner-tool';
import {
  assertGlobalDirectory,
  readGlobalDirectory,
} from '@/global-packages/discovery/global-location';
import {
  isGlobalAbsolutePath,
  isGlobalExactVersion,
} from '@/global-packages/execution/global-command';
import {
  assertGlobalPackageMutable,
  isGlobalPackageName,
  normalizeGlobalBins,
} from '@/global-packages/policy/global-policy';

const failed = (): AppException =>
  new AppException(409, 'Global inventory is incomplete', 'CONFLICT', {
    reason: 'INVENTORY_FAILED',
  });
const key = (path: string): string => win32.resolve(path).toLowerCase();
const inside = (path: string, parent: string): boolean =>
  key(path).startsWith(`${key(parent)}\\`);
const binKey = (name: string): string =>
  name.toLowerCase().replace(/\.(?:cmd|ps1|exe|bat|com)$/, '');
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const missing = (error: unknown): boolean =>
  record(error) && error.code === 'ENOENT';
// pnpm 11.22.0 globalPackageDir.js:191868 leaves PID/time hex unpadded.
const installName = /^[a-f0-9]+-[a-f0-9]+-[a-f0-9]{16}$/i;
const indexName = /^[a-f0-9]{64}$/i;
const sameEntry = (a: IRunnerFileIdentity, b: IRunnerFileIdentity): boolean =>
  key(a.path) === key(b.path) &&
  (['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'] as const).every(
    (field) => a.stat[field] === b.stat[field],
  ) &&
  a.stat.isFile() === b.stat.isFile() &&
  a.stat.isDirectory?.() === b.stat.isDirectory?.() &&
  a.stat.isSymbolicLink() === b.stat.isSymbolicLink();

function parseJson(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (!record(value)) throw failed();
  const objects: (Set<string> | null)[] = [];
  // Tokenize only syntactically valid JSON. JSON.parse alone loses duplicates.
  for (const match of text.matchAll(/"(?:[^"\\]|\\[\s\S])*"|[{}[\]]/g)) {
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
      const name: unknown = JSON.parse(token);
      const names = objects.at(-1);
      if (
        typeof name !== 'string' ||
        !names ||
        names.has(name) ||
        ['__proto__', 'constructor', 'prototype', '<<'].includes(name)
      )
        throw failed();
      names.add(name);
    }
  }
  return value;
}

// Preserve duplicate-key evidence; reject aliases, tags and excessive nesting.
function parseData(
  text: string,
  format: 'json' | 'yaml',
): Record<string, unknown> {
  if (format === 'json') return parseJson(text);
  const doc = parseDocument(text, { uniqueKeys: true, merge: false });
  if (doc.errors.length || doc.warnings.length) throw failed();
  const inspect = (node: unknown, depth: number): void => {
    if (depth > 64 || isAlias(node)) throw failed();
    if (isMap(node) || isSeq(node) || isScalar(node)) {
      if (node.tag || node.anchor) throw failed();
      if (isMap(node))
        for (const pair of node.items) {
          if (
            !isScalar(pair.key) ||
            typeof pair.key.value !== 'string' ||
            ['__proto__', 'constructor', 'prototype', '<<'].includes(
              pair.key.value,
            )
          )
            throw failed();
          inspect(pair.key, depth + 1);
          inspect(pair.value, depth + 1);
        }
      else if (isSeq(node))
        for (const item of node.items) inspect(item, depth + 1);
    }
  };
  inspect(doc.contents, 0);
  const value: unknown = doc.toJS({ maxAliasCount: 0 });
  if (!record(value)) throw failed();
  return value;
}

interface IData {
  value: Record<string, unknown>;
  identity: IGlobalConfigIdentity;
}
interface IGroup {
  facts: IPnpmGlobalGroupFacts;
  references: Record<string, string>;
  packageMap: Record<string, unknown>;
  storeProven: boolean;
}

// @zkochan/cmd-shim in pnpm 11.22.0: generateCmdShim:44287,
// generateShShim:44335, generatePwshShim:44463. Match argument positions and
// generated control flow, never an expected path appearing among foreign args.
const shPrologue = [
  'link="$0"',
  'hops=0',
  'while [ -L "$link" ] && [ "$hops" -lt 40 ]; do',
  'hops=$((hops+1))',
  'target=$(readlink "$link")',
  'case "$target" in',
  '/*) link="$target" ;;',
  '*)  link="$(dirname "$link")/$target" ;;',
  'esac',
  'done',
  'basedir=$(dirname "$(echo "$link" | sed -e \'s,\\\\,/,g\')")',
  'basedir_win="$basedir"',
  'exe=""',
  'msys=""',
  'case `uname -a` in',
  '*CYGWIN*|*MINGW*|*MSYS*)',
  'if command -v cygpath > /dev/null 2>&1; then',
  'basedir_win=`cygpath -w "$basedir"`',
  'fi',
  'exe=".exe"',
  'msys="true"',
  ';;',
  '*WSL2*)',
  'if command -v wslpath > /dev/null 2>&1; then',
  'basedir_win="$(wslpath -w "$basedir" 2> /dev/null)"',
  'if [ $? -ne 0 ] || [ -z "$basedir_win" ]; then',
  'basedir_win="$basedir"',
  'else',
  'exe=".exe"',
  'fi',
  'fi',
  ';;',
  'esac',
];

function shimControl(
  line: string,
  extension: string,
): 'if' | 'elif' | 'else' | 'end' | null {
  if (extension === '.cmd') {
    if (
      /^@?IF (?:NOT DEFINED NODE_PATH|EXIST "%~dp0\\node\.exe") \($/i.test(line)
    )
      return 'if';
    if (/^\) ELSE \($/i.test(line)) return 'else';
    if (line === ')') return 'end';
  } else if (extension === '.ps1') {
    if (
      /^if \((?:\$MyInvocation\.ExpectingInput|Test-Path "\$basedir\/node\$exe"|\$PSVersionTable\.PSVersion -lt "6\.0" -or \$IsWindows|\[string\]::IsNullOrEmpty\(\$env_node_path\))\) \{$/i.test(
        line,
      )
    )
      return 'if';
    if (/^\} else \{$/i.test(line)) return 'else';
    if (line === '}') return 'end';
  } else {
    if (/^if \[ -z "\$NODE_PATH" \]; then$/.test(line)) return 'if';
    if (
      /^(?:if|elif) (?:\[ -n "\$exe" \] && \[ -x "\$basedir\/node\.exe" \]|\[ -x "\$basedir\/node(?:\.exe)?" \]|command -v node >\/dev\/null 2>&1|\[ -n "\$exe" \] && command -v node\.exe >\/dev\/null 2>&1); then$/.test(
        line,
      )
    )
      return line.startsWith('elif') ? 'elif' : 'if';
    if (line === 'else') return 'else';
    if (line === 'fi') return 'end';
  }
  return null;
}

function shimStatement(line: string, extension: string): boolean {
  // Only literal generated environment setup/restoration is allowed. Unknown
  // commands, substitutions, inline operators and injected invocations refuse.
  const literal = '[^"%$`&|<>^!\\r\\n]*';
  if (extension === '.cmd')
    return (
      /^(?:@?SETLOCAL|@?ECHO off|@SET PATHEXT=%PATHEXT:;\.JS;=;%)$/i.test(
        line,
      ) ||
      new RegExp(
        `^@SET "(?:PATH=${literal}:%PATH%|NODE_PATH=${literal}(?:;%NODE_PATH%)?)"$`,
        'i',
      ).test(line)
    );
  if (extension === '.ps1')
    return (
      [
        '$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent',
        '$exe=""',
        '$exe=".exe"',
        '$pathsep=":"',
        '$pathsep=";"',
        '$env_node_path=$env:NODE_PATH',
        '$env_path=$env:PATH',
        '$env:NODE_PATH=$new_node_path',
        '$env:NODE_PATH="$new_node_path$pathsep$env_node_path"',
        '$env:PATH="$prepend_path$pathsep$env:PATH"',
        '$env:NODE_PATH=$env_node_path',
        '$env:PATH=$env_path',
        '$ret=0',
        '$ret=$LASTEXITCODE',
        'exit $ret',
        'exit $LASTEXITCODE',
      ].includes(line) ||
      new RegExp(`^\\$(?:new_node_path|prepend_path)="${literal}"$`).test(line)
    );
  return (
    line === 'exit $?' ||
    new RegExp(
      `^export (?:NODE_PATH="${literal}(?::\\$NODE_PATH)?"|PATH="${literal}:\\$PATH")$`,
    ).test(line)
  );
}

function ownedShim(
  text: string,
  file: string,
  nodeFile: string,
  accepted: ReadonlySet<string>,
): boolean {
  const extension = win32.extname(file).toLowerCase();
  if (!['', '.cmd', '.ps1'].includes(extension)) return false;
  let lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !(extension !== '.cmd' && line.startsWith('#')));
  if (extension === '' && lines[0] === shPrologue[0]) {
    if (!shPrologue.every((line, i) => line === lines[i])) return false;
    lines = lines.slice(shPrologue.length);
  }
  const target = (token: string): boolean => {
    if (!/^"[^"\r\n]+"$/.test(token)) return false;
    const value = token
      .slice(1, -1)
      .replace(
        /^(?:%~dp0|%dp0%|\$\{basedir\}|\$basedir_win|\$basedir)/i,
        win32.dirname(file),
      );
    // Generated shims use basedir/../ paths; normalize those only after the
    // known prefix expansion, while rejecting remaining shell interpolation.
    return (
      !/[$%`!^&]/.test(value) &&
      /^[a-z]:[\\/]/i.test(value) &&
      !Array.from(value).some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      ) &&
      isGlobalAbsolutePath(win32.resolve(value)) &&
      accepted.has(key(value))
    );
  };
  const node = (token: string): boolean => {
    if (/^"?node(?:\.exe)?"?$/i.test(token)) return true;
    if (
      (extension === '.cmd' && /^"%~dp0\\node\.exe"$/i.test(token)) ||
      (extension === '.ps1' && /^"(?:\$basedir\/)?node\$exe"$/.test(token)) ||
      (extension === '' && /^"\$basedir\/node(?:\.exe)?"$/.test(token))
    )
      return true;
    return (
      /^"[^"\r\n]+"$/.test(token) &&
      !/[$%`]/.test(token) &&
      key(token.slice(1, -1)) === key(nodeFile)
    );
  };
  const invocation = (line: string): boolean => {
    const prefix =
      extension === '.cmd'
        ? /^@?/
        : extension === '.ps1'
          ? /^(?:\$input\s+\|\s+)?&\s+/
          : /^exec\s+/;
    if (!prefix.test(line)) return false;
    const command = line.replace(prefix, '');
    const matches = [...command.matchAll(/"[^"\r\n]*"|[^\s"]+/g)];
    if (
      matches.some(
        (match, i) =>
          i > 0 &&
          !/^\s+$/.test(
            command.slice(
              matches[i - 1].index + matches[i - 1][0].length,
              match.index,
            ),
          ),
      )
    )
      return false;
    const tokens = matches.map((match) => match[0]);
    if (command.replace(/"[^"\r\n]*"|[^\s"]+/g, '').trim()) return false;
    if (
      tokens.pop() !==
      (extension === '.cmd' ? '%*' : extension === '.ps1' ? '$args' : '"$@"')
    )
      return false;
    if (tokens.length === 1) return target(tokens[0]);
    const executable = tokens.shift();
    if (!executable || !node(executable)) return false;
    if (tokens[0] === '--preserve-symlinks') tokens.shift();
    return tokens.length === 1 && target(tokens[0]);
  };
  let counts = new Set([0]);
  const frames: {
    incoming: Set<number>;
    branches: Set<number>;
    hasElse: boolean;
  }[] = [];
  for (const line of lines) {
    if (
      /^exit\s/i.test(line) &&
      (line !== lines.at(-1) ||
        frames.length ||
        counts.size !== 1 ||
        !counts.has(1))
    )
      return false;
    const control = shimControl(line, extension);
    if (control === 'if') {
      if (frames.length >= 64) return false;
      frames.push({
        incoming: new Set(counts),
        branches: new Set(),
        hasElse: false,
      });
    } else if (control === 'else' || control === 'elif') {
      const frame = frames.at(-1);
      if (!frame || frame.hasElse) return false;
      for (const count of counts) frame.branches.add(count);
      counts = new Set(frame.incoming);
      frame.hasElse = control === 'else';
    } else if (control === 'end') {
      const frame = frames.pop();
      if (!frame) return false;
      counts = new Set([
        ...frame.branches,
        ...counts,
        ...(!frame.hasElse ? frame.incoming : []),
      ]);
    } else if (!shimStatement(line, extension)) {
      if (!invocation(line)) return false;
      counts = new Set([...counts].map((count) => count + 1));
      if (counts.has(2)) return false;
    }
  }
  return frames.length === 0 && counts.size === 1 && counts.has(1);
}

class PnpmInventoryReader {
  private readonly result: IGlobalInventoryResult = {
    packages: [],
    facts: [],
    binOwners: [],
    ownershipComplete: true,
  };
  private readonly budget = { remaining: 32 * 1024 * 1024 };
  private entries = 0;
  private rows = 0;
  private work = 0;
  private readonly owners = new Map<string, string | null>();
  private readonly groups: IPnpmGlobalGroupFacts[] = [];
  private readonly orphans: IRunnerFileIdentity[] = [];
  private readonly groupByPackage = new Map<
    IGlobalPackageFacts,
    IPnpmGlobalGroupFacts
  >();
  private readonly shimHashes: IGlobalConfigIdentity[] = [];
  private readonly factsByBin = new Map<string, IGlobalPackageFacts[]>();

  constructor(
    private readonly location: IGlobalResolvedLocation,
    private readonly deps: IGlobalInventoryDeps,
  ) {}

  private async checkpoint(): Promise<void> {
    this.deps.signal.throwIfAborted();
    if (++this.work % 128 === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      this.deps.signal.throwIfAborted();
    }
  }

  private async directory(path: string): Promise<readonly string[]> {
    const names = await readGlobalDirectory(
      this.deps.fs,
      path,
      this.deps.signal,
    );
    this.deps.signal.throwIfAborted();
    this.entries += names.length;
    if (
      this.entries > 40_000 ||
      new Set(names.map((name) => name.toLowerCase())).size !== names.length
    )
      throw failed();
    return [...names].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    );
  }

  private async identity(path: string): Promise<IRunnerFileIdentity> {
    await this.checkpoint();
    const stat = await this.deps.fs.lstat(path);
    this.deps.signal.throwIfAborted();
    return runnerIdentity(path, stat);
  }

  private guard(path: string, allowMissing = false): Promise<void> {
    if (!isGlobalAbsolutePath(path) || path.split(/[\\/]+/).length > 64)
      throw failed();
    return assertGlobalDirectory(
      path,
      this.deps.fs,
      this.deps.signal,
      allowMissing,
    );
  }

  private async data(path: string): Promise<IData> {
    await this.guard(win32.dirname(path));
    const data = await readRunnerFile(
      path,
      1024 * 1024,
      this.deps.fs,
      this.deps.signal,
      'win32',
      {
        budget: this.budget,
        checkParent: () => this.guard(win32.dirname(path)),
      },
    );
    if (!data) throw failed();
    return {
      value: parseData(
        data.text,
        win32.extname(path).toLowerCase() === '.json' ? 'json' : 'yaml',
      ),
      identity: {
        file: data.identity,
        sha256: createHash('sha256').update(data.bytes).digest('hex'),
      },
    };
  }

  private async proveIndex(path: string): Promise<IPnpmGlobalLinkFacts> {
    const identity = await this.identity(path);
    if (!identity.stat.isSymbolicLink()) throw failed();
    const realPath = await this.deps.fs.realpath(path);
    this.deps.signal.throwIfAborted();
    if (
      !isGlobalAbsolutePath(realPath) ||
      key(win32.dirname(realPath)) !== key(this.location.globalRoot) ||
      !installName.test(win32.basename(realPath))
    )
      throw failed();
    await this.guard(realPath);
    const link = { logicalPath: path, realPath, identity };
    await this.recheckLink(link);
    return link;
  }

  private async recheckLink(link: IPnpmGlobalLinkFacts): Promise<void> {
    await this.guard(win32.dirname(link.logicalPath));
    if (!sameEntry(link.identity, await this.identity(link.logicalPath)))
      throw failed();
    const real = await this.deps.fs.realpath(link.logicalPath);
    this.deps.signal.throwIfAborted();
    if (key(real) !== key(link.realPath)) throw failed();
  }

  private async proveStore(
    store: unknown,
    virtual: unknown,
    install: IRunnerFileIdentity,
  ): Promise<boolean> {
    const config = this.location.pnpm!;
    if (
      typeof store !== 'string' ||
      !isGlobalAbsolutePath(store) ||
      typeof virtual !== 'string' ||
      !isGlobalAbsolutePath(virtual) ||
      key(virtual) !== key(win32.join(store, 'links'))
    )
      return false;
    const configured = config.storeDir;
    if (configured && key(store) !== key(configured)) return false;
    if (!configured) {
      // Corroborate metadata against guarded same-device candidates. Never
      // reproduce pnpm's write-based hardlink probes or search the store.
      const candidates = [
        win32.join(config.homeDir, 'store', 'v11'),
        win32.join(win32.parse(install.path).root, '.pnpm-store', 'v11'),
      ];
      if (!candidates.some((candidate) => key(candidate) === key(store)))
        return false;
    }
    await this.guard(store);
    await this.guard(virtual);
    const identity = await this.identity(store);
    return !!configured || identity.stat.dev === install.stat.dev;
  }

  private dependencies(value: unknown): Record<string, string> {
    if (!record(value)) throw failed();
    const result: Record<string, string> = {};
    const entries = Object.entries(value);
    this.rows += entries.length;
    if (!entries.length || this.rows > 10_000) throw failed();
    for (const [name, spec] of entries) {
      if (
        !isGlobalPackageName(name) ||
        typeof spec !== 'string' ||
        !spec ||
        spec.length > 256 ||
        semver.validRange(spec) === null
      )
        throw failed();
      result[name] = spec;
    }
    return result;
  }

  private lockReferences(
    lock: Record<string, unknown>,
    dependencies: Record<string, string>,
  ): Record<string, string> {
    if (
      !['9', '9.0'].includes(String(lock.lockfileVersion)) ||
      !record(lock.importers) ||
      Object.keys(lock.importers).length !== 1 ||
      !record(lock.importers['.'])
    )
      throw failed();
    const importer = lock.importers['.'];
    if (
      !record(importer.dependencies) ||
      Object.keys(importer.dependencies).length !==
        Object.keys(dependencies).length ||
      (record(importer.devDependencies) &&
        Object.keys(importer.devDependencies).length) ||
      (record(importer.optionalDependencies) &&
        Object.keys(importer.optionalDependencies).length)
    )
      throw failed();
    const references: Record<string, string> = {};
    for (const [name, spec] of Object.entries(dependencies)) {
      const entry = importer.dependencies[name];
      if (
        !record(entry) ||
        entry.specifier !== spec ||
        typeof entry.version !== 'string'
      )
        throw failed();
      const version = entry.version.split('(')[0];
      if (
        !isGlobalExactVersion(version) ||
        !semver.satisfies(version, spec, { includePrerelease: true }) ||
        !record(lock.packages) ||
        !record(lock.packages[`${name}@${version}`]) ||
        !record(lock.snapshots) ||
        !record(lock.snapshots[`${name}@${entry.version}`])
      )
        throw failed();
      references[name] = entry.version;
    }
    return references;
  }

  private async group(index: IPnpmGlobalLinkFacts): Promise<IGroup> {
    const installDir = index.realPath;
    const directory = await this.identity(installDir);
    const manifest = await this.data(win32.join(installDir, 'package.json'));
    const dependencies = this.dependencies(manifest.value.dependencies);
    for (const field of ['devDependencies', 'optionalDependencies']) {
      const value = manifest.value[field];
      if (value !== undefined && (!record(value) || Object.keys(value).length))
        throw failed();
    }
    const lock = await this.data(win32.join(installDir, 'pnpm-lock.yaml'));
    const modulesDir = win32.join(installDir, 'node_modules');
    const modules = await this.data(win32.join(modulesDir, '.modules.yaml'));
    const packageMap = await this.data(
      win32.join(modulesDir, '.package-map.json'),
    );
    const virtualLock = await this.data(
      win32.join(modulesDir, '.pnpm', 'lock.yaml'),
    );
    const references = this.lockReferences(lock.value, dependencies);
    const other = this.lockReferences(virtualLock.value, dependencies);
    if (
      Object.keys(references).some((name) => references[name] !== other[name])
    )
      throw failed();
    let storeProven = false;
    try {
      storeProven = await this.proveStore(
        modules.value.storeDir,
        modules.value.virtualStoreDir,
        directory,
      );
    } catch {
      this.deps.signal.throwIfAborted();
    }
    const metadataVersion =
      typeof modules.value.packageManager === 'string' &&
      modules.value.packageManager.startsWith('pnpm@')
        ? modules.value.packageManager.slice('pnpm@'.length)
        : null;
    if (
      modules.value.layoutVersion !== 5 ||
      !isGlobalExactVersion(metadataVersion) ||
      semver.major(metadataVersion) !== 11 ||
      modules.value.nodeLinker !== 'isolated'
    )
      storeProven = false;
    if (
      !record(packageMap.value.packages) ||
      !record(packageMap.value.packages['.']) ||
      !record(packageMap.value.packages['.'].dependencies)
    )
      throw failed();
    const mapDependencies = packageMap.value.packages['.'].dependencies;
    const rootUrl = packageMap.value.packages['.'].url;
    if (
      typeof rootUrl !== 'string' ||
      /[%?#]/.test(rootUrl) ||
      /^[a-z]+:/i.test(rootUrl) ||
      key(win32.resolve(modulesDir, rootUrl)) !== key(installDir)
    )
      throw failed();
    if (
      Object.keys(mapDependencies).length !== Object.keys(references).length ||
      Object.keys(references).some(
        (name) => mapDependencies[name] !== `${name}@${references[name]}`,
      )
    )
      throw failed();
    const facts: IPnpmGlobalGroupFacts = {
      index,
      installDir,
      directory,
      manifest: manifest.identity,
      lockfile: lock.identity,
      modules: modules.identity,
      packageMap: packageMap.identity,
      virtualStoreLockfile: virtualLock.identity,
      directDependencies: Object.keys(dependencies).sort(),
      packageLinks: [],
      storeDir:
        typeof modules.value.storeDir === 'string'
          ? modules.value.storeDir
          : '',
      virtualStoreDir:
        typeof modules.value.virtualStoreDir === 'string'
          ? modules.value.virtualStoreDir
          : '',
    };
    return {
      facts,
      references,
      packageMap: packageMap.value.packages,
      storeProven,
    };
  }

  private async packageLink(
    group: IGroup,
    name: string,
    version: string,
  ): Promise<IPnpmGlobalLinkFacts | null> {
    const logicalPath = win32.join(
      group.facts.installDir,
      'node_modules',
      ...name.split('/'),
    );
    try {
      await this.guard(win32.dirname(logicalPath));
      const identity = await this.identity(logicalPath);
      if (!identity.stat.isSymbolicLink()) return null;
      const realPath = await this.deps.fs.realpath(logicalPath);
      this.deps.signal.throwIfAborted();
      if (!group.storeProven || !isGlobalAbsolutePath(realPath)) return null;
      const prefix = win32.join(
        group.facts.virtualStoreDir,
        '@',
        ...name.split('/'),
        version,
      );
      const relative = win32.relative(prefix, realPath).split(win32.sep);
      const suffix = ['node_modules', ...name.split('/')];
      if (
        !inside(realPath, prefix) ||
        relative.length !== suffix.length + 1 ||
        !indexName.test(relative[0]) ||
        suffix.some(
          (part, i) => part.toLowerCase() !== relative[i + 1].toLowerCase(),
        )
      )
        return null;
      const mapping = group.packageMap[`${name}@${group.references[name]}`];
      if (
        !record(mapping) ||
        typeof mapping.url !== 'string' ||
        /[%?#]/.test(mapping.url) ||
        /^[a-z]+:/i.test(mapping.url) ||
        key(
          win32.resolve(group.facts.installDir, 'node_modules', mapping.url),
        ) !== key(realPath)
      )
        throw failed();
      await this.guard(realPath);
      const link = { logicalPath, realPath, identity };
      await this.recheckLink(link);
      return link;
    } catch (error) {
      this.deps.signal.throwIfAborted();
      if (
        error instanceof AppException &&
        (error.details as { reason?: string } | undefined)?.reason ===
          'INVENTORY_FAILED'
      )
        throw error;
      return null;
    }
  }

  private invalidate(row: IGlobalPackage, reason: GlobalReasonCode): void {
    row.status =
      reason === 'LINKED_PACKAGE'
        ? 'linked'
        : reason === 'PROTECTED_PACKAGE'
          ? 'protected'
          : 'invalid';
    row.reason = reason;
    if (reason !== 'PROTECTED_PACKAGE' && reason !== 'GLOBAL_GROUP_UNSUPPORTED')
      this.result.ownershipComplete = false;
  }

  private async package(group: IGroup, name: string): Promise<void> {
    await this.checkpoint();
    const version = group.references[name].split('(')[0];
    const row: IGlobalPackage = {
      name,
      version,
      bins: [],
      status: 'manageable',
      reason: null,
    };
    this.result.packages.push(row);
    const link = await this.packageLink(group, name, version);
    if (!link) {
      this.invalidate(row, 'LINKED_PACKAGE');
      return;
    }
    group.facts.packageLinks = [...group.facts.packageLinks, link];
    const manifest = await this.data(win32.join(link.realPath, 'package.json'));
    await this.recheckLink(link);
    if (manifest.value.name !== name || manifest.value.version !== version) {
      this.invalidate(row, 'INVENTORY_FAILED');
      return;
    }
    const binIdentities: IRunnerFileIdentity[] = [];
    try {
      row.bins = normalizeGlobalBins(name, manifest.value.bin);
      for (const bin of row.bins) {
        const target = win32.resolve(link.realPath, bin.target);
        if (!inside(target, link.realPath)) throw failed();
        await this.guard(win32.dirname(target));
        const identity = await this.identity(target);
        const real = await this.deps.fs.realpath(target);
        this.deps.signal.throwIfAborted();
        if (
          !identity.stat.isFile() ||
          identity.stat.isSymbolicLink() ||
          key(real) !== key(target)
        )
          throw failed();
        binIdentities.push(identity);
      }
      for (const packageRoot of [
        link.logicalPath,
        link.realPath,
        group.facts.installDir,
      ])
        assertGlobalPackageMutable({
          packageName: name,
          packageRoot,
          linked: false,
          currentBins: row.bins,
          targetBins: [],
          binOwners: [],
          ownershipComplete: true,
          protectedPaths: this.location.protectedPaths,
        });
    } catch (error) {
      this.deps.signal.throwIfAborted();
      const protectedPackage =
        error instanceof AppException &&
        (error.details as { reason?: string } | undefined)?.reason ===
          'PROTECTED_PACKAGE';
      this.invalidate(
        row,
        protectedPackage ? 'PROTECTED_PACKAGE' : 'BIN_CONFLICT',
      );
    }
    if (
      row.status === 'manageable' &&
      group.facts.directDependencies.length > 1
    )
      this.invalidate(row, 'GLOBAL_GROUP_UNSUPPORTED');
    for (const bin of row.bins) {
      const nameKey = binKey(bin.name);
      if (this.owners.has(nameKey) && this.owners.get(nameKey) !== name) {
        this.owners.set(nameKey, null);
        this.result.ownershipComplete = false;
      } else this.owners.set(nameKey, name);
    }
    if (
      (row.status !== 'invalid' && row.status !== 'linked') ||
      row.reason === 'GLOBAL_GROUP_UNSUPPORTED'
    ) {
      const facts: IGlobalPackageFacts = {
        name,
        version,
        packageRoot: link.realPath,
        manifest: manifest.identity,
        bins: row.bins,
        binIdentities,
        pnpmGroup: group.facts,
      };
      this.result.facts.push(facts);
      this.groupByPackage.set(facts, group.facts);
      for (const bin of facts.bins) {
        const normalized = binKey(bin.name);
        this.factsByBin.set(normalized, [
          ...(this.factsByBin.get(normalized) ?? []),
          facts,
        ]);
      }
    }
  }

  // Shim arguments are inert data. Never open a path obtained from their text.
  private shimMatches(
    text: string,
    file: string,
    facts: IGlobalPackageFacts,
  ): boolean {
    const extension = win32.extname(file).toLowerCase();
    if (!['', '.cmd', '.ps1'].includes(extension)) return false;
    const group = facts.pnpmGroup!;
    const accepted = new Set(
      facts.bins
        .filter((bin) => binKey(bin.name) === binKey(win32.basename(file)))
        .flatMap((bin) => [
          key(win32.join(facts.packageRoot, bin.target)),
          key(
            win32.join(
              group.installDir,
              'node_modules',
              ...facts.name.split('/'),
              bin.target,
            ),
          ),
          key(
            win32.join(
              group.index.logicalPath,
              'node_modules',
              ...facts.name.split('/'),
              bin.target,
            ),
          ),
        ]),
    );
    return ownedShim(text, file, this.location.tool.file, accepted);
  }

  private async shims(
    directory: string,
    group?: IPnpmGlobalGroupFacts,
  ): Promise<void> {
    const global = group === undefined;
    const expected = this.result.facts.filter(
      (facts) => !group || this.groupByPackage.get(facts) === group,
    );
    try {
      await this.guard(directory);
    } catch (error) {
      this.deps.signal.throwIfAborted();
      if (global) throw error;
      try {
        await this.deps.fs.lstat(directory);
      } catch (absent) {
        this.deps.signal.throwIfAborted();
        if (missing(absent)) {
          for (const facts of expected)
            for (const bin of facts.bins) {
              this.owners.set(binKey(bin.name), null);
              this.result.ownershipComplete = false;
            }
          return;
        }
      }
      throw failed();
    }
    const files = await this.directory(directory);
    const present = new Set(files.map((file) => file.toLowerCase()));
    for (const facts of expected)
      for (const bin of facts.bins) {
        if (
          ['', '.cmd', '.ps1'].some(
            (extension) => !present.has((bin.name + extension).toLowerCase()),
          )
        ) {
          this.owners.set(binKey(bin.name), null);
          this.result.ownershipComplete = false;
        }
      }
    for (const name of files) {
      await this.checkpoint();
      const file = win32.join(directory, name);
      const identity = await this.identity(file);
      const normalized = binKey(name);
      if (identity.stat.isDirectory?.() && !identity.stat.isSymbolicLink()) {
        if (global) this.result.ownershipComplete = false;
        continue;
      }
      const candidates = (this.factsByBin.get(normalized) ?? []).filter(
        (facts) => !group || this.groupByPackage.get(facts) === group,
      );
      let owner: string | null = null;
      if (
        candidates.length === 1 &&
        identity.stat.isFile() &&
        !identity.stat.isSymbolicLink()
      ) {
        const data = await readRunnerFile(
          file,
          64 * 1024,
          this.deps.fs,
          this.deps.signal,
          'win32',
          {
            budget: this.budget,
            checkParent: () => this.guard(directory),
          },
        );
        if (data) {
          this.shimHashes.push({
            file: data.identity,
            sha256: createHash('sha256').update(data.bytes).digest('hex'),
          });
          if (this.shimMatches(data.text, file, candidates[0]))
            owner = candidates[0].name;
        }
      }
      if (owner === null || (global && this.owners.get(normalized) !== owner)) {
        this.owners.set(normalized, null);
        this.result.ownershipComplete = false;
      } else if (global) this.owners.set(normalized, owner);
      for (const facts of candidates) facts.binIdentities.push(identity);
    }
  }

  private async stableGroup(group: IPnpmGlobalGroupFacts): Promise<void> {
    await this.guard(group.installDir);
    if (!sameEntry(group.directory, await this.identity(group.installDir)))
      throw failed();
    await this.recheckLink(group.index);
    for (const link of group.packageLinks) {
      await this.guard(link.realPath);
      await this.recheckLink(link);
    }
    for (const config of [
      group.manifest,
      group.lockfile,
      group.modules,
      group.packageMap,
      group.virtualStoreLockfile,
    ]) {
      await this.guard(win32.dirname(config.file.path));
      if (!sameEntry(config.file, await this.identity(config.file.path)))
        throw failed();
      const real = await this.deps.fs.realpath(config.file.path);
      this.deps.signal.throwIfAborted();
      if (key(real) !== key(config.file.path)) throw failed();
    }
  }

  async read(): Promise<IGlobalInventoryResult> {
    const { globalRoot, binDir, pnpm } = this.location;
    if (
      !pnpm ||
      this.location.manager !== 'pnpm' ||
      key(globalRoot) !== key(pnpm.globalRoot) ||
      key(binDir) !== key(pnpm.binDir)
    )
      throw failed();
    await this.guard(binDir);
    let absent = false;
    try {
      await this.identity(globalRoot);
    } catch (error) {
      this.deps.signal.throwIfAborted();
      if (
        !missing(error) ||
        !pnpm.missingDirectoryPaths.some(
          (path) => key(path) === key(globalRoot),
        )
      )
        throw error;
      await this.guard(globalRoot, true);
      absent = true;
    }
    if (!absent) {
      if (
        pnpm.missingDirectoryPaths.some((path) => key(path) === key(globalRoot))
      )
        throw failed();
      await this.guard(globalRoot);
      const names = await this.directory(globalRoot);
      const physical = new Map<string, IRunnerFileIdentity>();
      const indices: IPnpmGlobalLinkFacts[] = [];
      for (const name of names) {
        await this.checkpoint();
        const path = win32.join(globalRoot, name);
        const identity = await this.identity(path);
        if (identity.stat.isSymbolicLink() && indexName.test(name)) {
          try {
            indices.push(await this.proveIndex(path));
          } catch {
            this.deps.signal.throwIfAborted();
            this.result.ownershipComplete = false;
          }
        } else if (
          identity.stat.isDirectory?.() &&
          !identity.stat.isSymbolicLink()
        ) {
          physical.set(key(path), identity);
          if (!installName.test(name)) this.result.ownershipComplete = false;
        } else if (name !== 'pnpm-workspace.yaml')
          this.result.ownershipComplete = false;
      }
      const visited = new Set<string>();
      for (const index of indices) {
        if (
          !physical.has(key(index.realPath)) ||
          visited.has(key(index.realPath))
        ) {
          this.result.ownershipComplete = false;
          continue;
        }
        visited.add(key(index.realPath));
        const group = await this.group(index);
        this.groups.push(group.facts);
        for (const name of group.facts.directDependencies)
          await this.package(group, name);
        await this.shims(
          win32.join(group.facts.installDir, 'node_modules', '.bin'),
          group.facts,
        );
        await this.stableGroup(group.facts);
      }
      for (const [path, identity] of physical)
        if (!visited.has(path)) this.orphans.push(identity);
    }
    await this.shims(binDir);
    const counts = new Map<string, number>();
    for (const row of this.result.packages)
      counts.set(row.name, (counts.get(row.name) ?? 0) + 1);
    for (const row of this.result.packages) {
      if (counts.get(row.name)! > 1) this.invalidate(row, 'INVENTORY_FAILED');
      else if (
        row.bins.some((bin) => this.owners.get(binKey(bin.name)) !== row.name)
      )
        this.invalidate(row, 'BIN_CONFLICT');
    }
    const usable = new Set(
      this.result.packages
        .filter(
          (row) =>
            (row.status !== 'invalid' && row.status !== 'linked') ||
            row.reason === 'GLOBAL_GROUP_UNSUPPORTED',
        )
        .map((row) => row.name),
    );
    this.result.facts = this.result.facts.filter((facts) =>
      usable.has(facts.name),
    );
    for (const group of this.groups) await this.stableGroup(group);
    for (const facts of this.result.facts) {
      await this.guard(win32.dirname(facts.manifest.file.path));
      if (
        !sameEntry(
          facts.manifest.file,
          await this.identity(facts.manifest.file.path),
        )
      )
        throw failed();
      for (const file of facts.binIdentities) {
        await this.guard(win32.dirname(file.path));
        if (!sameEntry(file, await this.identity(file.path))) throw failed();
      }
    }
    this.result.packages.sort((a, b) => a.name.localeCompare(b.name));
    this.result.binOwners = [...this.owners]
      .map(([name, owner]) => ({ name, owner }))
      .sort((a, b) => a.name.localeCompare(b.name));
    this.result.pnpmInventory = {
      groups: this.groups,
      unreferencedDirectories: this.orphans,
      ownershipComplete: this.result.ownershipComplete,
      shimIdentities: this.shimHashes,
    };
    return this.result;
  }
}

export async function readPnpmGlobalInventory(
  location: IGlobalResolvedLocation,
  deps: IGlobalInventoryDeps,
): Promise<IGlobalInventoryResult> {
  deps.signal.throwIfAborted();
  try {
    return await new PnpmInventoryReader(location, deps).read();
  } catch {
    deps.signal.throwIfAborted();
    throw failed();
  }
}
