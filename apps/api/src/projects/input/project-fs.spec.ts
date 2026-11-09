import { createReadStream } from 'node:fs';
import type { ReadStream, Stats } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { createProjectFs } from '@/projects/input/project-fs';

jest.mock('node:fs', () => ({ createReadStream: jest.fn() }));
jest.mock('node:fs/promises', () => ({
  lstat: jest.fn(),
  realpath: jest.fn(),
}));

const collect = async (chunks: AsyncIterable<Uint8Array>) => {
  const result: Uint8Array[] = [];
  for await (const chunk of chunks) result.push(chunk);
  return Buffer.concat(result);
};

describe('createProjectFs production adapter (mocked native IO)', () => {
  beforeEach(() => jest.resetAllMocks());

  it('preserves numeric identity, file/link predicates and a real directory predicate', async () => {
    const stat = {
      size: 0,
      mtimeMs: 12,
      ctimeMs: 10,
      ino: 2,
      dev: 1,
      isFile: () => false,
      isDirectory: () => true,
      isSymbolicLink: () => false,
    } as Stats;
    jest.mocked(lstat).mockResolvedValue(stat);
    const result = await createProjectFs().lstat('/project/node_modules');
    expect(result.isDirectory?.()).toBe(true);
    expect(result.isFile()).toBe(false);
    expect(result.isSymbolicLink()).toBe(false);
    expect(result).toMatchObject({
      size: 0,
      mtimeMs: 12,
      ctimeMs: 10,
      ino: 2,
      dev: 1,
    });
    expect(lstat).toHaveBeenCalledWith('/project/node_modules');
  });

  it('returns the filesystem canonical path and propagates metadata errors', async () => {
    jest.mocked(realpath).mockResolvedValue('/canonical/project');
    const adapter = createProjectFs();
    expect(await adapter.realpath('/alias')).toBe('/canonical/project');
    expect(realpath).toHaveBeenCalledWith('/alias');
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
    jest.mocked(lstat).mockRejectedValue(missing);
    await expect(adapter.lstat('/missing')).rejects.toBe(missing);
  });

  it('streams byte chunks with the caller signal rather than buffering a whole file', async () => {
    const stream = new PassThrough();
    jest
      .mocked(createReadStream)
      .mockReturnValue(stream as unknown as ReadStream);
    const signal = new AbortController().signal;
    const result = collect(
      createProjectFs().readChunks('/project/package.json', signal),
    );
    stream.write(Buffer.from('{"name":'));
    stream.end(Buffer.from('"demo"}'));
    expect((await result).toString()).toBe('{"name":"demo"}');
    expect(createReadStream).toHaveBeenCalledWith('/project/package.json', {
      signal,
    });
  });

  it('rejects an already aborted read without opening a stream', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      collect(createProjectFs().readChunks('/file', controller.signal)),
    ).rejects.toThrow();
    expect(createReadStream).not.toHaveBeenCalled();
  });

  it('propagates stream failures and closes the stream on early consumer return', async () => {
    const stream = new PassThrough();
    jest
      .mocked(createReadStream)
      .mockReturnValue(stream as unknown as ReadStream);
    const adapter = createProjectFs();
    const failure = collect(
      adapter.readChunks('/file', new AbortController().signal),
    );
    stream.destroy(new Error('read failed'));
    await expect(failure).rejects.toThrow('read failed');
    const next = new PassThrough();
    jest
      .mocked(createReadStream)
      .mockReturnValue(next as unknown as ReadStream);
    const iterator = adapter
      .readChunks('/file', new AbortController().signal)
      [Symbol.asyncIterator]();
    const first = iterator.next();
    next.write(Buffer.from('first'));
    expect((await first).done).toBe(false);
    await iterator.return?.();
    expect(next.destroyed).toBe(true);
  });

  it('stops a pending stream read when the supplied signal aborts', async () => {
    const stream = new PassThrough();
    const controller = new AbortController();
    // Model native createReadStream({signal}) without opening a real file.
    jest.mocked(createReadStream).mockImplementation(() => {
      controller.signal.addEventListener(
        'abort',
        () => stream.destroy(new Error('aborted')),
        { once: true },
      );
      return stream as unknown as ReadStream;
    });
    const result = collect(
      createProjectFs().readChunks('/file', controller.signal),
    );
    controller.abort();
    await expect(result).rejects.toThrow();
    expect(stream.destroyed).toBe(true);
    expect(createReadStream).toHaveBeenCalledWith('/file', {
      signal: controller.signal,
    });
  });
});
