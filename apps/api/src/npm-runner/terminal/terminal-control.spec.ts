import { TerminalControl } from './terminal-control';
import type { ITerminalWriter } from './terminal-control';
import type { TerminalDeliveryStatus } from './terminal-protocol';

const identity = {
  jobId: '11111111-1111-4111-8111-111111111111',
  generation: 1,
};
const tab = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
function fixture() {
  let count = 0;
  const writes: string[] = [];
  const sizes: { cols: number; rows: number }[] = [];
  const deps = {
    now: () => 1000,
    token: () =>
      `${String(++count).padStart(8, '0')}-0000-4000-8000-000000000000`,
    write: jest.fn(
      (request: { text: string }): Promise<TerminalDeliveryStatus> => {
        writes.push(request.text);
        return Promise.resolve('delivered');
      },
    ),
    resize: jest.fn((size: { cols: number; rows: number }) => {
      sizes.push(size);
      return Promise.resolve();
    }),
  };
  const control = new TerminalControl(identity, deps);
  const writer = control.claim(identity, tab);
  const request = (sequence = 1, input = 'y\r', owner = writer) => ({
    ...identity,
    ...owner,
    sequence,
    text: input,
  });
  return { control, deps, writes, sizes, writer, request };
}

describe('terminal single writer/input control', () => {
  it('claims once, refuses competing claim and explicitly transfers to a fresh writer', async () => {
    const { control, writer, request } = fixture();
    expect(control.claim(identity, tab)).toEqual(writer);
    expect(() => control.claim(identity, other)).toThrow();
    const replacement = control.claim(identity, other, true);
    expect(replacement.writerGeneration).toBe(2);
    expect(replacement.token).not.toBe(writer.token);
    await expect(control.input(request())).rejects.toThrow();
    expect(await control.input(request(1, 'new', replacement))).toMatchObject({
      status: 'delivered',
      writerGeneration: 2,
    });
  });

  it('reserves before write, deduplicates concurrent retries and rejects gaps/hash conflicts', async () => {
    const { control, deps, writes, writer, request } = fixture();
    let finish!: (status: 'delivered') => void;
    deps.write.mockImplementationOnce((value) => {
      writes.push(value.text);
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const first = control.input(request());
    expect(control.ack(identity, writer, 1).status).toBe('pending');
    expect(await control.input(request())).toMatchObject({ status: 'pending' });
    await expect(control.input(request(1, 'n\r'))).rejects.toThrow();
    await expect(control.input(request(2))).rejects.toThrow();
    finish('delivered');
    expect(await first).toMatchObject({
      status: 'delivered',
      receivedAt: 1000,
    });
    expect(await control.input(request())).toMatchObject({
      status: 'delivered',
    });
    expect(writes).toEqual(['y\r']);
    await expect(control.input(request(3))).rejects.toThrow();
    expect(await control.input(request(2, '\u0003'))).toMatchObject({
      status: 'delivered',
    });
  });

  it.each([false, true])(
    'never replays a throwing write (adapter accepted=%s)',
    async (accepted) => {
      const { control, deps, writes, writer, request } = fixture();
      deps.write.mockImplementationOnce((value) => {
        if (accepted) {
          writes.push(value.text);
          return Promise.reject(new Error('adapter ack unavailable'));
        }
        throw new Error('adapter ack unavailable');
      });
      expect(await control.input(request())).toMatchObject({
        status: 'unknown',
      });
      expect(await control.input(request())).toMatchObject({
        status: 'unknown',
      });
      expect(writes).toEqual(accepted ? ['y\r'] : []);
      await expect(control.input(request(2))).rejects.toThrow();
      expect(() => control.claim(identity, other, true)).toThrow();
      control.reconcile(
        identity,
        writer.writerGeneration,
        1,
        accepted ? 'delivered' : 'not_delivered',
      );
      expect(control.ack(identity, writer, 1).status).toBe(
        accepted ? 'delivered' : 'not_delivered',
      );
      expect(await control.input(request(2, 'next'))).toMatchObject({
        status: 'delivered',
      });
    },
  );

  it('unknown adapter receipt blocks writes and late completion cannot undo reconciliation', async () => {
    const { control, deps, writer, request } = fixture();
    let finish!: (status: 'delivered') => void;
    deps.write.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const inflight = control.input(request());
    control.reconcile(identity, writer.writerGeneration, 1, 'not_delivered');
    finish('delivered');
    expect(await inflight).toMatchObject({ status: 'not_delivered' });
    expect(control.ack(identity, writer, 1).status).toBe('not_delivered');
  });

  it('blocks an explicit unknown ack until trusted reconciliation, without replaying', async () => {
    const { control, deps, writer, request } = fixture();
    deps.write.mockResolvedValueOnce('unknown');
    expect(await control.input(request())).toMatchObject({ status: 'unknown' });
    expect(() =>
      control.resize({ ...identity, ...writer, cols: 80, rows: 24 }),
    ).toThrow();
    await expect(control.input(request(2))).rejects.toThrow();
    control.reconcile(identity, writer.writerGeneration, 1, 'delivered');
    expect(() =>
      control.reconcile(identity, writer.writerGeneration, 1, 'not_delivered'),
    ).toThrow();
    expect(await control.input(request(2))).toMatchObject({
      status: 'delivered',
    });
    expect(deps.write).toHaveBeenCalledTimes(2);
  });

  it('consumes a conclusively undelivered sequence and returns its receipt on retry', async () => {
    const { control, deps, request } = fixture();
    deps.write.mockResolvedValueOnce('not_delivered');
    expect(await control.input(request())).toMatchObject({
      status: 'not_delivered',
    });
    expect(await control.input(request())).toMatchObject({
      status: 'not_delivered',
    });
    expect(await control.input(request(2))).toMatchObject({
      status: 'delivered',
    });
    expect(deps.write).toHaveBeenCalledTimes(2);
  });

  it('marks in-flight delivery unknown on worker loss despite a late successful write', async () => {
    const { control, deps, writer, request } = fixture();
    let finish!: (status: 'delivered') => void;
    deps.write.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const inflight = control.input(request());
    control.setState('worker_lost');
    expect(control.ack(identity, writer, 1)).toMatchObject({
      status: 'unknown',
    });
    finish('delivered');
    expect(await inflight).toMatchObject({ status: 'unknown' });
    await expect(control.input(request(2))).rejects.toThrow();
  });

  it('isolates caller mutations of writer and receipt snapshots', async () => {
    const { control, writer, request } = fixture();
    const response = await control.input(request());
    response.status = 'unknown';
    const copied = control.claim(identity, tab);
    copied.token = other;
    expect(control.ack(identity, writer, 1).status).toBe('delivered');
    expect(control.claim(identity, tab).token).toBe(writer.token);
    expect(() =>
      control.ack({ ...identity, generation: 2 }, writer, 1),
    ).toThrow();
    expect(() => control.reconcile(identity, 2, 1, 'delivered')).toThrow();
  });

  it.each(['stopping', 'terminal', 'worker_lost'] as const)(
    'rejects writes after %s but keeps safe ack queries',
    async (state) => {
      const { control, writer, request, writes } = fixture();
      await control.input(request());
      control.setState(state);
      await expect(control.input(request(2))).rejects.toThrow();
      expect(() => control.claim(identity, other, true)).toThrow();
      expect(() =>
        control.resize({ ...identity, ...writer, cols: 80, rows: 24 }),
      ).toThrow();
      expect(control.ack(identity, writer, 1).status).toBe('delivered');
      expect(writes).toEqual(['y\r']);
      expect(() => control.setState('running')).toThrow();
    },
  );

  it('validates identity, writer, bounded UTF-8 text and sequences before dispatch', async () => {
    const { control, request, writes } = fixture();
    for (const invalid of [
      { ...request(), generation: 2 },
      { ...request(), token: other },
      { ...request(), jobId: other },
      { ...request(), sequence: 0 },
      { ...request(), sequence: Number.MAX_SAFE_INTEGER + 1 },
      request(1, '😀'.repeat(1025)),
      request(1, ''),
    ])
      await expect(control.input(invalid)).rejects.toThrow();
    expect(writes).toEqual([]);
    expect(await control.input(request(1, '😀'.repeat(1024)))).toMatchObject({
      status: 'delivered',
    });
  });

  it('coalesces resize and rejects stale queued ownership after takeover', async () => {
    const { control, writer, sizes } = fixture();
    const resize = (
      cols: number,
      rows: number,
      owner: ITerminalWriter = writer,
    ) => ({ ...identity, ...owner, cols, rows });
    for (const pair of [
      [1, 24],
      [501, 24],
      [80, 0],
      [80, 301],
      [80.5, 24],
    ])
      expect(() => control.resize(resize(pair[0], pair[1]))).toThrow();
    control.resize(resize(80, 24));
    control.resize(resize(100, 30));
    await control.flushResize();
    expect(sizes).toEqual([{ cols: 100, rows: 30 }]);
    control.resize(resize(120, 40));
    const next = control.claim(identity, other, true);
    await control.flushResize();
    expect(sizes).toEqual([{ cols: 100, rows: 30 }]);
    expect(() => control.resize(resize(120, 40))).toThrow();
    control.resize(resize(2, 1, next));
    await control.flushResize();
    expect(sizes.at(-1)).toEqual({ cols: 2, rows: 1 });
  });

  it('flushes a resize queued immediately after an empty flush', async () => {
    const { control, writer, sizes } = fixture();
    const empty = control.flushResize();
    control.resize({ ...identity, ...writer, cols: 90, rows: 25 });
    await control.flushResize();
    await empty;
    expect(sizes).toEqual([{ cols: 90, rows: 25 }]);
  });

  it('caps receipt metadata and requires explicit generation transfer after capacity', async () => {
    const { control, request, writer } = fixture();
    for (let sequence = 1; sequence <= 4096; sequence++)
      await control.input(request(sequence, 'x'));
    await expect(control.input(request(4097))).rejects.toThrow();
    expect(await control.input(request(1, 'x'))).toMatchObject({
      status: 'delivered',
    });
    const next = control.claim(identity, tab, true);
    expect(next.writerGeneration).toBe(writer.writerGeneration + 1);
    expect(await control.input(request(1, 'x', next))).toMatchObject({
      status: 'delivered',
    });
    expect(() => control.ack(identity, next, 2)).toThrow();
  });
});
