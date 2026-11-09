import { PmRegistry } from '@/package-managers/pm-registry';
import { ProjectRegistry } from '@/projects/project-registry';
import type { IRegistryPackageMetadata } from '@/projects/interfaces/projects.runtime';
import type { PmManager } from '@/package-managers/interfaces/pm.types';

const metadata = (): IRegistryPackageMetadata => ({
  versions: ['11.0.0', '11.1.0', '10.0.0', '12.0.0-beta.1'],
  distTags: { latest: '11.1.0' },
  deprecatedVersions: ['11.0.0'],
});
const setup = () => {
  const getPackageMetadata = jest.fn((name: string, signal: AbortSignal) => {
    void name;
    void signal;
    return Promise.resolve(metadata());
  });
  const registry = new PmRegistry(
    { getPackageMetadata },
    () => new Date('2026-11-09T00:00:00Z'),
  );
  const controller = new AbortController();
  return {
    getPackageMetadata,
    registry,
    controller,
    read: (manager: PmManager = 'npm') =>
      registry.readCatalog(manager, '11.17.0', controller.signal),
  };
};
describe('M9 public declaration catalog', () => {
  it('inherits fixed public origin, omitted credentials and redirect refusal without config probes', async () => {
    const fetcher = jest.fn((url: string, options: RequestInit) => {
      void url;
      void options;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            versions: { '11.1.0': {} },
            'dist-tags': { latest: '11.1.0' },
          }),
        ),
      );
    });
    const registry = new PmRegistry(
      new ProjectRegistry(fetcher as typeof fetch),
    );
    const signal = new AbortController().signal;
    await registry.readCatalog('npm', '11.17.0', signal);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('https://registry.npmjs.org/npm');
    expect(fetcher.mock.calls[0][1]).toEqual({
      method: 'GET',
      headers: { Accept: 'application/vnd.npm.install-v1+json' },
      redirect: 'error',
      credentials: 'omit',
      signal,
    });
  });
  it.each(['npm', 'pnpm', 'yarn'] as const)(
    'passes only fixed %s and the signal to the existing registry port',
    async (manager) => {
      const f = setup();
      const catalog = await f.read(manager);
      expect(f.getPackageMetadata).toHaveBeenCalledWith(
        manager,
        f.controller.signal,
      );
      expect(catalog.versions.map((item) => item.version)).toEqual([
        '12.0.0-beta.1',
        '11.1.0',
        '11.0.0',
        '10.0.0',
      ]);
      expect(
        catalog.versions.find((item) => item.version === '11.0.0')?.deprecated,
      ).toBe(true);
      if (manager === 'yarn')
        expect(catalog.versions.every((item) => !item.supported)).toBe(true);
      expect(catalog.stale).toBe(false);
    },
  );
  it('refuses arbitrary/private names before fetching', async () => {
    const f = setup();
    await expect(f.read('@TEST/private' as PmManager)).rejects.toThrow();
    expect(f.getPackageMetadata).not.toHaveBeenCalled();
  });
  it.each([
    ['REGISTRY_AUTH_REQUIRED', 'REGISTRY_AUTH_REQUIRED'],
    ['PACKAGE_NOT_FOUND', 'REGISTRY_NOT_FOUND'],
    ['REGISTRY_RATE_LIMITED', 'REGISTRY_RATE_LIMITED'],
    ['INVALID_REGISTRY_RESPONSE', 'REGISTRY_INVALID_RESPONSE'],
    ['LIMIT_EXCEEDED', 'LIMIT_EXCEEDED'],
    ['REGISTRY_UNAVAILABLE', 'REGISTRY_UNAVAILABLE'],
  ])(
    'maps %s into bounded %s without retry or stale proof',
    async (code, reason) => {
      const f = setup();
      f.getPackageMetadata.mockRejectedValueOnce(
        Object.assign(new Error('TEST credential must not escape'), { code }),
      );
      await expect(f.read()).rejects.toMatchObject({
        statusCode: 503,
        details: { reason },
      });
      expect(f.getPackageMetadata).toHaveBeenCalledTimes(1);
    },
  );
  it('maps offline errors without exposing their message', async () => {
    const f = setup();
    f.getPackageMetadata.mockRejectedValueOnce(
      new Error('TEST private detail'),
    );
    await expect(f.read()).rejects.toMatchObject({
      message: 'Public package manager catalog unavailable',
      details: { reason: 'REGISTRY_UNAVAILABLE' },
    });
  });
  it.each([
    { versions: ['v11.1.0'], distTags: {} },
    { versions: ['11.1.0', '11.1.0'], distTags: {} },
    { versions: ['11.1.0'], distTags: { latest: '11.2.0' } },
    { versions: ['11.1.0'], distTags: {}, deprecatedVersions: ['11.2.0'] },
    { versions: ['11.1.0'], distTags: { 'bad\n': '11.1.0' } },
  ])('refuses malformed projected metadata %p', async (value) => {
    const f = setup();
    f.getPackageMetadata.mockResolvedValueOnce(
      value as IRegistryPackageMetadata,
    );
    await expect(f.read()).rejects.toMatchObject({
      details: { reason: 'REGISTRY_INVALID_RESPONSE' },
    });
  });
  it.each(['versions', 'tags', 'deprecations'])(
    'enforces the 10k %s bound',
    async (part) => {
      const f = setup();
      const value = metadata();
      if (part === 'versions')
        value.versions = Array.from({ length: 10_001 }, (_, i) => `11.0.${i}`);
      if (part === 'tags')
        value.distTags = Object.fromEntries(
          Array.from({ length: 10_001 }, (_, i) => [`tag-${i}`, '11.1.0']),
        );
      if (part === 'deprecations')
        value.deprecatedVersions = Array<string>(10_001).fill('11.1.0');
      f.getPackageMetadata.mockResolvedValueOnce(value);
      await expect(f.read()).rejects.toMatchObject({
        details: { reason: 'LIMIT_EXCEEDED' },
      });
    },
  );
  it('proves exact/tag targets and fingerprints relevant facts only', async () => {
    const f = setup();
    const catalog = await f.read();
    const proof = f.registry.resolveTarget(catalog, 'latest', '11.17.0');
    expect(proof.targetVersion).toBe('11.1.0');
    f.getPackageMetadata.mockResolvedValueOnce({
      ...metadata(),
      versions: [...metadata().versions, '11.9.0'],
    });
    expect(
      f.registry.resolveTarget(await f.read(), 'latest', '11.17.0').fingerprint,
    ).toBe(proof.fingerprint);
    f.getPackageMetadata.mockResolvedValueOnce({
      ...metadata(),
      distTags: { latest: '10.0.0' },
    });
    expect(() =>
      f.registry.resolveTarget(catalog, '11.0.0', '11.17.0'),
    ).toThrow();
    expect(() =>
      f.registry.resolveTarget(catalog, '12.0.0-beta.1', '11.17.0'),
    ).toThrow();
    expect(() =>
      f.registry.resolveTarget(
        { ...catalog, stale: true },
        'latest',
        '11.17.0',
      ),
    ).toThrow();
  });
  it('detects moved tags with a different exact target proof', async () => {
    const f = setup();
    const first = f.registry.resolveTarget(await f.read(), 'latest', '11.17.0');
    f.getPackageMetadata.mockResolvedValueOnce({
      versions: ['11.1.0', '11.2.0'],
      distTags: { latest: '11.2.0' },
    });
    const second = f.registry.resolveTarget(
      await f.read(),
      'latest',
      '11.17.0',
    );
    expect(second.fingerprint).not.toBe(first.fingerprint);
  });
  it('honors abort before fetch and after a pending fetch has settled', async () => {
    const f = setup();
    f.controller.abort();
    await expect(f.read()).rejects.toThrow();
    expect(f.getPackageMetadata).not.toHaveBeenCalled();
    const g = setup();
    let settle!: (value: IRegistryPackageMetadata) => void;
    g.getPackageMetadata.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const pending = g.read();
    let done = false;
    const outcome = pending.catch(() => {
      done = true;
    });
    g.controller.abort();
    await Promise.resolve();
    expect(done).toBe(false);
    settle(metadata());
    await outcome;
    expect(done).toBe(true);
  });
});
