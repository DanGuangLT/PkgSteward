import 'reflect-metadata';
import { GlobalRegistry } from '@/global-packages/global-registry';
import type { IGlobalRegistryRequest } from '@/global-packages/global-registry';
import { expectGlobalReason } from '@/global-packages/__fixtures__/global-adapters';

const integrity = `sha512-${Buffer.alloc(64, 1).toString('base64')}`;
const request = (
  patch: Partial<IGlobalRegistryRequest> = {},
): IGlobalRegistryRequest => ({
  manager: 'npm',
  packageName: '@test/tool',
  action: 'change',
  configs: [],
  environment: {},
  provenanceKnown: true,
  ...patch,
});
const manifest = (patch: Record<string, unknown> = {}) => ({
  name: '@test/tool',
  version: '1.2.3',
  bin: { 'test-tool': 'bin/cli.js' },
  dist: {
    integrity,
    tarball: 'https://registry.npmjs.org/@test/tool/-/tool-1.2.3.tgz',
  },
  ...patch,
});
const packument = (patch: Record<string, unknown> = {}) => ({
  name: '@test/tool',
  versions: {
    '1.2.3': { name: '@test/tool', version: '1.2.3' },
    '2.0.0': { name: '@test/tool', version: '2.0.0' },
  },
  'dist-tags': { latest: '2.0.0', old: '1.2.3' },
  ...patch,
});
const json = (value: unknown): Response =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
const mockFetch = (): jest.MockedFunction<typeof fetch> =>
  jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockImplementation(() => Promise.resolve(json(manifest())));
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('fixed-origin global registry', () => {
  it('encodes scoped names and canonical exact versions without auth or redirects', async () => {
    const fetcher = mockFetch().mockResolvedValue(
      json(manifest({ version: '1.2.3+build.1' })),
    );
    const signal = new AbortController().signal;
    const target = await new GlobalRegistry(fetcher).getTarget(
      request(),
      '1.2.3+build.1',
      signal,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      'https://registry.npmjs.org/%40test%2Ftool/1.2.3%2Bbuild.1',
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        credentials: 'omit',
        signal,
      }),
    );
    const headers = new Headers(fetcher.mock.calls[0][1]?.headers);
    expect(headers.has('authorization')).toBe(false);
    expect(headers.has('cookie')).toBe(false);
    expect(target).toMatchObject({
      name: '@test/tool',
      version: '1.2.3+build.1',
      requestedVersion: '1.2.3+build.1',
      integrity,
    });
  });
  it('returns validated target facts, without scripts, arbitrary metadata or tarball I/O', async () => {
    const fetcher = mockFetch().mockResolvedValue(
      json(
        manifest({
          scripts: { postinstall: 'TEST never execute' },
          description: 'TEST untrusted metadata',
        }),
      ),
    );
    const result = await new GlobalRegistry(fetcher).getTarget(
      request(),
      '1.2.3',
      new AbortController().signal,
    );
    const { manifestHash, ...target } = result;
    expect(target).toEqual({
      name: '@test/tool',
      version: '1.2.3',
      requestedVersion: '1.2.3',
      bins: [{ name: 'test-tool', target: 'bin/cli.js' }],
      integrity,
    });
    expect(manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toMatch(
      /postinstall|never execute|untrusted metadata|tarball/,
    );
  });
  it('loads version options with a fixed public packument request', async () => {
    const fetcher = mockFetch().mockResolvedValue(json(packument()));
    expect(
      await new GlobalRegistry(fetcher).getVersions(
        request({ manager: 'pnpm' }),
        new AbortController().signal,
      ),
    ).toEqual({
      manager: 'pnpm',
      package: '@test/tool',
      versions: ['1.2.3', '2.0.0'],
      tags: { latest: '2.0.0', old: '1.2.3' },
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://registry.npmjs.org/%40test%2Ftool',
      expect.objectContaining({
        redirect: 'error',
        credentials: 'omit',
      }),
    );
  });
  it('resolves a tag then requests its pinned exact manifest', async () => {
    const fetcher = mockFetch()
      .mockResolvedValueOnce(json(packument()))
      .mockResolvedValueOnce(json(manifest({ version: '2.0.0' })));
    expect(
      await new GlobalRegistry(fetcher).getTarget(
        request(),
        'latest',
        new AbortController().signal,
      ),
    ).toMatchObject({
      version: '2.0.0',
      requestedVersion: 'latest',
    });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://registry.npmjs.org/%40test%2Ftool',
      'https://registry.npmjs.org/%40test%2Ftool/2.0.0',
    ]);
  });
  it('does not cache a mutable tag between preview and execute reads', async () => {
    const fetcher = mockFetch()
      .mockResolvedValueOnce(
        json(packument({ 'dist-tags': { latest: '1.2.3' } })),
      )
      .mockResolvedValueOnce(json(manifest()))
      .mockResolvedValueOnce(json(packument()))
      .mockResolvedValueOnce(json(manifest({ version: '2.0.0' })));
    const registry = new GlobalRegistry(fetcher);
    const before = await registry.getTarget(
      request(),
      'latest',
      new AbortController().signal,
    );
    const after = await registry.getTarget(
      request(),
      'latest',
      new AbortController().signal,
    );
    expect([before.version, after.version]).toEqual(['1.2.3', '2.0.0']);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it.each([
    { configs: ['registry=https://private.invalid'] },
    { configs: ['@test:registry=https://registry.npmjs.org'] },
    { configs: ['registry=${TEST_REGISTRY}'] },
    { environment: { npm_config_registry: 'https://private.invalid' } },
    { provenanceKnown: false },
  ] satisfies Partial<IGlobalRegistryRequest>[])(
    'rejects unsupported config before any public lookup %p',
    async (patch) => {
      const fetcher = mockFetch();
      const registry = new GlobalRegistry(fetcher);
      await expectGlobalReason(
        () =>
          registry.getVersions(request(patch), new AbortController().signal),
        'REGISTRY_CONFIG_UNSUPPORTED',
      );
      await expectGlobalReason(
        () =>
          registry.getTarget(
            request(patch),
            '1.2.3',
            new AbortController().signal,
          ),
        'REGISTRY_CONFIG_UNSUPPORTED',
      );
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it('allows public npm auth presence while forwarding no credential', async () => {
    const fetcher = mockFetch();
    await new GlobalRegistry(fetcher).getTarget(
      request({
        configs: ['//registry.npmjs.org/:_authToken=TEST-not-a-token'],
        environment: { NPM_TOKEN: 'TEST-not-a-token' },
      }),
      '1.2.3',
      new AbortController().signal,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain(
      'TEST-not-a-token',
    );
  });
  it.each([
    '../tool',
    'https://private.invalid/pkg',
    'tool@npm:other',
    '--registry=private',
  ])(
    'rejects non-registry package name %s before fetch',
    async (packageName) => {
      const fetcher = mockFetch();
      await expectGlobalReason(
        () =>
          new GlobalRegistry(fetcher).getTarget(
            request({ packageName }),
            '1.2.3',
            new AbortController().signal,
          ),
        'INVALID_PACKAGE_SPEC',
      );
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it.each(['^1.2.3', '*', 'v1.2.3', 'file:TEST', '1.2.3\n'])(
    'rejects invalid target %s before fetch',
    async (version) => {
      const fetcher = mockFetch();
      await expectGlobalReason(
        () =>
          new GlobalRegistry(fetcher).getTarget(
            request(),
            version,
            new AbortController().signal,
          ),
        'INVALID_PACKAGE_SPEC',
      );
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
});

describe('registry response validation and bounds', () => {
  it.each([
    { name: 'other' },
    { version: '9.0.0' },
    { version: '^1.2.3' },
    { bin: { tool: '../outside.js' } },
    { bin: { 'tool\n': 'cli.js' } },
    { dist: null },
    { dist: {} },
    { dist: { integrity: 123, tarball: 'TEST' } },
  ])('refuses mismatched or malformed exact manifest %p', async (patch) => {
    const fetcher = mockFetch().mockResolvedValue(json(manifest(patch)));
    await expectGlobalReason(
      () =>
        new GlobalRegistry(fetcher).getTarget(
          request(),
          '1.2.3',
          new AbortController().signal,
        ),
      'REGISTRY_INVALID_RESPONSE',
    );
  });
  it('supports binless and scoped string-bin metadata', async () => {
    const fetcher = mockFetch()
      .mockResolvedValueOnce(json(manifest({ bin: undefined })))
      .mockResolvedValueOnce(json(manifest({ bin: 'cli.js' })));
    const registry = new GlobalRegistry(fetcher);
    expect(
      (
        await registry.getTarget(
          request(),
          '1.2.3',
          new AbortController().signal,
        )
      ).bins,
    ).toEqual([]);
    expect(
      (
        await registry.getTarget(
          request(),
          '1.2.3',
          new AbortController().signal,
        )
      ).bins,
    ).toEqual([{ name: 'tool', target: 'cli.js' }]);
  });
  it.each([
    {},
    { versions: [], 'dist-tags': {} },
    packument({ versions: { 'bad-version': {} } }),
    packument({ 'dist-tags': { latest: 123 } }),
    packument({ 'dist-tags': { latest: '9.0.0' } }),
  ])('refuses incomplete packument %p', async (value) => {
    const fetcher = mockFetch().mockResolvedValue(json(value));
    await expectGlobalReason(
      () =>
        new GlobalRegistry(fetcher).getVersions(
          request(),
          new AbortController().signal,
        ),
      'REGISTRY_INVALID_RESPONSE',
    );
  });
  it.each([
    [404, 'REGISTRY_NOT_FOUND'],
    [429, 'REGISTRY_RATE_LIMITED'],
    [401, 'REGISTRY_AUTH_REQUIRED'],
    [403, 'REGISTRY_AUTH_REQUIRED'],
    [302, 'REGISTRY_UNAVAILABLE'],
    [500, 'REGISTRY_UNAVAILABLE'],
  ])(
    'maps HTTP %s without retry, credential or private fallback',
    async (status, reason) => {
      const fetcher = mockFetch().mockResolvedValue(
        new Response('TEST error', { status: Number(status) }),
      );
      await expectGlobalReason(
        () =>
          new GlobalRegistry(fetcher).getTarget(
            request(),
            '1.2.3',
            new AbortController().signal,
          ),
        String(reason),
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it('maps fetch redirect rejection without a second request', async () => {
    const fetcher = mockFetch().mockRejectedValue(
      new TypeError('TEST redirect'),
    );
    await expectGlobalReason(
      () =>
        new GlobalRegistry(fetcher).getVersions(
          request(),
          new AbortController().signal,
        ),
      'REGISTRY_UNAVAILABLE',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([Buffer.from('{'), Buffer.from([0xc3, 0x28])])(
    'rejects malformed JSON/UTF-8 bodies',
    async (bytes) => {
      const fetcher = mockFetch().mockResolvedValue(new Response(bytes));
      await expectGlobalReason(
        () =>
          new GlobalRegistry(fetcher).getTarget(
            request(),
            '1.2.3',
            new AbortController().signal,
          ),
        'REGISTRY_INVALID_RESPONSE',
      );
    },
  );
  it.each(['manifest', 'packument'] as const)(
    'bounds streamed %s bodies without content-length',
    async (kind) => {
      const cancel = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
      const chunk = new Uint8Array(1024 * 1024);
      const response = new Response(
        new ReadableStream<Uint8Array>({
          start(stream) {
            for (let i = 0; i < (kind === 'manifest' ? 5 : 65); i++)
              stream.enqueue(chunk);
          },
          cancel,
        }),
      );
      const fetcher = mockFetch().mockResolvedValue(response);
      const registry = new GlobalRegistry(fetcher);
      await expectGlobalReason(
        () =>
          kind === 'manifest'
            ? registry.getTarget(
                request(),
                '1.2.3',
                new AbortController().signal,
              )
            : registry.getVersions(request(), new AbortController().signal),
        'LIMIT_EXCEEDED',
      );
      expect(cancel).toHaveBeenCalledTimes(1);
    },
  );
  it('rejects more than 10,000 version options without truncation', async () => {
    const versions = Object.fromEntries(
      Array.from({ length: 10_001 }, (_, i) => [`1.0.${i}`, {}]),
    );
    const fetcher = mockFetch().mockResolvedValue(
      json(packument({ versions, 'dist-tags': {} })),
    );
    await expectGlobalReason(
      () =>
        new GlobalRegistry(fetcher).getVersions(
          request(),
          new AbortController().signal,
        ),
      'LIMIT_EXCEEDED',
    );
  });
});

describe('registry cancellation and shared request capacity', () => {
  it('does no fetch for a signal already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('TEST cancelled registry'));
    const fetcher = mockFetch();
    await expect(
      new GlobalRegistry(fetcher).getTarget(
        request(),
        '1.2.3',
        controller.signal,
      ),
    ).rejects.toThrow('TEST cancelled registry');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('cancels an active body read when aborted', async () => {
    const controller = new AbortController();
    const cancel = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
    const fetcher = mockFetch().mockResolvedValue(
      new Response(new ReadableStream({ cancel })),
    );
    const pending = new GlobalRegistry(fetcher).getTarget(
      request(),
      '1.2.3',
      controller.signal,
    );
    const settled = Promise.allSettled([pending]);
    await tick();
    controller.abort(new Error('TEST body cancelled'));
    const results = await settled;
    expect(results[0].status).toBe('rejected');
    if (results[0].status === 'rejected') {
      const reason: unknown = results[0].reason;
      expect(reason).toEqual(new Error('TEST body cancelled'));
    }
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it('limits mixed packument/manifest fetches to four and removes aborted queued work', async () => {
    const releases: (() => void)[] = [];
    const fetcher = mockFetch().mockImplementation((url) => {
      const address =
        typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      return new Promise<Response>((resolve) => {
        releases.push(() =>
          resolve(json(address.endsWith('/1.2.3') ? manifest() : packument())),
        );
      });
    });
    const registry = new GlobalRegistry(fetcher);
    const queued = new AbortController();
    const signal = new AbortController().signal;
    const settled = Promise.allSettled([
      registry.getVersions(request(), signal),
      registry.getTarget(request(), '1.2.3', signal),
      registry.getVersions(request(), signal),
      registry.getTarget(request(), '1.2.3', signal),
      registry.getTarget(request(), '1.2.3', queued.signal),
    ]);
    await tick();
    const callsBeforeRelease = fetcher.mock.calls.length;
    queued.abort(new Error('TEST queued cancelled'));
    for (const release of releases) release();
    const result = await settled;
    expect(callsBeforeRelease).toBe(4);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(result.slice(0, 4).map((entry) => entry.status)).toEqual(
      Array<string>(4).fill('fulfilled'),
    );
    expect(result[4].status).toBe('rejected');
    if (result[4].status === 'rejected') {
      const reason: unknown = result[4].reason;
      expect(reason).toEqual(new Error('TEST queued cancelled'));
    }
  });
});
