import { execa } from 'execa';
import { ProjectRegistry } from '@/projects/project-registry';

jest.mock('execa', () => ({ execa: jest.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}

function metadata(): Response {
  return response({
    versions: { '1.0.0': {}, '2.0.0': {} },
    'dist-tags': { latest: '2.0.0' },
  });
}

describe('ProjectRegistry fixed HTTP transport', () => {
  let fetcher: jest.MockedFunction<typeof fetch>;
  let registry: ProjectRegistry;
  let controller: AbortController;

  beforeEach(() => {
    jest.clearAllMocks();
    fetcher = jest.fn();
    registry = new ProjectRegistry(fetcher);
    controller = new AbortController();
  });

  afterEach(() => {
    expect(execa).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it('encodes a scoped name at the constant origin with explicit safe options', async () => {
    fetcher.mockResolvedValue(metadata());
    const result = await registry.getPackageMetadata(
      '@scope/pkg',
      controller.signal,
    );
    expect(result).toEqual({
      versions: ['1.0.0', '2.0.0'],
      distTags: { latest: '2.0.0' },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://registry.npmjs.org/%40scope%2Fpkg');
    expect(options).toMatchObject({
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      signal: controller.signal,
    });
    const headers = new Headers(options?.headers);
    expect(headers.get('accept')).toBe('application/vnd.npm.install-v1+json');
    expect(headers.has('authorization')).toBe(false);
    expect(headers.has('cookie')).toBe(false);
    expect(options).not.toHaveProperty('dispatcher');
    expect(options).not.toHaveProperty('agent');
  });

  it.each([
    '../secret',
    'https://evil.test/pkg',
    'a/b',
    '@scope',
    '',
    'pkg?x=1',
    'pkg#x',
    'a\\b',
  ])('rejects invalid package name %j before HTTP', async (name) => {
    await expect(
      registry.getPackageMetadata(name, controller.signal),
    ).rejects.toMatchObject({
      code: 'INVALID_REGISTRY_RESPONSE',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('posts only the provided name/version data to the fixed advisory path', async () => {
    fetcher.mockResolvedValue(response({ pkg: [] }));
    await expect(
      registry.getBulkAdvisories({ pkg: ['1.0.0'] }, controller.signal),
    ).resolves.toEqual({ pkg: [] });
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe(
      'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk',
    );
    expect(options).toMatchObject({
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      body: JSON.stringify({ pkg: ['1.0.0'] }),
      signal: controller.signal,
    });
    const headers = new Headers(options?.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.has('authorization')).toBe(false);
    expect(headers.has('cookie')).toBe(false);
  });

  it('returns deprecation markers as data and never fetches package tarball URLs', async () => {
    fetcher.mockResolvedValue(
      response({
        versions: {
          '1.0.0': {
            deprecated: 'Retired',
            dist: { tarball: 'https://evil.test/archive.tgz' },
          },
          '2.0.0': { dist: { tarball: 'file:///private-file' } },
        },
        'dist-tags': { latest: '2.0.0' },
      }),
    );
    const result = await registry.getPackageMetadata('pkg', controller.signal);
    expect(result.deprecatedVersions).toEqual(['1.0.0']);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('https://registry.npmjs.org/pkg');
  });

  it('ignores registry/auth/proxy environment settings when constructing requests', async () => {
    jest.replaceProperty(process, 'env', {
      NPM_CONFIG_REGISTRY: 'https://private.test',
      NPM_CONFIG__AUTH: 'private-token',
      HTTPS_PROXY: 'https://proxy.test',
      NODE_USE_ENV_PROXY: '1',
      YARN_NPM_REGISTRY_SERVER: 'https://private-yarn.test',
    });
    fetcher.mockResolvedValue(metadata());
    await registry.getPackageMetadata('pkg', controller.signal);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://registry.npmjs.org/pkg');
    expect(JSON.stringify(options)).not.toMatch(
      /private-token|private\.test|proxy\.test/,
    );
    expect(new Headers(options?.headers).has('authorization')).toBe(false);
    expect(options).not.toHaveProperty('dispatcher');
    expect(options).not.toHaveProperty('agent');
  });

  it.each([
    [401, 'REGISTRY_AUTH_REQUIRED'],
    [403, 'REGISTRY_AUTH_REQUIRED'],
    [404, 'PACKAGE_NOT_FOUND'],
    [429, 'REGISTRY_RATE_LIMITED'],
    [500, 'REGISTRY_UNAVAILABLE'],
    [503, 'REGISTRY_UNAVAILABLE'],
    [302, 'REGISTRY_UNAVAILABLE'],
  ] as const)(
    'maps metadata HTTP %i to %s without exposing the body or retrying',
    async (status, code) => {
      fetcher.mockResolvedValue(
        response({ secret: 'upstream-private-body' }, status),
      );
      await expect(
        registry.getPackageMetadata('pkg', controller.signal),
      ).rejects.toMatchObject({ code });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it('maps advisory 404 to unavailable rather than package-not-found', async () => {
    fetcher.mockResolvedValue(response({}, 404));
    await expect(
      registry.getBulkAdvisories({ pkg: ['1.0.0'] }, controller.signal),
    ).rejects.toMatchObject({ code: 'REGISTRY_UNAVAILABLE' });
  });

  it.each(['DNS', 'TLS', 'network'])(
    'normalizes %s rejection without its raw text',
    async (kind) => {
      fetcher.mockRejectedValue(new Error(`${kind}: private-token-and-host`));
      const error: unknown = await registry
        .getPackageMetadata('pkg', controller.signal)
        .catch((failure: unknown) => failure);
      expect(error).toMatchObject({ code: 'REGISTRY_UNAVAILABLE' });
      expect(String(error)).not.toContain('private-token-and-host');
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    null,
    [],
    {},
    { versions: [], 'dist-tags': {} },
    { versions: {}, 'dist-tags': [] },
  ])('rejects malformed package schema %j', async (value) => {
    fetcher.mockResolvedValue(response(value));
    await expect(
      registry.getPackageMetadata('pkg', controller.signal),
    ).rejects.toMatchObject({ code: 'INVALID_REGISTRY_RESPONSE' });
  });

  it.each([null, [], { pkg: {} }])(
    'rejects malformed advisory envelope %j',
    async (value) => {
      fetcher.mockResolvedValue(response(value));
      await expect(
        registry.getBulkAdvisories({ pkg: ['1.0.0'] }, controller.signal),
      ).rejects.toMatchObject({ code: 'INVALID_REGISTRY_RESPONSE' });
    },
  );

  it('rejects non-JSON without echoing the response', async () => {
    fetcher.mockResolvedValue(new Response('<html>private-token</html>'));
    const error: unknown = await registry
      .getPackageMetadata('pkg', controller.signal)
      .catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: 'INVALID_REGISTRY_RESPONSE' });
    expect(String(error)).not.toContain('private-token');
  });

  it.each([
    ['metadata', 64],
    ['audit', 16],
  ] as const)(
    'enforces the %s decoded byte cap while streaming before parsing',
    async (kind, mib) => {
      const cancel = jest.fn();
      let sent = false;
      const body = new ReadableStream<Uint8Array>({
        pull(stream) {
          if (sent) return;
          sent = true;
          // No Content-Length: the stream count, not an advertised header, is decisive.
          stream.enqueue(new Uint8Array(mib * 1024 * 1024 + 1).fill(32));
        },
        cancel,
      });
      fetcher.mockResolvedValue(new Response(body));
      const parse = jest.spyOn(JSON, 'parse');
      const task =
        kind === 'metadata'
          ? registry.getPackageMetadata('pkg', controller.signal)
          : registry.getBulkAdvisories({ pkg: ['1.0.0'] }, controller.signal);
      await expect(task).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
      expect(parse).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledTimes(1);
    },
  );

  it('counts UTF-8 bytes rather than decoded characters', async () => {
    fetcher.mockResolvedValue(new Response('é'.repeat(32 * 1024 * 1024 + 1)));
    await expect(
      registry.getPackageMetadata('pkg', controller.signal),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });

  it('accepts metadata as large as the biggest real packages', async () => {
    fetcher.mockResolvedValue(
      new Response(
        JSON.stringify({
          versions: { '1.0.0': {} },
          'dist-tags': { latest: '1.0.0' },
          padding: 'x'.repeat(25 * 1024 * 1024),
        }),
      ),
    );
    await expect(
      registry.getPackageMetadata('pkg', controller.signal),
    ).resolves.toMatchObject({ versions: ['1.0.0'] });
  });

  it('does not fetch after a pre-aborted signal', async () => {
    controller.abort();
    await expect(
      registry.getPackageMetadata('pkg', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('holds four permits until real fetch settlement across cancellation and new work', async () => {
    const old = Array.from({ length: 4 }, () => deferred<Response>());
    old.forEach((pending) =>
      fetcher.mockImplementationOnce(() => pending.promise),
    );
    fetcher.mockResolvedValue(metadata());
    const oldTasks = old.map((_, i) =>
      registry
        .getPackageMetadata(`old-${i}`, controller.signal)
        .catch((e: unknown) => e),
    );
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(4);
    controller.abort();
    const next = registry.getPackageMetadata(
      'next',
      new AbortController().signal,
    );
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(4);
    old[0].reject(new Error('late raw network failure'));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(5);
    await expect(next).resolves.toHaveProperty('distTags.latest', '2.0.0');
    old.slice(1).forEach((pending) => pending.resolve(metadata()));
    await Promise.all(oldTasks);
  });

  it('retains a permit through body streaming, and aborts queued work without fetching it', async () => {
    const bodies = Array.from({ length: 4 }, () => deferred<void>());
    bodies.forEach((pending) =>
      fetcher.mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            async start(stream) {
              await pending.promise;
              stream.enqueue(
                new TextEncoder().encode(
                  JSON.stringify({ versions: {}, 'dist-tags': {} }),
                ),
              );
              stream.close();
            },
          }),
        ),
      ),
    );
    const active = bodies.map((_, i) =>
      registry.getPackageMetadata(`pkg-${i}`, controller.signal),
    );
    await flush();
    const queuedSignal = new AbortController();
    const queued = registry
      .getPackageMetadata('queued', queuedSignal.signal)
      .catch((e: unknown) => e);
    queuedSignal.abort();
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(4);
    bodies.forEach((pending) => pending.resolve());
    await Promise.all(active);
    expect(await queued).toMatchObject({ name: 'AbortError' });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
