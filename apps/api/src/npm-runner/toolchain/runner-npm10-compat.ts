import { createHash } from 'node:crypto';
import { resolve, win32 as path } from 'node:path';
import type {
  IRunnerFileIdentity,
  IRunnerFs,
  IRunnerNpm10CompatSnapshot,
  IRunnerTool,
} from '@/npm-runner/interfaces/npm-runner.types';
import {
  readRunnerFile,
  runnerFailure,
  runnerIdentity,
  sameRunnerIdentity,
} from '@/npm-runner/toolchain/runner-tool';

const MAXIMUM = 1024 * 1024;
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
const sha = (bytes: Buffer | string) =>
  createHash('sha256').update(bytes).digest('hex');
const unique = (text: string, marker: string) =>
  text.split(marker).length === 2;

// Compatibility failures disable install_all only; core tool validation stays with the resolver.
export async function readNpm10InstallCompat(
  tool: IRunnerTool,
  fs: IRunnerFs,
  signal: AbortSignal,
): Promise<IRunnerNpm10CompatSnapshot> {
  signal.throwIfAborted();
  const assets = {
    preload: resolve(__dirname, '../execution/npm10-install-preload.js'),
    source: path.join(tool.packageDir, 'lib/commands/install.js'),
    loader: path.join(tool.packageDir, 'lib/npm.js'),
  };
  const identities: IRunnerFileIdentity[] = [];
  const observations: unknown[] = [];
  const observed = new Map<string, IRunnerFileIdentity>();
  const checkParents = async (file: string) => {
    for (let at = path.dirname(file); ; at = path.dirname(at)) {
      signal.throwIfAborted();
      const stat = await fs.lstat(at);
      const real = await fs.realpath(at);
      signal.throwIfAborted();
      if (
        !stat.isDirectory?.() ||
        stat.isSymbolicLink() ||
        path.resolve(real).toLowerCase() !== path.resolve(at).toLowerCase()
      )
        throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
      const prior = observed.get(at);
      if (prior && !sameRunnerIdentity(prior.stat, stat))
        throw runnerFailure('INPUT_CHANGED');
      if (!prior) {
        const identity = runnerIdentity(at, stat);
        observed.set(at, identity);
        identities.push(identity);
      }
      if (path.dirname(at) === at) break;
    }
  };
  const results = new Map<string, { text: string; digest: string }>();
  let supported =
    tool.manager === 'npm' &&
    /^10\.\d+\.\d+(?:[-+].*)?$/.test(tool.version) &&
    tool.entry === path.join(tool.packageDir, 'bin/npm-cli.js');
  for (const [name, file] of Object.entries(assets)) {
    let presence: unknown = 'unobserved';
    try {
      const stat = await fs.lstat(file);
      signal.throwIfAborted();
      presence = [
        stat.size,
        stat.dev,
        stat.ino,
        stat.mtimeMs,
        stat.ctimeMs,
        stat.isFile(),
        stat.isSymbolicLink(),
      ];
      const read = await readRunnerFile(file, MAXIMUM, fs, signal, 'win32', {
        checkParent: () => checkParents(file),
        reason: 'TOOL_LAYOUT_UNSUPPORTED',
      });
      if (!read) throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
      const digest = sha(read.bytes);
      results.set(name, { text: read.text, digest });
      identities.push(read.identity);
      observations.push([name, file, 'read', presence, digest]);
    } catch (error) {
      signal.throwIfAborted();
      supported = false;
      const failure = (
        typeof error === 'object' && error !== null ? error : {}
      ) as {
        code?: unknown;
        name?: unknown;
        details?: { reason?: unknown };
      };
      if (failure.name === 'AbortError') throw error;
      observations.push([
        name,
        file,
        'unavailable',
        presence,
        failure.code ?? failure.details?.reason ?? failure.name ?? 'error',
      ]);
    }
  }
  const source = results.get('source');
  const loader = results.get('loader');
  const preload = results.get('preload');
  supported = Boolean(
    supported &&
    source &&
    loader &&
    preload &&
    INSTALL_MARKERS.every((marker) => unique(source.text, marker)) &&
    unique(loader.text.replace(/\r\n/g, '\n'), DISPATCH),
  );
  signal.throwIfAborted();
  if (!supported || !source || !loader || !preload)
    return {
      compat: {
        revision: 1,
        supported: false,
        fingerprint: sha(
          JSON.stringify([
            tool.manager,
            tool.version,
            tool.entry,
            observations,
          ]),
        ),
      },
      identities,
    };
  return {
    compat: {
      revision: 1,
      supported: true,
      ...assets,
      sourceSha256: source.digest,
      loaderSha256: loader.digest,
      preloadSha256: preload.digest,
    },
    identities,
  };
}
