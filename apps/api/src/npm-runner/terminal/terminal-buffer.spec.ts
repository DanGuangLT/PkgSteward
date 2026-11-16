import { TerminalOutputBuffer } from './terminal-buffer';

const identity = {
  jobId: '11111111-1111-4111-8111-111111111111',
  generation: 1,
};
const text = (page: ReturnType<TerminalOutputBuffer['read']>) =>
  page.chunks.map((chunk) => chunk.text).join('');

describe('terminal output buffer', () => {
  it('preserves split UTF-8 bytes, split JS surrogates and one merged byte cursor', () => {
    const buffer = new TerminalOutputBuffer(identity);
    const bytes = Buffer.from('A😀ế');
    buffer.append(bytes.subarray(0, 3));
    buffer.append(bytes.subarray(3, 6));
    buffer.append(bytes.subarray(6));
    buffer.append('\ud83d');
    buffer.append('\ude00Z');
    const page = buffer.read(identity, 0);
    expect(text(page)).toBe('A😀ế😀Z');
    expect(page).toMatchObject({
      firstCursor: 0,
      nextCursor: 13,
      endCursor: 13,
      gap: false,
      droppedBytes: 0,
    });
    expect(() => buffer.read(identity, 2)).toThrow();
    expect(text(buffer.read(identity, 5))).toBe('ế😀Z');
  });

  it('bounds each page without breaking a codepoint and returns resumable cursors', () => {
    const buffer = new TerminalOutputBuffer(identity);
    buffer.append('x'.repeat(65535) + '😀tail');
    const first = buffer.read(identity, 0);
    expect(Buffer.byteLength(text(first))).toBe(65535);
    expect(first.nextCursor).toBe(65535);
    expect(text(buffer.read(identity, first.nextCursor))).toBe('😀tail');
    expect(() => buffer.read(identity, 65535, 3)).toThrow();
  });

  it('evicts by UTF-8 bytes and gives explicit gap/parser reset for old cursors', () => {
    const buffer = new TerminalOutputBuffer(identity);
    buffer.append('😀'.repeat(262145));
    const page = buffer.read(identity, 0);
    expect(page).toMatchObject({
      firstCursor: 4,
      endCursor: 1048580,
      gap: true,
      truncated: true,
      parserReset: true,
      droppedBytes: 4,
    });
    expect(Buffer.byteLength(text(page))).toBeLessThanOrEqual(65536);
    expect(text(page)).not.toContain('�');
    let cursor = page.firstCursor;
    let bytes = 0;
    while (cursor < page.endCursor) {
      const next = buffer.read(identity, cursor);
      bytes += Buffer.byteLength(text(next));
      cursor = next.nextCursor;
    }
    expect(bytes).toBe(1048576);
  });

  it('evicts by chunk count even when byte cap is not reached', () => {
    const buffer = new TerminalOutputBuffer(identity);
    for (let index = 0; index < 4097; index++) buffer.append('x');
    const page = buffer.read(identity, 0);
    expect(page.chunks).toHaveLength(4096);
    expect(page).toMatchObject({
      firstCursor: 1,
      endCursor: 4097,
      droppedBytes: 1,
      gap: true,
    });
    expect(buffer.read(identity, 4097)).toMatchObject({
      chunks: [],
      nextCursor: 4097,
    });
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 9])(
    'refuses invalid/future cursor %s',
    (cursor) => {
      expect(() =>
        new TerminalOutputBuffer(identity).read(identity, cursor),
      ).toThrow();
    },
  );

  it('rejects foreign job/generation and unsafe page sizes', () => {
    const buffer = new TerminalOutputBuffer(identity);
    expect(() => buffer.read({ ...identity, generation: 2 }, 0)).toThrow();
    for (const size of [0, -1, 65537, 1.5, NaN])
      expect(() => buffer.read(identity, 0, size)).toThrow();
  });

  it('flushes incomplete UTF-8 at finish without allowing later append', () => {
    const buffer = new TerminalOutputBuffer(identity);
    buffer.append(Uint8Array.from([0xf0, 0x9f]));
    expect(text(buffer.read(identity, 0))).toBe('');
    buffer.finish();
    expect(text(buffer.read(identity, 0))).toBe('�');
    buffer.finish();
    expect(() => buffer.append('x')).toThrow();
  });

  it('treats empty producer fragments as no-ops while Unicode is incomplete', () => {
    const buffer = new TerminalOutputBuffer(identity);
    buffer.append(Uint8Array.from([0xf0, 0x9f]));
    buffer.append('');
    buffer.append(Uint8Array.from([0x98, 0x80]));
    buffer.append('\ud83d');
    buffer.append(new Uint8Array());
    buffer.append('\ude00');
    expect(text(buffer.read(identity, 0))).toBe('😀😀');
  });
});
