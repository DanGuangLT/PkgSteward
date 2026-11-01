import * as fs from 'node:fs/promises';
import type { IFileOpsFsBundle } from '@/file-ops/interfaces/file-ops.types';

export const createFileOpsFs = (): IFileOpsFsBundle => ({
  files: {
    lstat: (path) => fs.lstat(path, { bigint: true }),
    readdir: (path) => fs.readdir(path, { withFileTypes: true }),
    readFile: (path) => fs.readFile(path, 'utf8'),
  },
  scan: {
    readdir: (path) => fs.readdir(path, { withFileTypes: true }),
    lstat: (path) => fs.lstat(path),
    realpath: (path) => fs.realpath(path),
    readFile: (path, signal) => fs.readFile(path, { encoding: 'utf8', signal }),
  },
  remove: (path, options) => fs.rm(path, options),
});
