import type { BigIntStats } from 'node:fs';
import {
  DISK_IDENTITY_LIMIT,
  fileIdentity,
} from '@/disk-usage/disk-usage-identity';

const stats = (ino: bigint, dev = 1n, nlink = 2n): BigIntStats =>
  ({ dev, ino, nlink }) as BigIntStats;

describe('fileIdentity', () => {
  it('preserves bigint ids above 2^53 without merging adjacent inodes', () => {
    const ino = 2n ** 53n;
    expect(fileIdentity(stats(ino))).toBe(`1:${ino}`);
    expect(fileIdentity(stats(ino + 1n))).toBe(`1:${ino + 1n}`);
  });

  it('distinguishes the same inode on different devices', () => {
    expect(fileIdentity(stats(7n, 1n))).not.toBe(fileIdentity(stats(7n, 2n)));
  });

  it('gives two hardlinks the same key without including nlink', () => {
    expect(fileIdentity(stats(7n, 3n, 2n))).toBe('3:7');
    expect(fileIdentity(stats(7n, 3n, 4n))).toBe('3:7');
  });

  it('accepts device zero', () => {
    expect(fileIdentity(stats(7n, 0n))).toBe('0:7');
  });

  it('does not create an identity key for a single-link file', () => {
    expect(fileIdentity(stats(7n, 1n, 1n))).toBeNull();
  });

  it.each([
    [0n, 1n, 2n],
    [-1n, 1n, 2n],
    [7n, -1n, 2n],
    [7n, 1n, 0n],
    [7n, 1n, -1n],
  ])('rejects invalid ino=%s dev=%s nlink=%s', (ino, dev, nlink) => {
    expect(fileIdentity(stats(ino, dev, nlink))).toBeNull();
  });

  it('exports the production ceiling of two million stored identities', () => {
    expect(DISK_IDENTITY_LIMIT).toBe(2_000_000);
  });
});
