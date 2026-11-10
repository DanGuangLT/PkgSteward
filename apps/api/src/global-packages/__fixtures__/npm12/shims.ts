// TEST không phải yêu cầu nghiệp vụ. Inert shim text, never run.
// npm 12.2.2 (bin-links cmd-shim 9.0.2): captured from a real global install in an
// isolated fixture prefix; only the target path is parameterized.
// npm 11.17.0 (cmd-shim 8.0.0): SOURCE-DERIVED from writeShim_ for comparison.
const npm12Sh = (target: string): string =>
  [
    '#!/bin/sh',
    String.raw`basedir=$(dirname "$(echo "$0" | sed -e 's,\\,/,g')")`,
    'basedir_win="$basedir"',
    '',
    'case `uname -a` in',
    '  *CYGWIN*|*MINGW*|*MSYS*)',
    '    if command -v cygpath > /dev/null 2>&1; then',
    '      basedir_win=`cygpath -w "$basedir"`',
    '    fi',
    '  ;;',
    '  *WSL2*)',
    '    if command -v wslpath > /dev/null 2>&1; then',
    '      basedir_win="$(wslpath -w "$basedir" 2> /dev/null)"',
    '      if [ $? -ne 0 ] || [ -z "$basedir_win" ]; then',
    '        echo "Error: wslpath failed to convert path. WSL environment may be misconfigured." >&2',
    '        exit 1',
    '      fi',
    '    fi',
    '  ;;',
    'esac',
    '',
    'PROG_EXE="$basedir/node.exe"',
    'if ! [ -x "$PROG_EXE" ]; then',
    '  PROG_EXE="$basedir/node"',
    '  if ! [ -x "$PROG_EXE" ]; then',
    '    PROG_EXE=node',
    '    if ! [ -x "$PROG_EXE" ]; then',
    '      PROG_EXE=node.exe',
    '    fi',
    '  fi',
    'fi',
    '',
    `exec "$PROG_EXE"  "$basedir_win/${target}" "$@"`,
    '',
  ].join('\n');

const npm12Cmd = (target: string): string =>
  [
    '@ECHO off',
    'GOTO start',
    ':find_dp0',
    'SET dp0=%~dp0',
    'EXIT /b',
    ':start',
    'SETLOCAL',
    'CALL :find_dp0',
    '',
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ') ELSE (',
    '  SET "_prog=node"',
    ')',
    '',
    'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & set PATHEXT=%PATHEXT:;.JS;=;% & ' +
      `"%_prog%"  "%dp0%\\${target.replace(/\//g, '\\')}" %*`,
    '',
  ].join('\r\n');

const npm12Ps1 = (target: string): string => {
  const run = (node: string) => [
    '  # Support pipeline input',
    '  if ($MyInvocation.ExpectingInput) {',
    `    $input | & "${node}"  "$basedir/${target}" $args`,
    '  } else {',
    `    & "${node}"  "$basedir/${target}" $args`,
    '  }',
    '  $ret=$LASTEXITCODE',
  ];
  return [
    '#!/usr/bin/env pwsh',
    '$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent',
    '',
    '$exe=""',
    'if ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {',
    '  # Fix case when both the Windows and Linux builds of Node',
    '  # are installed in the same directory',
    '  $exe=".exe"',
    '}',
    '$ret=0',
    'if (Test-Path "$basedir/node$exe") {',
    ...run('$basedir/node$exe'),
    '} else {',
    ...run('node$exe'),
    '}',
    'exit $ret',
    '',
  ].join('\n');
};

/** Real npm 12.2.2 launchers for `target`, relative to the bin directory with `/`. */
export function npm12Shims(
  target: string,
): Record<'' | '.cmd' | '.ps1', string> {
  return {
    '': npm12Sh(target),
    '.cmd': npm12Cmd(target),
    '.ps1': npm12Ps1(target),
  };
}

/** npm 11.17.0 sh launcher (cmd-shim 8.0.0 writeShim_ with prog "node"). */
export function npm11Sh(target: string): string {
  return [
    '#!/bin/sh',
    String.raw`basedir=$(dirname "$(echo "$0" | sed -e 's,\\,/,g')")`,
    '',
    'case `uname` in',
    '    *CYGWIN*|*MINGW*|*MSYS*)',
    '        if command -v cygpath > /dev/null 2>&1; then',
    '            basedir=`cygpath -w "$basedir"`',
    '        fi',
    '    ;;',
    'esac',
    '',
    'if [ -x "$basedir/node" ]; then',
    `  exec "$basedir/node"  "$basedir/${target}" "$@"`,
    'else ',
    `  exec node  "$basedir/${target}" "$@"`,
    'fi',
    '',
  ].join('\n');
}
