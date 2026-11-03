import { createRunLogStore } from '@/npm-runner/runner-logs';
import type { IRunClock, IRunLogStore } from '@/npm-runner/runner-logs';

class TestClock implements IRunClock {
  time = 0;
  nextId = 0;
  pending = new Map<number, { at: number; callback: () => void }>();
  now = (): number => this.time;
  setTimeout = (callback: () => void, delayMs: number): number => {
    const id = this.nextId++;
    this.pending.set(id, { at: this.time + delayMs, callback });
    return id;
  };
  clearTimeout = (handle: unknown): void => {
    if (typeof handle === 'number') this.pending.delete(handle);
  };
  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      const next = [...this.pending.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      this.time = next[1].at;
      this.pending.delete(next[0]);
      next[1].callback();
    }
    this.time = end;
  }
}

const pageText = (store: IRunLogStore, cursor = store.firstCursor): string => {
  let result = '';
  let page = store.snapshot(cursor);
  const end = page.endCursor;
  while (page.chunks.length > 0) {
    result += page.chunks.map((chunk) => chunk.text).join('');
    if (page.nextCursor >= end) break;
    page = store.snapshot(page.nextCursor);
  }
  return result;
};

describe('createRunLogStore', () => {
  let clock: TestClock;
  let store: IRunLogStore;

  beforeEach(() => {
    clock = new TestClock();
    store = createRunLogStore({ jobId: 'test-job', clock });
  });

  it('starts at cursor zero and always warns that logs may contain secrets', () => {
    expect(store.snapshot(0)).toEqual({
      jobId: 'test-job',
      firstCursor: 0,
      nextCursor: 0,
      endCursor: 0,
      truncated: false,
      droppedBytes: 0,
      chunks: [],
    });
    expect(store.retainedBytes).toBe(0);
    expect(store.retainedChunks).toBe(0);
    expect(store.warningCodes).toContain('LOGS_MAY_CONTAIN_SECRETS');
  });

  it('flushes partial lines at 250ms using only the injected timer', () => {
    const timeoutSpy = jest.spyOn(global, 'setTimeout');
    const intervalSpy = jest.spyOn(global, 'setInterval');
    try {
      store.append('stdout', Buffer.from('working'));
      expect(store.snapshot(0).chunks).toEqual([]);
      clock.advance(249);
      expect(store.snapshot(0).chunks).toEqual([]);
      clock.advance(1);
      expect(pageText(store)).toBe('working');
      expect(timeoutSpy).not.toHaveBeenCalled();
      expect(intervalSpy).not.toHaveBeenCalled();
    } finally {
      timeoutSpy.mockRestore();
      intervalSpy.mockRestore();
    }
  });

  it('publishes complete lines immediately and keeps reception order across streams', () => {
    store.append('stderr', Buffer.from('err\n'));
    store.append('stdout', Buffer.from('out\n'));
    expect(store.snapshot(0).chunks).toEqual([
      { seq: 0, stream: 'stderr', text: 'err\n' },
      { seq: 1, stream: 'stdout', text: 'out\n' },
    ]);
    expect(store.endCursor).toBe(2);
  });

  it('decodes Vietnamese and emoji incrementally with independent stream state', () => {
    const text = Buffer.from('Tiếng Việt 🙂\n');
    for (const byte of text) {
      store.append('stdout', Buffer.from([byte]));
      store.append('stderr', Buffer.from('.'));
    }
    store.flush(true);
    const chunks = store.snapshot(0).chunks;
    expect(
      chunks
        .filter((chunk) => chunk.stream === 'stdout')
        .map((c) => c.text)
        .join(''),
    ).toBe('Tiếng Việt 🙂\n');
    expect(
      chunks
        .filter((chunk) => chunk.stream === 'stderr')
        .map((c) => c.text)
        .join(''),
    ).toBe('.'.repeat(text.length));
    expect(store.warningCodes).not.toContain('OUTPUT_ENCODING_LOSS');
  });

  it('keeps an incomplete codepoint through ordinary flush and timer flush', () => {
    const emoji = Buffer.from('🙂');
    store.append('stdout', emoji.subarray(0, 2));
    store.flush();
    clock.advance(250);
    expect(pageText(store)).toBe('');
    store.append('stdout', emoji.subarray(2));
    store.flush(true);
    expect(pageText(store)).toBe('🙂');
    expect(store.warningCodes).not.toContain('OUTPUT_ENCODING_LOSS');
  });

  it.each([Buffer.from([0xff, 0x0a]), Buffer.from([0xe2, 0x82])])(
    'reports malformed/truncated UTF-8 without heuristic transcoding',
    (bytes) => {
      store.append('stdout', bytes);
      store.flush(true);
      expect(pageText(store)).toContain('\ufffd');
      expect(store.warningCodes).toContain('OUTPUT_ENCODING_LOSS');
    },
  );

  it('strips split CSI and OSC hyperlink/clipboard sequences before retention', () => {
    for (const part of [
      'ok\x1b[3',
      '1mred\x1b[0',
      'm\x1b]8;;https://hidden.example',
      '\x1b',
      '\\link\x1b]8;;\x07\x1b]52;c;PRIVATE_',
      'CLIPBOARD\x07end\n',
    ])
      store.append('stdout', Buffer.from(part));
    expect(pageText(store)).toBe('okredlinkend\n');
    expect(JSON.stringify(store.snapshot(0))).not.toMatch(
      /PRIVATE_|hidden\.example/,
    );
    expect(pageText(store)).not.toContain('\x1b');
  });

  it('caps an unterminated escape at 4096 bytes, warns, and resumes after terminator', () => {
    store.append(
      'stdout',
      Buffer.from('\x1b]52;c;' + 'x'.repeat(2 * 1024 * 1024)),
    );
    clock.advance(250);
    expect(store.retainedBytes).toBe(0);
    store.append('stdout', Buffer.from('\x07visible\n'));
    expect(pageText(store)).toBe('visible\n');
    expect(store.warningCodes).toContain('OUTPUT_TRUNCATED');
  });

  it('normalizes CR and removes C0, C1 and bidi controls without terminal emulation', () => {
    store.append(
      'stdout',
      Buffer.from('one\rtwo\tX\bY\0\x01\x7f\u0085\u009b\u202e\u2066Z\n'),
    );
    expect(pageText(store)).toBe('one\ntwo\tXYZ\n');
  });

  it.each([
    ['//registry.npmjs.org/:_authToken=', 'PRIVATE_TOKEN'],
    ['_password=', 'PRIVATE_PASSWORD'],
    ['Authorization: Bearer ', 'PRIVATE_BEARER'],
    ['Authorization: Basic ', 'UFJJVkFURQ=='],
    ['token=', 'PRIVATE_TOKEN'],
    ['password: ', 'PRIVATE_PASSWORD'],
    ['https://user:', 'PRIVATE_PASSWORD@registry.example/path'],
  ])(
    'redacts known secret patterns split over chunks (%s)',
    (prefix, secret) => {
      const line = `${prefix}${secret}\n`;
      for (let offset = 0; offset < line.length; offset += 3)
        store.append('stdout', Buffer.from(line.slice(offset, offset + 3)));
      store.flush(true);
      const retained = JSON.stringify(store.snapshot(0));
      expect(retained).not.toContain(secret);
      expect(pageText(store)).not.toContain('PRIVATE_');
      expect(pageText(store)).not.toContain('UFJJVkFURQ==');
      expect(store.retainedBytes).toBe(Buffer.byteLength(pageText(store)));
    },
  );

  it('redacts before eviction accounting and never retains a known raw secret', () => {
    store.append('stderr', Buffer.from('token=PRIVATE_SECRET\n'));
    const safe = pageText(store);
    expect(safe).not.toContain('PRIVATE_SECRET');
    expect(store.retainedBytes).toBe(Buffer.byteLength(safe));
    expect(store.droppedBytes).toBe(0);
  });

  it('splits huge newline-free writes at UTF-8 boundaries and bounds the unread ring', () => {
    store.append('stdout', Buffer.from('🙂'.repeat(600_000)));
    store.flush(true);
    expect(store.retainedBytes).toBeLessThanOrEqual(1_048_576);
    expect(store.retainedChunks).toBeLessThanOrEqual(4096);
    expect(store.droppedBytes + store.retainedBytes).toBe(2_400_000);
    expect(store.warningCodes).toContain('OUTPUT_TRUNCATED');
    let cursor = store.firstCursor;
    while (cursor < store.endCursor) {
      const page = store.snapshot(cursor);
      for (const chunk of page.chunks) {
        expect(Buffer.byteLength(chunk.text)).toBeLessThanOrEqual(8192);
        expect(chunk.text).not.toContain('\ufffd');
      }
      expect(page.nextCursor).toBeGreaterThan(cursor);
      cursor = page.nextCursor;
    }
  });

  it('evicts oldest chunks at the independent 4096-chunk cap', () => {
    for (let index = 0; index < 4100; index++) {
      store.append('stdout', Buffer.from('x'));
      store.flush();
    }
    expect(store.retainedChunks).toBe(4096);
    expect(store.retainedBytes).toBe(4096);
    expect(store.droppedBytes).toBe(4);
    expect(store.firstCursor).toBe(4);
    const page = store.snapshot(0);
    expect(page.truncated).toBe(true);
    expect(page.chunks[0].seq).toBe(4);
    expect(page.firstCursor).toBe(4);
    expect(page.endCursor).toBe(4100);
    expect(page.droppedBytes).toBe(4);
  });

  it('pages at 256 chunks with nextCursor pointing after the last emitted chunk', () => {
    for (let index = 0; index < 300; index++) {
      store.append('stdout', Buffer.from(`${index}\n`));
    }
    const first = store.snapshot(0);
    expect(first.chunks).toHaveLength(256);
    expect(first.nextCursor).toBe(256);
    expect(first.endCursor).toBe(300);
    const second = store.snapshot(first.nextCursor);
    expect(second.chunks).toHaveLength(44);
    expect(second.chunks[0].seq).toBe(256);
    expect(second.nextCursor).toBe(300);
    expect(second.truncated).toBe(false);
    expect(store.snapshot(300).nextCursor).toBe(300);
  });

  it('limits each page to 65536 UTF-8 bytes as well as 256 chunks', () => {
    for (let index = 0; index < 32; index++) {
      store.append('stdout', Buffer.from('ệ'.repeat(2000)));
      store.flush();
    }
    const first = store.snapshot(0);
    expect(first.chunks.length).toBeGreaterThan(0);
    expect(
      first.chunks.reduce(
        (sum, chunk) => sum + Buffer.byteLength(chunk.text),
        0,
      ),
    ).toBeLessThanOrEqual(65536);
    expect(first.nextCursor).toBeLessThan(first.endCursor);
    expect(store.snapshot(first.nextCursor).chunks[0].seq).toBe(
      first.nextCursor,
    );
  });

  it('freezes a returned snapshot while subsequent append advances the store', () => {
    store.append('stdout', Buffer.from('first\n'));
    const before = store.snapshot(0);
    store.append('stdout', Buffer.from('second\n'));
    expect(before.endCursor).toBe(1);
    expect(before.chunks).toHaveLength(1);
    expect(store.snapshot(before.nextCursor).chunks).toEqual([
      { seq: 1, stream: 'stdout', text: 'second\n' },
    ]);
    before.chunks[0].text = 'caller mutation';
    expect(pageText(store)).toBe('first\nsecond\n');
  });

  it('final flush is idempotent and cancels pending partial-line timers', () => {
    store.append('stdout', Buffer.from('tail'));
    store.flush(true);
    const page = store.snapshot(0);
    store.flush(true);
    clock.advance(1000);
    expect(store.snapshot(0)).toEqual(page);
    expect(clock.pending.size).toBe(0);
  });
});
