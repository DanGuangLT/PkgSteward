import { win32 } from 'node:path';
import { PNPM12_TEST_PATHS as Q } from '@/global-packages/__fixtures__/pnpm12/facts';
import { pnpmNodeShims } from '@/global-packages/__fixtures__/pnpm11/shims';

// TEST không phải yêu cầu nghiệp vụ.
// Verbatim pnpm 12.21.0 @zkochan/cmd-shim POSIX template observed in P12-0;
// .cmd and .ps1 templates are identical to pnpm 11.22.0.
export function pnpm12NodeShims(
  target: string,
  options: {
    binDir?: string;
    nodeFile?: string;
    nodePath?: string;
  } = {},
): Record<'' | '.cmd' | '.ps1', string> {
  const binDir = options.binDir ?? Q.bin;
  const base = pnpmNodeShims(target, binDir, options.nodeFile);
  const relative = win32.relative(binDir, target).replace(/\\/g, '/');
  const nodePath = options.nodePath ?? `${Q.store}\\links\\node_modules`;
  const unixNodePath = nodePath
    .replace(/^([a-z]):/i, (_, d: string) => `/mnt/${d.toLowerCase()}`)
    .replace(/\\/g, '/');
  const posixTarget = target.replace(/\\/g, '/');
  const sh = [
    '#!/bin/sh',
    'caller_path_set=${PATH+set}',
    'caller_path=${PATH-}',
    'helper_path=',
    'rest=$caller_path:',
    'while [ -n "$rest" ]; do',
    '  dir=${rest%%:*}',
    '  rest=${rest#*:}',
    '  case "$dir" in',
    '    */node_modules/*|*/node_modules) ;;',
    '    /*) helper_path=${helper_path:+$helper_path:}$dir ;;',
    '  esac',
    'done',
    'PATH=${helper_path:-/}',
    'run_helper() {',
    '  if [ -x "/usr/bin/$1" ] || [ -x "/bin/$1" ] || ! command -v "$1" >/dev/null 2>&1; then command -p "$@"; else command "$@"; fi',
    '}',
    'link="$0"',
    'case "$link" in',
    '  */*|*\\\\*) ;;',
    '  *) link="./$link" ;;',
    'esac',
    'hops=0',
    'while [ -L "$link" ] && [ "$hops" -lt 40 ]; do',
    '  hops=$((hops+1))',
    '  target=$(run_helper readlink "$link")',
    '  case "$target" in',
    '    /*) link="$target" ;;',
    '    *)  link="${link%/*}/$target" ;;',
    '  esac',
    'done',
    'case "$link" in',
    "  *\\\\*) basedir=$(run_helper printf '%s\\n' \"$link\" | run_helper sed -e 's,\\\\,/,g') ;;",
    '  *) basedir=$link ;;',
    'esac',
    'basedir="${basedir%/*}"',
    'basedir_abs=$(CDPATH= cd -P -- "$basedir" && pwd -P) || exit $?',
    'basedir="$basedir_abs"',
    'basedir_win="$basedir"',
    'exe=""',
    'msys=""',
    'os=',
    '{ read -r os < /proc/version; } 2> /dev/null || :',
    'case "$os" in',
    '  *CYGWIN*|*MINGW*|*MSYS*)',
    '    if converted=$(command -p cygpath -w "$basedir" 2>/dev/null) && [ -n "$converted" ]; then',
    '      basedir_win="$converted"',
    '    elif command -v cygpath > /dev/null 2>&1; then',
    '      basedir_win=`cygpath -w "$basedir"`',
    '    fi',
    '    exe=".exe"',
    '    msys="true"',
    '  ;;',
    '  *WSL2*)',
    '    if converted=$(command -p wslpath -w "$basedir" 2>/dev/null) && [ -n "$converted" ]; then',
    '      basedir_win="$converted"',
    '      exe=".exe"',
    '    elif command -v wslpath > /dev/null 2>&1; then',
    '      basedir_win="$(wslpath -w "$basedir" 2> /dev/null)"',
    '      if [ $? -ne 0 ] || [ -z "$basedir_win" ]; then',
    '        basedir_win="$basedir"',
    '      else',
    '        exe=".exe"',
    '      fi',
    '    fi',
    '  ;;',
    'esac',
    'if [ -n "$caller_path_set" ]; then PATH=$caller_path; else unset PATH; fi',
    '',
    'if [ -n "$msys" ]; then',
    `  new_node_path='${nodePath}'`,
    "  node_path_sep=';'",
    'else',
    `  new_node_path='${unixNodePath}'`,
    "  node_path_sep=':'",
    'fi',
    'if [ -z "$NODE_PATH" ]; then',
    '  export NODE_PATH="$new_node_path"',
    'else',
    '  export NODE_PATH="$new_node_path$node_path_sep$NODE_PATH"',
    'fi',
    'if [ -n "$exe" ] && [ -x "$basedir/node.exe" ]; then',
    `  exec "$basedir/node.exe"  "$basedir_win"/'${relative}' "$@"`,
    'elif [ -x "$basedir/node" ]; then',
    `  exec "$basedir/node"  "$basedir_abs"/'${relative}' "$@"`,
    'elif [ -n "$msys" ] && command -v node >/dev/null 2>&1; then',
    `  exec node  "$basedir_win"/'${relative}' "$@"`,
    'elif command -v node >/dev/null 2>&1; then',
    `  exec node  "$basedir_abs"/'${relative}' "$@"`,
    'elif [ -n "$exe" ] && command -v node.exe >/dev/null 2>&1; then',
    `  exec node.exe  "$basedir_win"/'${relative}' "$@"`,
    'else',
    `  exec node  "$basedir_abs"/'${relative}' "$@"`,
    'fi',
    `# cmd-shim-target=${posixTarget}`,
    '',
  ].join('\n');
  return {
    '': sh,
    '.cmd': base['.cmd'],
    '.ps1': base['.ps1'],
  };
}
