import { planPinEdit } from '@/package-managers/pinning/pm-manifest';
import { MANIFEST_EDITS } from '@/package-managers/__fixtures__/manifests';

const target = 'npm@11.17.0';
const parse = (bytes: Buffer): Record<string, unknown> =>
  JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')) as Record<
    string,
    unknown
  >;

describe('format-preserving project pin plan', () => {
  describe.each(['npm@11.17.0', 'npm@12.2.2'])(
    'byte-preserving editor for %s',
    (target) => {
      it.each(MANIFEST_EDITS)(
        'changes exactly the expected bytes: $name',
        ({ before, after }) => {
          const original = Buffer.from(before);
          const snapshot = Buffer.from(original);
          const edit = planPinEdit(original, target);
          const expected = after.replaceAll('npm@11.17.0', target);
          expect(edit.bytes.equals(Buffer.from(expected))).toBe(true);
          expect(original.equals(snapshot)).toBe(true);
          expect(
            Buffer.concat([
              original.subarray(0, edit.start),
              edit.replacement,
              original.subarray(edit.end),
            ]).equals(edit.bytes),
          ).toBe(true);
          const old = parse(original);
          const changed = parse(edit.bytes);
          expect(changed.packageManager).toBe(target);
          delete old.packageManager;
          delete changed.packageManager;
          expect(changed).toEqual(old);
          expect(edit.summary).toMatchObject({
            file: 'package.json',
            field: 'packageManager',
            after: target,
          });
        },
      );
    },
  );
  it('never mistakes nested or textual packageManager for the root field', () => {
    const before =
      '{"x":"packageManager", "nested":{"packageManager":false},"packageManager":"pnpm@11.1.0"}';
    expect(planPinEdit(Buffer.from(before), target).bytes.toString()).toBe(
      before.replace('"pnpm@11.1.0"', '"npm@11.17.0"'),
    );
  });
  it('handles escaped quotes and backslashes without mistaking string content for structure', () => {
    const other = 'TEST quote " slash \\ braces { } brackets [ ]';
    const before = JSON.stringify({ other, packageManager: 'npm@11.16.0' });
    const after = JSON.stringify({ other, packageManager: target });
    expect(
      planPinEdit(Buffer.from(before), target).bytes.equals(Buffer.from(after)),
    ).toBe(true);
  });
  it('preserves existing indentation and EOL while replacing with a hash-free target', () => {
    const old = `pnpm@11.1.0+sha512.${'a'.repeat(128)}`;
    const before = `\uFEFF{\r\n\t"packageManager" : "${old}"\r\n}\r\n`;
    const edit = planPinEdit(Buffer.from(before), target);
    expect(
      edit.bytes.equals(
        Buffer.from(
          before.replace(JSON.stringify(old), JSON.stringify(target)),
        ),
      ),
    ).toBe(true);
    expect(edit.summary.before).toBe(old);
    expect(edit.summary.operation).toBe('replace');
  });
  it('accepts a canonical current prerelease but does not retain its hash', () => {
    expect(
      planPinEdit(
        Buffer.from('{"packageManager":"npm@11.17.0-beta.1"}'),
        target,
      ).bytes.toString(),
    ).toBe('{"packageManager":"npm@11.17.0"}');
  });
  it.each([
    '{"a":1,"a":2}',
    '{"packageManager":"npm@11.1.0","package\\u004danager":"npm@11.2.0"}',
    '{"nested":{"x":1,"x":2}}',
    '{"nested":[{"x":1,"\\u0078":2}]}',
    '{/*comment*/"x":1}',
    '{"x":1,}',
    '{"x":[1,]}',
    '{"x":01}',
    '{"x":NaN}',
    '{"x":"bad\nstring"}',
    '{} {}',
    '[]',
    'null',
    '"TEST"',
    '',
    '{"x":true "y":false}',
    '{"x":}',
    '{"x":"\\uZZZZ"}',
  ])('refuses duplicate/ambiguous/non-strict JSON %p', (text) => {
    expect(() => planPinEdit(Buffer.from(text), target)).toThrow(
      expect.objectContaining({ details: { reason: 'CONFIG_UNSUPPORTED' } }),
    );
  });
  it.each([
    Buffer.from([0xff, 0xfe, 0x7b, 0x00, 0x7d, 0x00]),
    Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]),
    Buffer.from([
      0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xed, 0xa0, 0x80, 0x22, 0x7d,
    ]),
  ])('refuses non-UTF8 without replacement decoding', (bytes) => {
    expect(() => planPinEdit(bytes, target)).toThrow(
      expect.objectContaining({ details: { reason: 'CONFIG_UNSUPPORTED' } }),
    );
  });
  it('accepts depth 64 and refuses depth 65 before recursive parsing', () => {
    const nested = (levels: number) =>
      `{"x":${'['.repeat(levels)}0${']'.repeat(levels)}}`;
    expect(() => planPinEdit(Buffer.from(nested(63)), target)).not.toThrow();
    expect(() => planPinEdit(Buffer.from(nested(64)), target)).toThrow(
      expect.objectContaining({ details: { reason: 'CONFIG_UNSUPPORTED' } }),
    );
  });
  it('refuses an oversized manifest without truncating the write', () => {
    expect(() =>
      planPinEdit(Buffer.from(`{"x":"${'a'.repeat(1024 * 1024)}"}`), target),
    ).toThrow(
      expect.objectContaining({ details: { reason: 'LIMIT_EXCEEDED' } }),
    );
  });
  it('refuses an insertion that would make a bounded input exceed the manifest byte limit', () => {
    const bytes = Buffer.from('{"x":"' + 'a'.repeat(1024 * 1024 - 8) + '"}');
    expect(bytes.byteLength).toBe(1024 * 1024);
    expect(() => planPinEdit(bytes, target)).toThrow(
      expect.objectContaining({ details: { reason: 'LIMIT_EXCEEDED' } }),
    );
  });
  it.each([
    'latest',
    'npm@10.9.0',
    'npm@13.0.0',
    'pnpm@12.18.0',
    'npm@12.2.2-beta.1',
    'npm@v12.2.2',
    'npm@12.2.2+build',
    `npm@12.2.2+sha256.${'a'.repeat(64)}`,
    'yarn@1.22.22',
    'npm@11.17.0-beta.1',
    'npm@11.17.0+build',
    `npm@11.17.0+sha256.${'a'.repeat(64)}`,
  ])('refuses an unsupported new declaration %p', (pin) => {
    expect(() => planPinEdit(Buffer.from('{}'), pin)).toThrow(
      expect.objectContaining({
        details: { reason: 'TARGET_VERSION_UNSUPPORTED' },
      }),
    );
  });
  it.each([null, false, 1, {}, 'pnpm@latest', 'npm@11.1.0+build'])(
    'never overwrites an inert current declaration %p',
    (pin) => {
      expect(() =>
        planPinEdit(
          Buffer.from(JSON.stringify({ packageManager: pin })),
          target,
        ),
      ).toThrow(
        expect.objectContaining({ details: { reason: 'PIN_UNSUPPORTED' } }),
      );
    },
  );
  it('refuses same manager/version including a current hash', () => {
    for (const pin of [target, `${target}+sha256.${'a'.repeat(64)}`])
      expect(() =>
        planPinEdit(
          Buffer.from(JSON.stringify({ packageManager: pin })),
          target,
        ),
      ).toThrow(
        expect.objectContaining({ details: { reason: 'NO_VERSION_CHANGE' } }),
      );
  });
  it('handles __proto__ as an ordinary JSON key and detects its duplicate', () => {
    const bytes = Buffer.from('{"__proto__":{"test":true}}');
    expect(planPinEdit(bytes, target).bytes.toString()).toBe(
      '{"__proto__":{"test":true},"packageManager":"npm@11.17.0"}',
    );
    expect(() =>
      planPinEdit(Buffer.from('{"__proto__":1,"__proto__":2}'), target),
    ).toThrow();
  });
});
