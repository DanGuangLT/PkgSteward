import { win32 } from 'node:path';
import { config10Fixture, P10 } from './config';
import { f5bStep, F5B_MANIFESTS } from './facts';
import { F5B_SHIMS } from './shims';
import { testLocation, testSpawn } from '../global-adapters';
import { readPnpm10GlobalConfig } from '../../config/pnpm10-global-config';
import { parse, stringify } from 'yaml';

// TEST không phải yêu cầu nghiệp vụ. Memory-only project; junctions never
// delegate to a real filesystem, including the external link source.
export async function pnpm10InventoryFixture(step = 6) {
  const h = config10Fixture();
  const snapshot = f5bStep(step);
  for (const [relative, text] of Object.entries(snapshot.files))
    h.put(win32.join(P10.root, relative), { text });
  h.put(P10.store, { directory: true });
  // Retained versions accumulate; b9 intentionally retains all prior versions.
  const installed = new Map<string, string>();
  for (let n = 1; n <= step; n++)
    for (const [name, dep] of Object.entries(
      f5bStep(n).list[0].dependencies ?? {},
    )) {
      if (dep.version.startsWith('link:')) continue;
      installed.set(`${name}@${dep.version}`, dep.path);
    }
  if (step >= 4)
    installed.set(
      'is-number@6.0.0',
      `${P10.root}\\.pnpm\\is-number@6.0.0\\node_modules\\is-number`,
    );
  for (const [id, path] of installed) {
    h.put(path, { directory: true });
    h.put(`${path}\\package.json`, { text: F5B_MANIFESTS[id] });
    if (id.startsWith('semver@'))
      h.put(`${path}\\bin\\semver.js`, {
        text: '#!/usr/bin/env node\n// TEST inert semver bin',
      });
  }
  for (const [name, dep] of Object.entries(
    snapshot.list[0].dependencies ?? {},
  )) {
    h.put(win32.join(P10.root, 'node_modules', name), {
      link: true,
      real: dep.path,
    });
  }
  if (step >= 4)
    h.put(`${P10.root}\\.pnpm\\is-odd@3.0.1\\node_modules\\is-number`, {
      link: true,
      real: `${P10.root}\\.pnpm\\is-number@6.0.0\\node_modules\\is-number`,
    });
  for (const [name, family] of Object.entries(F5B_SHIMS)) {
    if (!snapshot.list[0].dependencies?.[name]) continue;
    for (const [ext, text] of Object.entries(family))
      h.put(`${P10.home}\\${name}${ext}`, { text });
  }
  if (step >= 6)
    for (const [name, family] of Object.entries(F5B_SHIMS)) {
      for (const [ext, text] of Object.entries(family))
        h.put(`${P10.root}\\node_modules\\.bin\\${name}${ext}`, {
          // Same pnpm.cjs generator; local .bin has a different relative operand.
          text: text
            .replaceAll('%~dp0\\global\\5\\.pnpm', '%~dp0\\..\\..\\.pnpm')
            .replaceAll('$basedir/global/5/.pnpm', '$basedir/../../.pnpm')
            .replaceAll(
              '%~dp0\\..\\linksrc',
              '%~dp0\\..\\..\\..\\..\\..\\linksrc',
            )
            .replaceAll(
              '$basedir/../linksrc',
              '$basedir/../../../../../linksrc',
            ),
        });
    }
  h.put(`${P10.home}\\foreign.txt`, { text: 'TEST reserved file' });
  // Enumerate actual memory entries, not a hardcoded result for the reader.
  h.readdir.mockImplementation((directory: string) =>
    Promise.resolve(
      [...h.entries.keys()]
        .filter(
          (path) =>
            win32.dirname(path).toLowerCase() === directory.toLowerCase() &&
            path !== directory.toLowerCase(),
        )
        .map((path) => win32.basename(path)),
    ),
  );
  const config = await readPnpm10GlobalConfig(h.deps);
  const location = {
    ...testLocation('pnpm', '10.34.9'),
    tool: h.deps.tool,
    globalRoot: P10.root,
    globalDir: config.globalDir,
    binDir: P10.home,
    storeDir: P10.store,
    userConfig: config.userConfig,
    globalConfig: config.globalConfig,
    cacheDir: config.cacheDir,
    configIdentities: [...config.configIdentities],
    pnpm10: config,
  };
  const spawn = testSpawn();
  const deps = {
    fs: h.fs,
    environment: h.environment,
    signal: h.controller.signal,
    spawn,
  };
  return { ...h, deps, location, snapshot, spawn };
}

