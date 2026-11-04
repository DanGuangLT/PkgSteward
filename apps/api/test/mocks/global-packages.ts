import { ConfigService } from '@nestjs/config';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { createTestAppPaths } from '@/../test/create-test-app-paths';
import { TEST_PATHS } from '@/global-packages/__fixtures__/global-adapters';
import {
  flushJobs,
  testRuntime,
} from '@/global-packages/__fixtures__/global-lifecycle';
import type { IGlobalProbeResult } from '@/global-packages/interfaces/global-packages.runtime';
import { MutationGateService } from '@/core/mutation-gate/mutation-gate.service';

// TEST không phải yêu cầu nghiệp vụ. All PM files/probes are in memory.
export function globalHttpFixture() {
  const f = testRuntime();
  const gate = new MutationGateService();
  f.runtime.gate = gate;
  f.runtime.environment = {
    SystemRoot: 'C:\\Windows',
    PATH: 'D:\\TEST\\absent-tools',
  };
  const config = new ConfigService({
    PKGSTEWARD_DATA_DIR: join(tmpdir(), 'pkgsteward-test-m7-http'),
  });
  const appPaths = createTestAppPaths(
    config,
    join(tmpdir(), 'pkgsteward-test-m7-app'),
  );
  const root = win32.join(TEST_PATHS.prefix, 'node_modules');
  const manifestPath = win32.join(root, 'test-tool', 'package.json');
  let installed = true;
  let version = '1.0.0';
  const putManifest = () =>
    f.fs.put(manifestPath, {
      text: JSON.stringify({ name: 'test-tool', version }),
    });
  f.fs.put(TEST_PATHS.node, { text: 'TEST inert Node executable' });
  f.fs.put(win32.join(TEST_PATHS.npm, 'package.json'), {
    text: JSON.stringify({
      name: 'npm',
      version: '11.17.0',
      bin: { npm: 'bin/npm-cli.js' },
    }),
  });
  f.fs.put(win32.join(TEST_PATHS.npm, 'bin', 'npm-cli.js'), {
    text: '// TEST inert npm entry',
  });
  for (const path of [
    TEST_PATHS.prefix,
    root,
    TEST_PATHS.cache,
    TEST_PATHS.cwd,
  ])
    f.fs.put(path, { directory: true });
  putManifest();
  f.fs.readdir.mockImplementation((path: string) => {
    const prefix = `${win32.resolve(path).toLowerCase()}\\`;
    const names = [...f.fs.entries.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .filter((key) => key.length > 0 && !key.includes('\\'));
    return Promise.resolve(names);
  });
  const probeResult = (text: string): IGlobalProbeResult => ({
    stdout: Buffer.from(text),
    stderr: Buffer.alloc(0),
    exitCode: 0,
    terminationVerified: true,
  });
  f.probe.mockImplementation((_file, args, options) => {
    options.signal.throwIfAborted();
    if (args.includes('list'))
      return Promise.resolve(
        probeResult(
          JSON.stringify({
            dependencies: installed ? { 'test-tool': { version } } : {},
          }),
        ),
      );
    if (args.includes('root')) return Promise.resolve(probeResult(`${root}\n`));
    const paths: Record<string, string> = {
      prefix: TEST_PATHS.prefix,
      userconfig: TEST_PATHS.userconfig,
      globalconfig: TEST_PATHS.globalconfig,
      cache: TEST_PATHS.cache,
    };
    const query = args.at(-1)!;
    if (!Object.hasOwn(paths, query))
      throw new Error(`TEST unexpected probe ${query}`);
    return Promise.resolve(probeResult(`${paths[query]}\n`));
  });
  f.fetcher.mockImplementation(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          name: 'test-tool',
          'dist-tags': { latest: '2.0.0' },
          versions: {
            '1.0.0': { name: 'test-tool', version: '1.0.0' },
            '2.0.0': { name: 'test-tool', version: '2.0.0' },
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    ),
  );
  return {
    ...f,
    gate,
    config,
    appPaths,
    removeAndExit: async () => {
      installed = false;
      f.child.exit();
      await flushJobs();
    },
    changeFacts: () => {
      version = '1.0.1';
      putManifest();
    },
  };
}
