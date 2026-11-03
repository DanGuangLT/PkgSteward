import { createReadStream } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import type { IProjectFs } from '@/projects/interfaces/projects.types';

export const createProjectFs = (): IProjectFs => ({
  lstat: (path) => lstat(path),
  realpath: (path) => realpath(path),
  async *readChunks(path, signal) {
    signal.throwIfAborted();
    const stream = createReadStream(path, { signal });
    try {
      for await (const chunk of stream) {
        signal.throwIfAborted();
        // No encoding is configured: the native stream yields byte buffers.
        yield chunk as Buffer;
      }
      signal.throwIfAborted();
    } finally {
      stream.destroy();
    }
  },
});