export async function pnpm10BinlessFixture(
  version: '7.0.0' | '6.0.0' | null = '7.0.0',
  missingBin = true,
) {
  const h = await pnpm10InventoryFixture(
    version === null ? 9 : version === '7.0.0' ? 4 : 5,
  );
  const key = (p: string) => win32.resolve(p).toLowerCase();
  for (const relative of [
    'package.json',
    'pnpm-lock.yaml',
    'node_modules/.pnpm/lock.yaml',
  ]) {
    const file = win32.join(P10.root, relative),
      entry = h.entries.get(key(file));
    if (!entry?.text) continue;
    const data = parse(entry.text) as {
      dependencies?: Record<string, unknown>;
      importers?: Record<string, { dependencies?: Record<string, unknown> }>;
    };
    const dependencies =
      data.importers?.['.']?.dependencies ?? data.dependencies;
    for (const name of Object.keys(dependencies ?? {}))
      if (name !== 'is-number') {
        delete dependencies![name];
        h.entries.delete(key(win32.join(P10.root, 'node_modules', name)));
      }
    h.put(file, {
      text:
        relative === 'package.json' ? JSON.stringify(data) : stringify(data),
    });
  }
  const binDir = 'D:\\TEST\\separate-bin';
  h.put(binDir, { directory: true });
  h.environment.npm_config_global_bin_dir = binDir;
  h.environment.PATH = `${binDir};${win32.dirname(h.location.tool.file)}`;
  const config = await readPnpm10GlobalConfig({
    fs: h.fs,
    tool: h.location.tool,
    environment: h.environment,
    cwd: h.location.cwd,
    signal: h.controller.signal,
    checkDirectory: h.checkDirectory,
  });
  if (missingBin) h.entries.delete(key(binDir));
  h.location.binDir = binDir;
  h.location.configIdentities = [...config.configIdentities];
  h.location.pnpm10 = {
    ...config,
    directoryIdentities: config.directoryIdentities.filter(
      (d) => !missingBin || key(d.path) !== key(binDir),
    ),
    missingDirectoryPaths: [
      ...config.missingDirectoryPaths,
      ...(missingBin ? [binDir] : []),
    ],
  };
  return h;
}

