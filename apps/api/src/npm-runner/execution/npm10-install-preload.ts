import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { Module, createRequire } from 'node:module';
import { TextDecoder } from 'node:util';
import { isMainThread } from 'node:worker_threads';

// This asset runs before the native npm CLI and must depend on built-ins only.
const ENV = 'PKGSTEWARD_RUNNER_NPM10_INSTALL_COMPAT';
const raw = process.env[ENV];
const descriptorPresent = Object.keys(process.env).some(
  (key) => key.toUpperCase() === ENV,
);
for (const key of Object.keys(process.env))
  if (key.toUpperCase().startsWith(ENV)) delete process.env[key];
const ownedPairs: number[] = [];
for (let index = 0; index < process.execArgv.length - 1; index++)
  if (
    process.execArgv[index] === '--require' &&
    process.execArgv[index + 1] === __filename
  )
    ownedPairs.push(index);
// Forks inherit the cleaned arguments. Native Workers can retain the original
// preload list; run() passivates that inherited preload after metadata cleanup.
for (const index of [...ownedPairs].reverse())
  process.execArgv.splice(index, 2);

function refuse(): never {
  throw new Error('Unsupported npm10 install compatibility input');
}
const equal = (a: string, b: string) =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const identity = (a: fs.Stats, b: fs.Stats) =>
  (['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'] as const).every(
    (key) => a[key] === b[key],
  ) &&
  a.isFile() === b.isFile() &&
  a.isDirectory() === b.isDirectory() &&
  !a.isSymbolicLink() &&
  !b.isSymbolicLink();
function canonical(file: string): void {
  if (
    !path.isAbsolute(file) ||
    !equal(path.resolve(file), file) ||
    /[\0\r\n]/.test(file)
  )
    refuse();
  for (let at = file; ; at = path.dirname(at)) {
    const stat = fs.lstatSync(at);
    if (
      stat.isSymbolicLink() ||
      !equal(fs.realpathSync(at), at) ||
      (at !== file && !stat.isDirectory())
    )
      refuse();
    if (path.dirname(at) === at) break;
  }
}
function read(file: string): { bytes: Buffer; text: string; stat: fs.Stats } {
  canonical(file);
  const before = fs.lstatSync(file);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    !Number.isSafeInteger(before.size) ||
    before.size < 0 ||
    before.size > 1024 * 1024
  )
    refuse();
  const fd = fs.openSync(file, 'r');
  try {
    if (!identity(before, fs.fstatSync(fd))) refuse();
    const buffer = Buffer.alloc(before.size + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = fs.readSync(fd, buffer, size, buffer.length - size, size);
      if (count === 0) break;
      size += count;
    }
    if (
      size !== before.size ||
      !identity(before, fs.fstatSync(fd)) ||
      !identity(before, fs.lstatSync(file))
    )
      refuse();
    canonical(file);
    const bytes = buffer.subarray(0, size);
    return {
      bytes,
      text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      stat: before,
    };
  } finally {
    fs.closeSync(fd);
  }
}
const INSTALL_MARKERS = [
  'if (where === globalTop && !args.length)',
  'const isGlobalInstall = this.npm.global',
  'const where = isGlobalInstall ? globalTop : this.npm.prefix',
  'if (where === globalTop && !args.every(Boolean))',
  'if (!args.length && !isGlobalInstall && !ignoreScripts)',
];
const DISPATCH = `static cmd (c) {
    const command = deref(c)
    if (!command) {
      throw Object.assign(new Error(\`Unknown command \${c}\`), {
        code: 'EUNKNOWNCOMMAND',
        command: c,
      })
    }
    return require(\`./commands/\${command}.js\`)
  }`;
const unique = (text: string, marker: string) =>
  text.split(marker).length === 2;
interface IDescriptor {
  schema: 1;
  entry: string;
  version: string;
  sourceSha256: string;
  loaderSha256: string;
  preloadSha256: string;
}
function run(): void {
  if (!isMainThread) {
    if (descriptorPresent) refuse();
    return;
  }
  if (!raw || raw.length > 16384 || ownedPairs.length !== 1) refuse();
  const data = JSON.parse(raw) as IDescriptor;
  const keys = [
    'schema',
    'entry',
    'version',
    'sourceSha256',
    'loaderSha256',
    'preloadSha256',
  ];
  if (
    !data ||
    typeof data !== 'object' ||
    Object.keys(data).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(data, key)) ||
    data.schema !== 1 ||
    typeof data.entry !== 'string' ||
    typeof data.version !== 'string' ||
    !/^10\.\d+\.\d+(?:[-+].*)?$/.test(data.version) ||
    ![data.sourceSha256, data.loaderSha256, data.preloadSha256].every(
      (hash) => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash),
    )
  )
    refuse();
  const packageDir = path.dirname(path.dirname(data.entry));
  const loader = path.join(packageDir, 'lib/npm.js');
  const source = path.join(packageDir, 'lib/commands/install.js');
  const cwd = process.cwd();
  canonical(cwd);
  if (
    !fs.lstatSync(cwd).isDirectory() ||
    !equal(data.entry, path.join(packageDir, 'bin/npm-cli.js'))
  )
    refuse();
  const expected = [
    data.entry,
    '--prefix',
    cwd,
    '--global=false',
    '--no-audit',
    '--no-fund',
    '--no-progress',
    '--update-notifier=false',
    'install',
  ];
  if (
    process.argv.length !== expected.length + 1 ||
    !expected.every((value, index) => value === process.argv[index + 1])
  )
    refuse();
  const preload = read(__filename);
  read(data.entry);
  const metadata = JSON.parse(
    read(path.join(packageDir, 'package.json')).text,
  ) as { name?: unknown; version?: unknown };
  if (metadata?.name !== 'npm' || metadata.version !== data.version) refuse();
  const install = read(source);
  const dispatch = read(loader);
  if (
    sha(preload.bytes) !== data.preloadSha256 ||
    sha(install.bytes) !== data.sourceSha256 ||
    sha(dispatch.bytes) !== data.loaderSha256 ||
    !INSTALL_MARKERS.every((marker) => unique(install.text, marker)) ||
    !unique(dispatch.text.replace(/\r\n/g, '\n'), DISPATCH)
  )
    refuse();
  const sdkRequire = createRequire(loader);
  const key = sdkRequire.resolve('./commands/install.js');
  canonical(key);
  if (!equal(key, source) || !identity(install.stat, fs.lstatSync(key)))
    refuse();
  // Native cache key casing must be preserved; source compilation uses the captured bytes.
  const native = Module as typeof Module & {
    _cache: Record<string, Module | undefined>;
    _nodeModulePaths(dir: string): string[];
  };
  if (Object.hasOwn(native._cache, key)) refuse();
  const candidate = new Module(key);
  candidate.filename = key;
  candidate.paths = native._nodeModulePaths(path.dirname(key));
  native._cache[key] = candidate;
  try {
    const amended = install.text.replace(
      INSTALL_MARKERS[0],
      'if (isGlobalInstall && !args.length)',
    );
    (
      candidate as Module & { _compile(text: string, filename: string): void }
    )._compile(amended, key);
    candidate.loaded = true;
    const npm = sdkRequire(loader) as { cmd(name: string): unknown };
    if (
      npm.cmd('install') !== candidate.exports ||
      npm.cmd('i') !== candidate.exports
    )
      refuse();
  } catch (error) {
    if (native._cache[key] === candidate) delete native._cache[key];
    throw error;
  }
}
run();
