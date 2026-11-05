import { win32 } from 'node:path';

// TEST không phải yêu cầu nghiệp vụ. SOURCE-DERIVED generated text, never run.
// pnpm 11.22.0 @zkochan/cmd-shim: generateCmdShim:44287, generateShShim:44335,
// generatePwshShim:44463. Covers Node fallback branches and pinned nodeExecPath.
export function pnpmNodeShims(
  target: string,
  directory: string,
  nodeFile?: string,
) {
  const relative = win32.relative(directory, target);
  const script = `"$basedir/${relative.replace(/\\/g, '/')}"`;
  const winScript = `"$basedir_win/${relative.replace(/\\/g, '/')}"`;
  const cmdScript = `"%~dp0\\${relative}"`;
  const nodePath = 'D:\\TEST\\node_modules';
  const shNodePath = nodePath.replace(/\\/g, '/');
  const cmdHeader = `@SETLOCAL\r\n@IF NOT DEFINED NODE_PATH (\r\n  @SET "NODE_PATH=${nodePath}"\r\n) ELSE (\r\n  @SET "NODE_PATH=${nodePath};%NODE_PATH%"\r\n)\r\n`;
  const cmd =
    cmdHeader +
    (nodeFile
      ? `@"${nodeFile}"  ${cmdScript} %*\r\n`
      : `@IF EXIST "%~dp0\\node.exe" (\r\n  "%~dp0\\node.exe"  ${cmdScript} %*\r\n) ELSE (\r\n  @SET PATHEXT=%PATHEXT:;.JS;=;%\r\n  node  ${cmdScript} %*\r\n)\r\n`);
  const shHeader = String.raw`#!/bin/sh
link="$0"
hops=0
while [ -L "$link" ] && [ "$hops" -lt 40 ]; do
  hops=$((hops+1))
  target=$(readlink "$link")
  case "$target" in
    /*) link="$target" ;;
    *)  link="$(dirname "$link")/$target" ;;
  esac
done
basedir=$(dirname "$(echo "$link" | sed -e 's,\\,/,g')")
basedir_win="$basedir"
exe=""
msys=""

case \`uname -a\` in
  *CYGWIN*|*MINGW*|*MSYS*)
    if command -v cygpath > /dev/null 2>&1; then
      basedir_win=\`cygpath -w "$basedir"\`
    fi
    exe=".exe"
    msys="true"
  ;;
  *WSL2*)
    if command -v wslpath > /dev/null 2>&1; then
      basedir_win="$(wslpath -w "$basedir" 2> /dev/null)"
      if [ $? -ne 0 ] || [ -z "$basedir_win" ]; then
        basedir_win="$basedir"
      else
        exe=".exe"
      fi
    fi
  ;;
esac
`.replace(/\\`/g, '`');
  const shEnv = `if [ -z "$NODE_PATH" ]; then\n  export NODE_PATH="${shNodePath}"\nelse\n  export NODE_PATH="${shNodePath}:$NODE_PATH"\nfi\n`;
  const sh =
    shHeader +
    shEnv +
    (nodeFile
      ? `exec "${nodeFile}"  ${winScript} "$@"\nexit $?\n`
      : `if [ -n "$exe" ] && [ -x "$basedir/node.exe" ]; then\n  exec "$basedir/node.exe"  ${winScript} "$@"\nelif [ -x "$basedir/node" ]; then\n  exec "$basedir/node"  ${script} "$@"\nelif command -v node >/dev/null 2>&1; then\n  exec node  ${script} "$@"\nelif [ -n "$exe" ] && command -v node.exe >/dev/null 2>&1; then\n  exec node.exe  ${winScript} "$@"\nelse\n  exec node  ${script} "$@"\nfi\n`);
  const psHeader = `#!/usr/bin/env pwsh\n$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent\n$exe=""\n$pathsep=":"\n$env_node_path=$env:NODE_PATH\n$new_node_path="${nodePath}"\nif ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {\n  $exe=".exe"\n  $pathsep=";"\n} else {\n  $new_node_path="${nodePath}"\n}\nif ([string]::IsNullOrEmpty($env_node_path)) {\n  $env:NODE_PATH=$new_node_path\n} else {\n  $env:NODE_PATH="$new_node_path$pathsep$env_node_path"\n}\n`;
  const psRun = (program: string) =>
    `if ($MyInvocation.ExpectingInput) {\n  $input | & ${program}  ${script} $args\n} else {\n  & ${program}  ${script} $args\n}\n`;
  const ps =
    psHeader +
    (nodeFile
      ? psRun(`"${nodeFile}"`) +
        '$env:NODE_PATH=$env_node_path\nexit $LASTEXITCODE\n'
      : `$ret=0\nif (Test-Path "$basedir/node$exe") {\n${psRun('"$basedir/node$exe"')}$ret=$LASTEXITCODE\n} else {\n${psRun('"node$exe"')}$ret=$LASTEXITCODE\n}\n$env:NODE_PATH=$env_node_path\nexit $ret\n`);
  return { '': sh, '.cmd': cmd, '.ps1': ps };
}
