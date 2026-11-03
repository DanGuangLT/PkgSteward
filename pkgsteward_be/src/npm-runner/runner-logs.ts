import type {
  IRunLogPage,
  RunWarningCode,
} from './interfaces/npm-runner.types';
import { StringDecoder } from 'node:string_decoder';

export interface IRunClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface IRunLogStore {
  append(stream: 'stdout' | 'stderr', chunk: Buffer): void;
  /** Flush partial lines; final=true also ends both incremental decoders. */
  flush(final?: boolean): void;
  snapshot(cursor: number): IRunLogPage;
  readonly firstCursor: number;
  readonly endCursor: number;
  readonly retainedBytes: number;
  readonly retainedChunks: number;
  readonly droppedBytes: number;
  readonly warningCodes: readonly RunWarningCode[];
}

export interface IRunLogStoreOptions {
  jobId: string;
  clock: IRunClock;
}

export function createRunLogStore(options: IRunLogStoreOptions): IRunLogStore {
  type Stream = 'stdout' | 'stderr';
  interface StreamState {
    decoder: StringDecoder;
    line: string;
    bytes: number;
    escape: 'text' | 'esc' | 'csi' | 'osc' | 'oscEsc';
    escapeBytes: number;
    scheduled: boolean;
    timer: unknown;
    secretEnd: 'space' | '"' | "'" | null;
  }
  const state = (): StreamState => ({
    decoder: new StringDecoder('utf8'),
    line: '',
    bytes: 0,
    escape: 'text',
    escapeBytes: 0,
    scheduled: false,
    timer: null,
    secretEnd: null,
  });
  const streams = { stdout: state(), stderr: state() };
  const chunks: IRunLogPage['chunks'] = [];
  const warnings = new Set<RunWarningCode>(['LOGS_MAY_CONTAIN_SECRETS']);
  let retainedBytes = 0;
  let droppedBytes = 0;
  let endCursor = 0;
  let closed = false;

  const retain = (stream: Stream, text: string): void => {
    chunks.push({ seq: endCursor++, stream, text });
    retainedBytes += Buffer.byteLength(text);
    while (retainedBytes > 1_048_576 || chunks.length > 4096) {
      const removed = chunks.shift();
      if (!removed) break;
      const bytes = Buffer.byteLength(removed.text);
      retainedBytes -= bytes;
      droppedBytes += bytes;
      warnings.add('OUTPUT_TRUNCATED');
    }
  };
  const publish = (stream: Stream, text: string): void => {
    let part = '';
    let bytes = 0;
    for (const char of text) {
      const size = Buffer.byteLength(char);
      if (bytes + size > 8192) {
        retain(stream, part);
        part = '';
        bytes = 0;
      }
      part += char;
      bytes += size;
    }
    if (part) retain(stream, part);
  };
  const sanitizeSecrets = (input: string, current: StreamState): string => {
    let text = input;
    if (current.secretEnd) {
      const end =
        current.secretEnd === 'space'
          ? text.search(/\s/)
          : text.indexOf(current.secretEnd);
      if (end < 0) return '';
      const quoted = current.secretEnd !== 'space';
      text = text.slice(end + (quoted ? 1 : 0));
      current.secretEnd = null;
    }
    text = text.replace(
      /((?:_authToken|_password|token|password)[ \t]*[:=][ \t]*|authorization[ \t]*:[ \t]*(?:bearer|basic)[ \t]+)("[^"\n]*(?:"|$)|'[^'\n]*(?:'|$)|[^\s]*)/gi,
      (
        match: string,
        prefix: string,
        value: string,
        offset: number,
        whole: string,
      ) => {
        if (offset + match.length === whole.length && !whole.endsWith('\n')) {
          const quote = value[0];
          if (quote === '"' || quote === "'") {
            if (value.length < 2 || !value.endsWith(quote))
              current.secretEnd = quote;
          } else current.secretEnd = 'space';
        }
        return `${prefix}[REDACTED]`;
      },
    );
    return text.replace(
      /(\b[a-z][a-z\d+.-]{0,31}:\/\/)[^\s/@]+@/gi,
      '$1[REDACTED]@',
    );
  };
  const clearTimer = (current: StreamState): void => {
    if (current.scheduled) options.clock.clearTimeout(current.timer);
    current.scheduled = false;
    current.timer = null;
  };
  const incompleteSecretAt = (text: string): number => {
    let start = text.length;
    const lower = text.toLowerCase();
    for (const prefix of [
      '_authtoken',
      '_password',
      'token',
      'password',
      'authorization',
      'http://',
      'https://',
    ]) {
      for (let length = 1; length <= prefix.length; length++) {
        if (lower.endsWith(prefix.slice(0, length)))
          start = Math.min(start, text.length - length);
      }
    }
    for (const pattern of [
      /(?:_authtoken|_password|token|password)[ \t]*(?:[:=][ \t]*)?$/i,
      /authorization[ \t]*:?[ \t]*[a-z]*[ \t]*$/i,
      /[a-z][a-z\d+.-]{0,31}:\/\/[^\s/@]{0,256}$/i,
    ]) {
      const tail = text.slice(-384);
      const match = pattern.exec(tail);
      if (match && tail.length - match.index <= 256)
        start = Math.min(start, text.length - tail.length + match.index);
    }
    return start;
  };
  const commit = (stream: Stream, final = false): void => {
    const current = streams[stream];
    clearTimer(current);
    if (!current.line) return;
    // A partial timer must not publish half a credential key/URL prefix.
    const end =
      final || current.line.endsWith('\n') || current.secretEnd
        ? current.line.length
        : incompleteSecretAt(current.line);
    const safe = sanitizeSecrets(current.line.slice(0, end), current);
    current.line = current.line.slice(end);
    current.bytes = Buffer.byteLength(current.line);
    publish(stream, safe);
  };
  const consume = (stream: Stream, decoded: string): void => {
    const current = streams[stream];
    for (const char of decoded) {
      const code = char.codePointAt(0) ?? 0;
      if (code === 0xfffd) warnings.add('OUTPUT_ENCODING_LOSS');
      if (current.escape !== 'text') {
        current.escapeBytes += Buffer.byteLength(char);
        if (current.escapeBytes > 4096) warnings.add('OUTPUT_TRUNCATED');
        if (current.escape === 'esc') {
          if (char === '[') current.escape = 'csi';
          else if (char === ']') current.escape = 'osc';
          else if (code < 0x20 || code > 0x2f) current.escape = 'text';
        } else if (current.escape === 'csi') {
          if (code >= 0x40 && code <= 0x7e) current.escape = 'text';
        } else if (
          char === '\x07' ||
          (current.escape === 'oscEsc' && char === '\\')
        ) {
          current.escape = 'text';
        } else current.escape = char === '\x1b' ? 'oscEsc' : 'osc';
        // Only a state and a capped counter survive: never keep an escape payload.
        current.escapeBytes = Math.min(current.escapeBytes, 4097);
        continue;
      }
      if (char === '\x1b') {
        current.escape = 'esc';
        current.escapeBytes = 1;
        continue;
      }
      if (
        (code < 0x20 && char !== '\n' && char !== '\t' && char !== '\r') ||
        (code >= 0x7f && code <= 0x9f) ||
        code === 0x061c ||
        (code >= 0x200e && code <= 0x200f) ||
        (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2066 && code <= 0x206f)
      )
        continue;
      const safe = char === '\r' ? '\n' : char;
      const bytes = Buffer.byteLength(safe);
      if (current.bytes + bytes > 8192) commit(stream);
      current.line += safe;
      current.bytes += bytes;
      if (safe === '\n' || current.bytes === 8192) commit(stream);
    }
  };
  const append = (stream: Stream, chunk: Buffer): void => {
    if (closed) return;
    const current = streams[stream];
    for (let offset = 0; offset < chunk.length; offset += 4096)
      consume(
        stream,
        current.decoder.write(chunk.subarray(offset, offset + 4096)),
      );
    if (current.line && !current.scheduled) {
      current.scheduled = true;
      current.timer = options.clock.setTimeout(() => commit(stream), 250);
    }
  };
  const flush = (final = false): void => {
    if (closed) return;
    for (const stream of ['stdout', 'stderr'] as const) {
      const current = streams[stream];
      if (final) {
        consume(stream, current.decoder.end());
        if (current.escape !== 'text') warnings.add('OUTPUT_TRUNCATED');
        current.escape = 'text';
      }
      commit(stream, final);
    }
    closed = final;
  };
  const snapshot = (cursor: number): IRunLogPage => {
    const firstCursor = chunks[0]?.seq ?? endCursor;
    const requested = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
    const start = Math.max(requested, firstCursor);
    const page: IRunLogPage = {
      jobId: options.jobId,
      firstCursor,
      nextCursor: start,
      endCursor,
      truncated: requested < firstCursor,
      droppedBytes,
      chunks: [],
    };
    let bytes = 0;
    for (const chunk of chunks) {
      if (chunk.seq < start) continue;
      const size = Buffer.byteLength(chunk.text);
      if (page.chunks.length === 256 || bytes + size > 65536) break;
      page.chunks.push({ ...chunk });
      bytes += size;
      page.nextCursor = chunk.seq + 1;
    }
    return page;
  };
  return {
    append,
    flush,
    snapshot,
    get firstCursor() {
      return chunks[0]?.seq ?? endCursor;
    },
    get endCursor() {
      return endCursor;
    },
    get retainedBytes() {
      return retainedBytes;
    },
    get retainedChunks() {
      return chunks.length;
    },
    get droppedBytes() {
      return droppedBytes;
    },
    get warningCodes() {
      return [...warnings];
    },
  };
}
