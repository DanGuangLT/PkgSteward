import { win32 } from 'node:path';

// Source-derived from Yarn 1.22.22 cli.js:46278-46372 and Y1G-0 empirical observation (Fact E6).
export function yarnLocalBinShims(
  globalDotBinDir: string,
  binName: string,
  targetFile: string,
): { cmdPath: string; cmdText: string; shPath: string; shText: string } {
  const rel = win32.relative(globalDotBinDir, targetFile);
  const winRel = rel.replace(/\//g, '\\');
  const posixRel = rel.replace(/\\/g, '/');
  return {
    cmdPath: win32.join(globalDotBinDir, `${binName}.cmd`),
    cmdText:
      `@IF EXIST "%~dp0\\node.exe" (\r\n` +
      `  "%~dp0\\node.exe"  "%~dp0\\${winRel}" %*\r\n` +
      `) ELSE (\r\n` +
      `  @SETLOCAL\r\n` +
      `  @SET PATHEXT=%PATHEXT:;.JS;=;%\r\n` +
      `  node  "%~dp0\\${winRel}" %*\r\n` +
      `)`,
    shPath: win32.join(globalDotBinDir, binName),
    shText:
      `#!/bin/sh\n` +
      `basedir=$(dirname "$(echo "$0" | sed -e 's,\\\\,/,g')")\n\n` +
      `case \`uname\` in\n` +
      `    *CYGWIN*) basedir=\`cygpath -w "$basedir"\`;;\n` +
      `esac\n\n` +
      `if [ -x "$basedir/node" ]; then\n` +
      `  "$basedir/node"  "$basedir/${posixRel}" "$@"\n` +
      `  ret=$?\n` +
      `else \n` +
      `  node  "$basedir/${posixRel}" "$@"\n` +
      `  ret=$?\n` +
      `fi\n` +
      `exit $ret\n`,
  };
}

export function yarnGlobalBinShims(
  binDir: string,
  globalDotBinDir: string,
  binName: string,
): { cmdPath: string; cmdText: string; shPath: string; shText: string } {
  const winRelCmd = win32
    .relative(binDir, win32.join(globalDotBinDir, `${binName}.cmd`))
    .replace(/\//g, '\\');
  const posixRel = win32
    .relative(binDir, win32.join(globalDotBinDir, binName))
    .replace(/\\/g, '/');
  return {
    cmdPath: win32.join(binDir, `${binName}.cmd`),
    cmdText: `@"%~dp0\\${winRelCmd}"   %*\r\n`,
    shPath: win32.join(binDir, binName),
    shText:
      `#!/bin/sh\n` +
      `basedir=$(dirname "$(echo "$0" | sed -e 's,\\\\,/,g')")\n\n` +
      `case \`uname\` in\n` +
      `    *CYGWIN*) basedir=\`cygpath -w "$basedir"\`;;\n` +
      `esac\n\n` +
      `if [ -x "$basedir//bin/sh" ]; then\n` +
      `  "$basedir//bin/sh"  "$basedir/${posixRel}" "$@"\n` +
      `  ret=$?\n` +
      `else \n` +
      `  /bin/sh  "$basedir/${posixRel}" "$@"\n` +
      `  ret=$?\n` +
      `fi\n` +
      `exit $ret\n`,
  };
}
