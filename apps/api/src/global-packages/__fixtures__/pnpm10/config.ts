import { win32 } from 'node:path';
import { memoryFs, testTool, TEST_PATHS } from '../global-adapters';
import type { IPnpmGlobalConfigDeps } from '../../interfaces/pnpm-global.types';

// TEST không phải yêu cầu nghiệp vụ. No host filesystem or process is used.
export const P10 = {
  home: 'D:\\TEST\\pnpm10',
  profile: 'D:\\TEST\\profile',
  local: 'D:\\TEST\\local',
  config: 'D:\\TEST\\local\\pnpm\\config',
  root: 'D:\\TEST\\pnpm10\\global\\5',
  store: 'D:\\TEST\\pnpm10\\store\\v10',
  cwd: TEST_PATHS.cwd,
};

export function config10Fixture(patch: NodeJS.ProcessEnv = {}) {
  const memory = memoryFs();
  const controller = new AbortController();
  const tool = testTool('pnpm', '10.34.9');
  const environment: NodeJS.ProcessEnv = {
    USERPROFILE: P10.profile,
    LOCALAPPDATA: P10.local,
    PNPM_HOME: P10.home,
    PATH: `${P10.home};${win32.dirname(tool.file)}`,
    ...patch,
  };
  const checkDirectory = jest.fn<Promise<void>, [string]>().mockResolvedValue();
  const deps: IPnpmGlobalConfigDeps = {
    fs: memory.fs,
    tool,
    cwd: P10.cwd,
    environment,
    signal: controller.signal,
    checkDirectory,
  };
  for (const directory of [P10.home, P10.cwd])
    memory.put(directory, { directory: true });
  // Node's bundled npm has an index.js export. pnpm resolves ../npmrc from it.
  const npm = win32.join(win32.dirname(tool.file), 'node_modules', 'npm');
  memory.put(win32.join(npm, 'package.json'), {
    text: JSON.stringify({
      name: 'npm',
      main: './index.js',
      exports: { '.': [{ default: './index.js' }, './index.js'] },
    }),
  });
  memory.put(win32.join(npm, 'index.js'), { text: '// TEST inert entry' });
  return { ...memory, deps, controller, checkDirectory, environment };
}
