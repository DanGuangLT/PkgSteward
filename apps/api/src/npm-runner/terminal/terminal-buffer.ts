import { StringDecoder } from 'node:string_decoder';
import {
  assertTerminalIdentity,
  terminalFailure,
  terminalInteger,
  TERMINAL_LIMITS,
} from '@/npm-runner/terminal/terminal-protocol';
import type { ITerminalIdentity } from '@/npm-runner/terminal/terminal-protocol';

export interface ITerminalOutputChunk {
  cursor: number;
  endCursor: number;
  text: string;
}
export interface ITerminalOutputPage extends ITerminalIdentity {
  firstCursor: number;
  nextCursor: number;
  endCursor: number;
  gap: boolean;
  truncated: boolean;
  parserReset: boolean;
  droppedBytes: number;
  chunks: ITerminalOutputChunk[];
}
interface IStoredChunk {
  cursor: number;
  data: Buffer;
}

function continuation(byte: number): boolean {
  return (byte & 0xc0) === 0x80;
}

export class TerminalOutputBuffer {
  private readonly identity: ITerminalIdentity;
  private readonly chunks: IStoredChunk[] = [];
  private decoder = new StringDecoder('utf8');
  private pendingHigh = '';
  private retainedBytes = 0;
  private endCursor = 0;
  private finished = false;

  constructor(identity: ITerminalIdentity) {
    assertTerminalIdentity(identity);
    this.identity = { ...identity };
  }

  append(data: Uint8Array | string): void {
    if (this.finished) terminalFailure(409, 'NOT_RUNNING');
    if (
      (typeof data === 'string' || data instanceof Uint8Array) &&
      data.length === 0
    )
      return;
    if (typeof data === 'string') {
      this.store(this.decoder.end());
      this.decoder = new StringDecoder('utf8');
      let text = this.pendingHigh + data;
      this.pendingHigh = '';
      const last = text.charCodeAt(text.length - 1);
      if (last >= 0xd800 && last <= 0xdbff) {
        this.pendingHigh = text.slice(-1);
        text = text.slice(0, -1);
      }
      this.store(text);
    } else if (data instanceof Uint8Array) {
      if (this.pendingHigh) {
        this.store(this.pendingHigh);
        this.pendingHigh = '';
      }
      // Decode bounded slices; an oversized producer frame never becomes retained storage.
      for (
        let offset = 0;
        offset < data.length;
        offset += TERMINAL_LIMITS.pageBytes
      ) {
        this.store(
          this.decoder.write(
            data.subarray(offset, offset + TERMINAL_LIMITS.pageBytes),
          ),
        );
      }
    } else {
      terminalFailure(400, 'INVALID_FRAME');
    }
  }

  finish(): void {
    if (this.finished) return;
    this.store(this.decoder.end());
    this.store(this.pendingHigh);
    this.pendingHigh = '';
    this.finished = true;
  }

  read(
    identity: ITerminalIdentity,
    cursor: number,
    maxBytes = TERMINAL_LIMITS.pageBytes,
  ): ITerminalOutputPage {
    assertTerminalIdentity(identity, this.identity);
    if (!terminalInteger(cursor, 0)) terminalFailure(400, 'INVALID_CURSOR');
    if (!terminalInteger(maxBytes, 1, TERMINAL_LIMITS.pageBytes))
      terminalFailure(400, 'INVALID_SIZE');
    if (cursor > this.endCursor) terminalFailure(409, 'CURSOR_FUTURE');
    const firstCursor = this.chunks[0]?.cursor ?? this.endCursor;
    const gap = cursor < firstCursor;
    let nextCursor = Math.max(cursor, firstCursor);
    let remaining = maxBytes;
    const chunks: ITerminalOutputChunk[] = [];
    for (const chunk of this.chunks) {
      const end = chunk.cursor + chunk.data.length;
      if (end <= nextCursor) continue;
      const start = nextCursor - chunk.cursor;
      if (continuation(chunk.data[start]))
        terminalFailure(409, 'CURSOR_BOUNDARY');
      let length = Math.min(chunk.data.length - start, remaining);
      while (
        length > 0 &&
        start + length < chunk.data.length &&
        continuation(chunk.data[start + length])
      )
        length--;
      if (length === 0) {
        if (chunks.length === 0) terminalFailure(400, 'INVALID_SIZE');
        break;
      }
      chunks.push({
        cursor: nextCursor,
        endCursor: nextCursor + length,
        text: chunk.data.toString('utf8', start, start + length),
      });
      nextCursor += length;
      remaining -= length;
      if (nextCursor < end || remaining === 0) break;
    }
    return {
      ...this.identity,
      firstCursor,
      nextCursor,
      endCursor: this.endCursor,
      gap,
      truncated: firstCursor > 0,
      parserReset: gap,
      droppedBytes: firstCursor,
      chunks,
    };
  }

  private store(text: string): void {
    // Each encoded allocation remains bounded; never retain a subarray of a huge buffer.
    for (let offset = 0; offset < text.length;) {
      let end = Math.min(text.length, offset + TERMINAL_LIMITS.pageBytes / 4);
      const last = text.charCodeAt(end - 1);
      if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
      const data = Buffer.from(text.slice(offset, end), 'utf8');
      if (this.endCursor > Number.MAX_SAFE_INTEGER - data.length)
        terminalFailure(409, 'CURSOR_OVERFLOW');
      this.chunks.push({ cursor: this.endCursor, data });
      this.endCursor += data.length;
      this.retainedBytes += data.length;
      offset = end;
      this.evict();
    }
  }

  private evict(): void {
    while (this.chunks.length > TERMINAL_LIMITS.outputChunks) {
      this.retainedBytes -= this.chunks.shift()!.data.length;
    }
    while (this.retainedBytes > TERMINAL_LIMITS.outputBytes) {
      const chunk = this.chunks[0];
      let remove = Math.min(
        chunk.data.length,
        this.retainedBytes - TERMINAL_LIMITS.outputBytes,
      );
      while (remove < chunk.data.length && continuation(chunk.data[remove]))
        remove++;
      this.retainedBytes -= remove;
      if (remove === chunk.data.length) this.chunks.shift();
      else
        this.chunks[0] = {
          cursor: chunk.cursor + remove,
          data: Buffer.from(chunk.data.subarray(remove)),
        };
    }
  }
}
