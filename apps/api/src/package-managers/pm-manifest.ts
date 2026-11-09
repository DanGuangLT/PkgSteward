import { isDeepStrictEqual } from 'node:util';
import { AppException } from '@/common/exceptions/app.exception';
import { getPmTargetReason, parsePmPin } from '@/package-managers/pm-policy';
import type {
  IPmFileEdit,
  PmReasonCode,
} from '@/package-managers/interfaces/pm.types';

export interface IPmPinEdit {
  /** Private complete output for the injected atomic writer, never an HTTP field. */
  bytes: Buffer;
  /** Original byte offsets, end exclusive; an insertion has start === end. */
  start: number;
  end: number;
  replacement: Buffer;
  summary: IPmFileEdit;
}
interface IToken {
  start: number;
  end: number;
  string: boolean;
}
interface IRootMember {
  keyStart: number;
  keyEnd: number;
  token: IToken;
}
interface IManifestTokens {
  value: Record<string, unknown>;
  rootStart: number;
  rootEnd: number;
  last: IRootMember | null;
  pin: IToken | null;
}
const refuse = (reason: PmReasonCode = 'CONFIG_UNSUPPORTED'): never => {
  throw new AppException(
    400,
    'Project manifest cannot be edited safely',
    'VALIDATION_ERROR',
    { reason },
  );
};

/** Strict JSON tokenizer: decoded duplicate keys are refused at every depth. */
function inspectManifest(text: string): IManifestTokens {
  let at = 0;
  let rootEnd = -1;
  let last: IRootMember | null = null;
  let pin: IToken | null = null;
  const whitespace = () => {
    while (at < text.length && /[ \t\r\n]/.test(text[at])) at++;
  };
  const stringToken = (): IToken => {
    const start = at;
    if (text[at++] !== '"') return refuse();
    while (at < text.length) {
      const char = text[at++];
      if (char === '"') {
        try {
          JSON.parse(text.slice(start, at));
        } catch {
          return refuse();
        }
        return { start, end: at, string: true };
      }
      if (char === '\\') at++;
      else if (char.charCodeAt(0) < 0x20) return refuse();
    }
    return refuse();
  };
  const value = (depth: number): IToken => {
    whitespace();
    const start = at;
    const char = text[at];
    if (char === '"') return stringToken();
    if (char === '{' || char === '[') {
      if (depth > 64) return refuse();
      const object = char === '{';
      const close = object ? '}' : ']';
      const keys = new Set<string>();
      at++;
      whitespace();
      if (text[at] !== close) {
        while (true) {
          let key: string | null = null;
          let keyToken: IToken | null = null;
          if (object) {
            whitespace();
            keyToken = stringToken();
            key = JSON.parse(
              text.slice(keyToken.start, keyToken.end),
            ) as string;
            if (keys.has(key)) return refuse();
            keys.add(key);
            whitespace();
            if (text[at++] !== ':') return refuse();
          }
          const token = value(depth + 1);
          if (depth === 1 && object && keyToken) {
            last = { keyStart: keyToken.start, keyEnd: keyToken.end, token };
            if (key === 'packageManager') pin = token;
          }
          whitespace();
          if (text[at] === close) break;
          if (text[at++] !== ',') return refuse();
          // The next iteration demands a key/value, so trailing commas fail.
        }
      }
      if (text[at] !== close) return refuse();
      if (depth === 1) rootEnd = at;
      at++;
    } else {
      const token =
        /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
          text.slice(at),
        );
      if (!token) return refuse();
      at += token[0].length;
    }
    return { start, end: at, string: false };
  };
  whitespace();
  const rootStart = at;
  if (text[at] !== '{') return refuse();
  value(1);
  whitespace();
  if (at !== text.length) return refuse();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return refuse();
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
    return refuse();
  return {
    value: parsed as Record<string, unknown>,
    rootStart,
    rootEnd,
    last,
    pin,
  };
}

function decode(bytes: Uint8Array): { text: string; bomBytes: number } {
  try {
    // Keep the BOM visible here; byte offsets below explicitly account for it.
    const text = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
    return text.startsWith('\uFEFF')
      ? { text: text.slice(1), bomBytes: 3 }
      : { text, bomBytes: 0 };
  } catch {
    return refuse();
  }
}
const withoutPin = (value: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'packageManager'),
  );

/** Plans one root token edit; never normalizes/serializes the surrounding JSON. */
export function planPinEdit(bytes: Uint8Array, targetPin: string): IPmPinEdit {
  if (bytes.byteLength > 1024 * 1024) return refuse('LIMIT_EXCEEDED');
  const next = parsePmPin(targetPin).parsedPin;
  if (
    !next ||
    next.hash !== null ||
    getPmTargetReason(next.manager, '11.0.0', next.version, false) !== null
  )
    return refuse('TARGET_VERSION_UNSUPPORTED');
  const { text, bomBytes } = decode(bytes);
  const source = inspectManifest(text);
  const current = parsePmPin(
    source.value.packageManager,
    Object.hasOwn(source.value, 'packageManager'),
  );
  if (current.pinState === 'unsupported') return refuse('PIN_UNSUPPORTED');
  if (
    current.parsedPin?.manager === next.manager &&
    current.parsedPin.version === next.version
  )
    return refuse('NO_VERSION_CHANGE');
  const quoted = JSON.stringify(targetPin);
  let charStart: number;
  let charEnd: number;
  let replacement: string;
  if (source.pin) {
    if (!source.pin.string) return refuse('PIN_UNSUPPORTED');
    charStart = source.pin.start;
    charEnd = source.pin.end;
    replacement = quoted;
  } else {
    // Insert after the last value, leaving its original trailing whitespace intact.
    charStart = source.last?.token.end ?? source.rootStart + 1;
    charEnd = charStart;
    const eol = /\r\n|\n|\r/.exec(
      text.slice(source.rootStart, source.rootEnd),
    )?.[0];
    let indent = '  ';
    if (source.last) {
      const lineStart =
        Math.max(
          text.lastIndexOf('\n', source.last.keyStart - 1),
          text.lastIndexOf('\r', source.last.keyStart - 1),
        ) + 1;
      const prefix = text.slice(lineStart, source.last.keyStart);
      if (/^[ \t]+$/.test(prefix)) indent = prefix;
    }
    const colon = source.last
      ? text.slice(source.last.keyEnd, source.last.token.start)
      : eol
        ? ': '
        : ':';
    replacement = `${source.last ? ',' : ''}${eol ? eol + indent : ''}"packageManager"${colon}${quoted}`;
  }
  const start = bomBytes + Buffer.byteLength(text.slice(0, charStart), 'utf8');
  const end = bomBytes + Buffer.byteLength(text.slice(0, charEnd), 'utf8');
  const replacementBytes = Buffer.from(replacement, 'utf8');
  const original = Buffer.from(bytes);
  const output = Buffer.concat([
    original.subarray(0, start),
    replacementBytes,
    original.subarray(end),
  ]);
  if (output.byteLength > 1024 * 1024) return refuse('LIMIT_EXCEEDED');
  const result = inspectManifest(decode(output).text).value;
  if (
    result.packageManager !== targetPin ||
    !isDeepStrictEqual(withoutPin(source.value), withoutPin(result))
  )
    return refuse();
  return {
    bytes: output,
    start,
    end,
    replacement: replacementBytes,
    summary: {
      file: 'package.json',
      field: 'packageManager',
      operation: source.pin ? 'replace' : 'insert',
      before: current.rawPin,
      after: targetPin,
    },
  };
}
