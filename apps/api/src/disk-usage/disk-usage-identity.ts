import type { BigIntStats } from 'node:fs';

export const DISK_IDENTITY_LIMIT = 2_000_000;

export const fileIdentity = (stats: BigIntStats): string | null => {
  if (stats.nlink <= 1n || stats.ino <= 0n || stats.dev < 0n) return null;
  return `${stats.dev}:${stats.ino}`;
};
