import {
  PmPreviewStore,
  createPmPreview,
  assertPmPreviewUnchanged,
} from '@/package-managers/pinning/pm-preview';
import {
  pmLifecycleFixture,
  pmUuid,
} from '@/package-managers/__fixtures__/pm-lifecycle.fixture';
import { root } from '@/npm-runner/__fixtures__/runner-test.fixture';
import { readPmProject } from '@/package-managers/discovery/pm-project';

// Expected RED: module absent; private snapshot isolation, TTL, budget, replay consumption, comparison.
describe('M9 private preview store', () => {
  const setup = async () => {
    const f = pmLifecycleFixture();
    const facts = await readPmProject(
      root,
      f.runtime.projectDeps(new AbortController().signal),
    );
    const catalog = await f.runtime.registry.readCatalog(
      'npm',
      '11.17.0',
      new AbortController().signal,
    );
    const proof = f.runtime.registry.resolveTarget(
      catalog,
      'latest',
      '11.17.0',
    );
    const request = {
      requestId: pmUuid(1),
      path: root,
      manager: 'npm' as const,
      targetVersion: 'latest',
    };
    const built = createPmPreview(
      pmUuid(2),
      request,
      facts,
      proof,
      f.runtime.now(),
    );
    const store = new PmPreviewStore(f.runtime);
    return { f, facts, proof, built, store };
  };
  it('isolates public/private bytes, starts TTL at ready, consumes once', async () => {
    const { f, facts, proof, built, store } = await setup();
    const publicValue = store.put(built.preview, facts, proof, built.edit);
    facts.bytes.fill(0);
    publicValue.warnings.length = 0;
    const record = store.get(publicValue.previewId);
    expect(record.facts.bytes[0]).toBe(123);
    record.facts.bytes.fill(0);
    expect(store.get(publicValue.previewId).facts.bytes[0]).toBe(123);
    f.advance(299_999);
    store.consume(publicValue.previewId);
    expect(() => store.get(publicValue.previewId)).toThrow(
      expect.objectContaining({ details: { reason: 'PREVIEW_CONSUMED' } }),
    );
    store.assertFresh(publicValue.previewId);
    f.advance(1);
    expect(() => store.assertFresh(publicValue.previewId)).toThrow(
      expect.objectContaining({ details: { reason: 'PREVIEW_EXPIRED' } }),
    );
  });
  it('bounds private bytes and evicts the oldest of 16', async () => {
    const { facts, proof, built, store } = await setup();
    expect(() =>
      store.put(
        built.preview,
        { ...facts, bytes: Buffer.alloc(262_145) },
        proof,
        built.edit,
      ),
    ).toThrow(
      expect.objectContaining({ details: { reason: 'LIMIT_EXCEEDED' } }),
    );
    for (let i = 0; i < 17; i++)
      store.put(
        { ...built.preview, previewId: pmUuid(20 + i) },
        facts,
        proof,
        built.edit,
      );
    expect(() => store.get(pmUuid(20))).toThrow(
      expect.objectContaining({ statusCode: 404 }),
    );
  });
  it('rejects tag, scan, input/config/tool and increased risk changes', async () => {
    const { f, facts, proof, built } = await setup();
    assertPmPreviewUnchanged(
      built.preview,
      facts,
      proof,
      facts,
      proof,
      f.runtime.now(),
    );
    for (const changed of [
      { ...facts, inputHash: 'changed-tool-config' },
      {
        ...facts,
        identities: facts.identities.map((item) =>
          item.stat.isDirectory?.()
            ? { ...item, stat: { ...item.stat, ino: 999 } }
            : item,
        ),
      },
      { ...facts, context: { ...facts.context, scanId: 'new' } },
      { ...facts, lastActivityAt: f.runtime.now().toISOString() },
    ])
      expect(() =>
        assertPmPreviewUnchanged(
          { ...built.preview, risk: { level: 'low', reasons: [] } },
          facts,
          proof,
          changed,
          proof,
          f.runtime.now(),
        ),
      ).toThrow();
    expect(() =>
      assertPmPreviewUnchanged(
        built.preview,
        facts,
        proof,
        facts,
        { ...proof, fingerprint: 'moved' },
        f.runtime.now(),
      ),
    ).toThrow();
  });
});