// Immutable registry metadata observed from pnpm 10.34.9 isolated layout:
// cliui@8.0.1 + wrap-ansi@7.0.0, eight private hoists. Paths are TEST-only;
// manifests are inert identity fixtures, not installed package implementations.
const PRIVATE_HOIST_PACKAGES = Object.freeze([
  [
    'ansi-regex',
    '5.0.1',
    'sha512-quJQXlTSUGL2LH9SUXo8VwsY4soanhgo6LNSm84E1LBcE8s3O0wpdiRzyR9z/ZZJMlMWv37qOOb9pdJlMUEKFQ==',
    {},
  ],
  [
    'ansi-styles',
    '4.3.0',
    'sha512-zbB9rCJAT1rbjiVDb2hqKFHNYLxgtk8NURxZ3IZwD3F6NtxbXZQCnnSi1Lkx+IDohdPlFp222wVALIheZJQSEg==',
    { 'color-convert': '2.0.1' },
  ],
  [
    'cliui',
    '8.0.1',
    'sha512-BSeNnyus75C4//NQ9gQt1/csTXyo/8Sb+afLAkzAptFuMsod9HFokGNudZpi/oQV73hnVK+sR+5PVRMd+Dr7YQ==',
    { 'string-width': '4.2.3', 'strip-ansi': '6.0.1', 'wrap-ansi': '7.0.0' },
  ],
  [
    'color-convert',
    '2.0.1',
    'sha512-RRECPsj7iu/xb5oKYcsFHSppFNnsj/52OVTRKb4zP5onXwVF3zVmmToNcOfGC+CRDpfK/U584fMg38ZHCaElKQ==',
    { 'color-name': '1.1.4' },
  ],
  [
    'color-name',
    '1.1.4',
    'sha512-dOy+3AuW3a2wNbZHIuMZpTcgjGuLU/uBL/ubcZF9OXbDo8ff4O8yVp5Bf0efS8uEoYo5q4Fx7dY9OgQGXgAsQA==',
    {},
  ],
  [
    'emoji-regex',
    '8.0.0',
    'sha512-MSjYzcWNOA0ewAHpz0MxpYFvwg6yjy1NG3xteoqz644VCo/RPgnr1/GGt+ic3iJTzQ8Eu3TdM14SawnVUmGE6A==',
    {},
  ],
  [
    'is-fullwidth-code-point',
    '3.0.0',
    'sha512-zymm5+u+sCsSWyD9qNaejV3DFvhCKclKdizYaJUuHA83RLjb7nSuGnddCHGv0hk+KY7BMAlsWeK4Ueg6EV6XQg==',
    {},
  ],
  [
    'string-width',
    '4.2.3',
    'sha512-wKyQRQpjJ0sIp62ErSZdGsjMJWsap5oRNihHhu6G7JVO/9jIB6UyevL+tXuOqrng8j/cxKTWyWUwvSTriiZz/g==',
    {
      'emoji-regex': '8.0.0',
      'is-fullwidth-code-point': '3.0.0',
      'strip-ansi': '6.0.1',
    },
  ],
  [
    'strip-ansi',
    '6.0.1',
    'sha512-Y38VPSHcqkFrCpFnQ9vuSXmquuv5oXOKpGeT6aGrr3o3Gc9AlVa6JBfUSOCnbxGGZF+/0ooI7KrPuUSztUdU5A==',
    { 'ansi-regex': '5.0.1' },
  ],
  [
    'wrap-ansi',
    '7.0.0',
    'sha512-YVGIj2kamLSTxw6NsZjoBxfSwsn0ycdesmc4p+Q21c5zPuZ1pl+NfxVdxPtdHvmNVOQ6XSYG4AUtyt/Fi7D16Q==',
    { 'ansi-styles': '4.3.0', 'string-width': '4.2.3', 'strip-ansi': '6.0.1' },
  ],
] as const);

