import { win32 } from 'node:path';
import {
  assertGlobalDirectory,
  readGlobalDirectory,
} from '@/global-packages/discovery/global-location';
import { readPnpm10File } from '@/global-packages/config/pnpm10-global-config';
import { isGlobalAbsolutePath } from '@/global-packages/execution/global-command';
import type { IGlobalConfigIdentity } from '@/global-packages/interfaces/global-packages.runtime';
import type {
  IYarnBinDirectory,
  IYarnBinSlot,
} from '@/global-packages/interfaces/yarn-global.types';
import type { IRunnerFs } from '@/npm-runner/interfaces/npm-runner.types';
import {
  runnerIdentity,
  sameRunnerIdentity,
} from '@/npm-runner/toolchain/runner-tool';

const compare = (p: string): string => win32.resolve(p).toLowerCase();
const inside = (path: string, parent: string): boolean =>
  compare(path) === compare(parent) ||
  compare(path).startsWith(`${compare(parent)}\\`);
const safePath = (p: string): boolean =>
  isGlobalAbsolutePath(p) && !/[$%`!;&|<>^(){}\r\n"]/.test(p);
const missing = (e: unknown): boolean =>
  e !== null && typeof e === 'object' && 'code' in e && e.code === 'ENOENT';

// Global wrapper templates proven from Yarn 1.22.22 cli.js:36096-36118 & Y1G-0 Fact E6.
const GLOBAL_CMD_TEMPLATE = `@"%~dp0\\{{winRel}}"   %*\n`;
const GLOBAL_CMD_ALT_TEMPLATE = `@"%~dp0\\{{winRel}}" %*\n`;
const GLOBAL_SH_SHEBANG_TEMPLATE =
  '#!/bin/sh\n' +
  'basedir=$(dirname "$(echo "$0" | sed -e \'s,\\\\,/,g\')")\n\n' +
  'case `uname` in\n' +
  '    *CYGWIN*) basedir=`cygpath -w "$basedir"`;;\n' +
  'esac\n\n' +
  'if [ -x "$basedir//bin/sh" ]; then\n' +
  '  "$basedir//bin/sh"  "$basedir/{{posixRel}}" "$@"\n' +
  '  ret=$?\n' +
  'else \n' +
  '  /bin/sh  "$basedir/{{posixRel}}" "$@"\n' +
  '  ret=$?\n' +
  'fi\n' +
  'exit $ret\n';
const GLOBAL_SH_DIRECT_TEMPLATE =
  '#!/bin/sh\n' +
  'basedir=$(dirname "$(echo "$0" | sed -e \'s,\\\\,/,g\')")\n\n' +
  'case `uname` in\n' +
  '    *CYGWIN*) basedir=`cygpath -w "$basedir"`;;\n' +
  'esac\n\n' +
  '"$basedir/{{posixRel}}" "$@"\n' +
  'exit $?\n';

// Local node_modules\.bin cmd-shim templates from Yarn 1.22.22 cli.js:46278-46372.
const LOCAL_CMD_NODE_TEMPLATE =
  '@IF EXIST "%~dp0\\node.exe" (\n' +
  '  "%~dp0\\node.exe"  "%~dp0\\{{winRel}}" %*\n' +
  ') ELSE (\n' +
  '  @SETLOCAL\n' +
  '  @SET PATHEXT=%PATHEXT:;.JS;=;%\n' +
  '  node  "%~dp0\\{{winRel}}" %*\n' +
  ')';
const LOCAL_SH_NODE_TEMPLATE =
  '#!/bin/sh\n' +
  'basedir=$(dirname "$(echo "$0" | sed -e \'s,\\\\,/,g\')")\n\n' +
  'case `uname` in\n' +
  '    *CYGWIN*) basedir=`cygpath -w "$basedir"`;;\n' +
  'esac\n\n' +
  'if [ -x "$basedir/node" ]; then\n' +
  '  "$basedir/node"  "$basedir/{{posixRel}}" "$@"\n' +
  '  ret=$?\n' +
  'else \n' +
  '  node  "$basedir/{{posixRel}}" "$@"\n' +
  '  ret=$?\n' +
  'fi\n' +
  'exit $ret\n';

export function proveYarnGlobalWrapperShim(input: {
  text: string;
  shimPath: string;
  binDir: string;
  globalDotBinDir: string;
  binName: string;
}): boolean {
  if (
    Buffer.byteLength(input.text) > 64 * 1024 ||
    ![input.shimPath, input.binDir, input.globalDotBinDir].every(safePath) ||
    !/^[a-z0-9][a-z0-9._-]*$/i.test(input.binName) ||
    compare(win32.dirname(input.shimPath)) !== compare(input.binDir)
  )
    return false;
  const base = win32.basename(input.shimPath).toLowerCase();
  const expected = input.binName.toLowerCase();
  const isCmd = base === `${expected}.cmd`;
  if (!isCmd && base !== expected) return false;
  const targetBin = win32.join(
    input.globalDotBinDir,
    isCmd ? `${input.binName}.cmd` : input.binName,
  );
  const rel = win32.relative(input.binDir, targetBin);
  if (
    win32.isAbsolute(rel) ||
    !inside(win32.resolve(input.binDir, rel), input.globalDotBinDir)
  )
    return false;
  const normalized = input.text.replace(/\r\n/g, '\n');
  if (isCmd) {
    const winRel = rel.replace(/\//g, '\\');
    return (
      normalized === GLOBAL_CMD_TEMPLATE.replaceAll('{{winRel}}', winRel) ||
      normalized === GLOBAL_CMD_ALT_TEMPLATE.replaceAll('{{winRel}}', winRel)
    );
  }
  const posixRel = rel.replace(/\\/g, '/');
  return (
    normalized ===
      GLOBAL_SH_SHEBANG_TEMPLATE.replaceAll('{{posixRel}}', posixRel) ||
    normalized ===
      GLOBAL_SH_DIRECT_TEMPLATE.replaceAll('{{posixRel}}', posixRel)
  );
}

export function proveYarnLocalBinShim(input: {
  text: string;
  shimPath: string;
  globalDotBinDir: string;
  targetFile: string;
  binName?: string;
}): boolean {
  if (
    Buffer.byteLength(input.text) > 64 * 1024 ||
    ![input.shimPath, input.globalDotBinDir, input.targetFile].every(
      safePath,
    ) ||
    compare(win32.dirname(input.shimPath)) !== compare(input.globalDotBinDir)
  )
    return false;
  const base = win32.basename(input.shimPath).toLowerCase();
  let isCmd: boolean;
  if (input.binName !== undefined) {
    const expected = input.binName.toLowerCase();
    isCmd = base === `${expected}.cmd`;
    if (!isCmd && base !== expected) return false;
  } else {
    const ext = win32.extname(input.shimPath).toLowerCase();
    if (ext !== '' && ext !== '.cmd') return false;
    isCmd = ext === '.cmd';
  }
  const rel = win32.relative(input.globalDotBinDir, input.targetFile);
  if (win32.isAbsolute(rel)) return false;
  const normalized = input.text.replace(/\r\n/g, '\n');
  if (isCmd) {
    const winRel = rel.replace(/\//g, '\\');
    return (
      normalized === LOCAL_CMD_NODE_TEMPLATE.replaceAll('{{winRel}}', winRel) ||
      normalized ===
        `${LOCAL_CMD_NODE_TEMPLATE.replaceAll('{{winRel}}', winRel)}\n` ||
      normalized === GLOBAL_CMD_TEMPLATE.replaceAll('{{winRel}}', winRel) ||
      normalized === GLOBAL_CMD_ALT_TEMPLATE.replaceAll('{{winRel}}', winRel)
    );
  }
  const posixRel = rel.replace(/\\/g, '/');
  return (
    normalized ===
      LOCAL_SH_NODE_TEMPLATE.replaceAll('{{posixRel}}', posixRel) ||
    normalized ===
      GLOBAL_SH_DIRECT_TEMPLATE.replaceAll('{{posixRel}}', posixRel)
  );
}

export async function readYarnBinDirectory(input: {
  fs: IRunnerFs;
  signal: AbortSignal;
  binDir: string;
  budget: { remaining: number };
  allowMissing?: boolean;
}): Promise<IYarnBinDirectory & { missing: boolean }> {
  const { fs, signal, binDir, budget, allowMissing } = input;
  const guard = () => assertGlobalDirectory(binDir, fs, signal);
  signal.throwIfAborted();
  if (allowMissing) {
    try {
      await fs.lstat(binDir);
      signal.throwIfAborted();
    } catch (error) {
      signal.throwIfAborted();
      if (missing(error)) {
        await assertGlobalDirectory(binDir, fs, signal, true);
        return { complete: true, slots: [], texts: new Map(), missing: true };
      }
      throw error;
    }
  }
  await guard();
  const before = runnerIdentity(binDir, await fs.lstat(binDir));
  signal.throwIfAborted();
  const names = await readGlobalDirectory(fs, binDir, signal);
  const sorted = [...names].sort();
  const result: IYarnBinDirectory = {
    complete: new Set(names.map((n) => n.toLowerCase())).size === names.length,
    slots: [],
    texts: new Map(),
  };
  const texts = new Map<string, string>();
  for (let index = 0; index < sorted.length; index++) {
    signal.throwIfAborted();
    if (index % 128 === 127) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      signal.throwIfAborted();
    }
    const name = sorted[index];
    const path = win32.join(binDir, name);
    const identity = runnerIdentity(path, await fs.lstat(path));
    signal.throwIfAborted();
    const slot: IYarnBinSlot = {
      name,
      identity,
      realPath: null,
      sha256: null,
      owner: null,
    };
    const shimCandidate =
      !/\.(?:exe|bat|com|dll|node|json|txt|md|yaml|yml)$/i.test(name);
    if (
      shimCandidate &&
      identity.stat.isFile() &&
      !identity.stat.isSymbolicLink() &&
      identity.stat.size <= 64 * 1024
    ) {
      const data = await readPnpm10File(
        path,
        64 * 1024,
        fs,
        signal,
        budget,
        guard,
        true,
      );
      if (!data || !sameRunnerIdentity(identity.stat, data.identity.file.stat))
        result.complete = false;
      else {
        slot.realPath = path;
        slot.sha256 = data.identity.sha256;
        texts.set(name.toLowerCase(), data.text);
      }
    }
    result.slots.push(slot);
  }
  await guard();
  const after = await fs.lstat(binDir);
  signal.throwIfAborted();
  const afterNames = [
    ...(await readGlobalDirectory(fs, binDir, signal)),
  ].sort();
  if (
    !sameRunnerIdentity(before.stat, after) ||
    JSON.stringify(sorted) !== JSON.stringify(afterNames)
  )
    result.complete = false;
  return { ...result, texts, missing: false };
}

export function proveYarnBinSet(input: {
  directory: IYarnBinDirectory;
  binDir: string;
  globalDotBinDir: string;
  binName: string;
  nodePath: string;
}): IGlobalConfigIdentity[] | null {
  const { directory: d, binName } = input;
  if (
    !d.complete ||
    !/^[a-z0-9][a-z0-9._-]*$/i.test(binName) ||
    /\.(?:cmd|ps1|exe|bat|com)$/i.test(binName)
  )
    return null;
  const normalized = binName.toLowerCase();
  const slots = d.slots.filter(
    (slot) =>
      slot.name.toLowerCase().replace(/\.(?:cmd|ps1|exe|bat|com)$/i, '') ===
      normalized,
  );
  if (slots.length !== 2) return null;
  const facts: IGlobalConfigIdentity[] = [];
  for (const ext of ['', '.cmd']) {
    const slot = slots.find(
      (s) => s.name.toLowerCase() === `${normalized}${ext}`,
    );
    const text = slot && d.texts.get(slot.name.toLowerCase());
    if (
      !slot ||
      text === undefined ||
      !slot.sha256 ||
      slot.identity.stat.isSymbolicLink() ||
      !proveYarnGlobalWrapperShim({
        text,
        shimPath: slot.identity.path,
        binDir: input.binDir,
        globalDotBinDir: input.globalDotBinDir,
        binName,
      })
    )
      return null;
    facts.push({ file: slot.identity, sha256: slot.sha256 });
  }
  if (
    d.slots.some(
      (s) =>
        /^node(?:\.exe)?$/i.test(s.name) &&
        compare(s.identity.path) !== compare(input.nodePath),
    )
  )
    return null;
  return facts;
}