export async function pnpm10PrivateHoistFixture(
  scoped = false,
  operation?: 'change' | 'remove',
) {
  const h = await pnpm10InventoryFixture(9);
  for (const path of [...h.entries.keys()])
    if (path.startsWith(`${P10.root}\\`.toLowerCase())) h.entries.delete(path);
  const direct: Record<string, string> = {
    cliui: '8.0.1',
    ...(operation === 'remove'
      ? {}
      : { 'wrap-ansi': operation === 'change' ? '8.0.0' : '7.0.0' }),
  };
  const packages: Record<string, unknown> = {};
  const snapshots: Record<string, unknown> = {};
  const hoistedDependencies: Record<string, Record<string, string>> = {};
  const installed: readonly (readonly [string, string, string, object])[] = [
    ...PRIVATE_HOIST_PACKAGES,
    // Synthetic scoped extension, separate from the observed eight-package map.
    ...(scoped ? [['@test/tool', '1.0.0', 'sha512-TEST==', {}] as const] : []),
    // Synthetic after-state only: adding/removing the target recomputes private
    // hoists; cliui still needs wrap-ansi@7.0.0 and shared string-width@4.2.3.
    ...(operation === 'change'
      ? [
          [
            'wrap-ansi',
            '8.0.0',
            'sha512-TEST==',
            { '@test/target-only': '1.0.0' },
          ] as const,
          ['@test/target-only', '1.0.0', 'sha512-TEST==', {}] as const,
        ]
      : []),
  ];
  for (const [name, version, integrity, dependencies] of installed) {
    const locator = `${name}@${version}`;
    packages[locator] = { resolution: { integrity } };
    snapshots[locator] = Object.keys(dependencies).length
      ? { dependencies }
      : {};
    const path = win32.join(
      P10.root,
      '.pnpm',
      locator.replace('/', '+'),
      'node_modules',
      name,
    );
    h.put(path, { directory: true });
    h.put(win32.join(path, 'package.json'), {
      text: JSON.stringify({ name, version }),
    });
    const isDirect = direct[name] === version;
    h.put(
      win32.join(
        P10.root,
        isDirect ? 'node_modules' : '.pnpm/node_modules',
        name,
      ),
      { link: true, real: path },
    );
    if (!isDirect) hoistedDependencies[locator] = { [name]: 'private' };
  }
  const lock = stringify({
    lockfileVersion: '9.0',
    settings: { autoInstallPeers: true, excludeLinksFromLockfile: false },
    importers: {
      '.': {
        dependencies: Object.fromEntries(
          Object.entries(direct).map(([name, version]) => [
            name,
            { specifier: version, version },
          ]),
        ),
      },
    },
    packages,
    snapshots,
  });
  h.put(win32.join(P10.root, 'package.json'), {
    text: JSON.stringify({ dependencies: direct }),
  });
  for (const relative of ['pnpm-lock.yaml', 'node_modules/.pnpm/lock.yaml'])
    h.put(win32.join(P10.root, relative), { text: lock });
  h.put(win32.join(P10.root, 'node_modules/.modules.yaml'), {
    text: JSON.stringify({
      hoistedDependencies,
      hoistPattern: ['*'],
      included: {
        dependencies: true,
        devDependencies: true,
        optionalDependencies: true,
      },
      injectedDeps: {},
      layoutVersion: 5,
      nodeLinker: 'isolated',
      packageManager: 'pnpm@10.34.9',
      pendingBuilds: [],
      publicHoistPattern: [],
      registries: {
        default: 'https://registry.npmjs.org/',
        '@jsr': 'https://npm.jsr.io/',
      },
      skipped: [],
      storeDir: P10.store,
      virtualStoreDir: win32.join(P10.root, '.pnpm'),
      virtualStoreDirMaxLength: 60,
    }),
  });
  h.put(win32.join(P10.root, 'node_modules/.pnpm-workspace-state-v1.json'), {
    text: h.snapshot.files['node_modules/.pnpm-workspace-state-v1.json'],
  });
  // Discovery also pins the global manifest as a config source. Refresh that
  // real proof after replacing the inherited empty project's metadata.
  const config = await readPnpm10GlobalConfig({
    fs: h.fs,
    tool: h.location.tool,
    environment: h.environment,
    cwd: h.location.cwd,
    signal: h.controller.signal,
    checkDirectory: h.checkDirectory,
  });
  h.location.pnpm10 = config;
  h.location.configIdentities = [...config.configIdentities];
  const privateHoistFiles = Object.freeze(
    Object.fromEntries(
      [
        'package.json',
        'pnpm-lock.yaml',
        'node_modules/.pnpm/lock.yaml',
        'node_modules/.modules.yaml',
        'node_modules/.pnpm-workspace-state-v1.json',
      ].map((relative) => [
        relative,
        h.entries.get(win32.join(P10.root, relative).toLowerCase())!.text!,
      ]),
    ),
  );
  return { ...h, privateHoistFiles };
}
