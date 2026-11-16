import { ApiError } from "../api/response.ts"
import type {
  RunJob,
  TerminalAckStatus,
  TerminalInputAck,
  TerminalOutputChunk,
  TerminalOutputPage,
  TerminalWriter,
} from "@/lib/api/types"

export const TERMINAL_OUTPUT_MAX_BYTES = 1048576
export const TERMINAL_OUTPUT_MAX_CHUNKS = 4096
export const TERMINAL_INPUT_MAX_BYTES = 4096
export const TERMINAL_MIN_COLS = 2
export const TERMINAL_MAX_COLS = 500
export const TERMINAL_MIN_ROWS = 1
export const TERMINAL_MAX_ROWS = 300

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder()

export interface TerminalBufferedChunk extends TerminalOutputChunk {
  bytes: number
}

export interface TerminalOutputState {
  jobId: string | null
  generation: number
  firstCursor: number
  cursor: number
  endCursor: number
  truncated: boolean
  droppedBytes: number
  localDroppedBytes: number
  resetRevision: number
  totalBytes: number
  chunks: TerminalBufferedChunk[]
}

export interface TerminalOutputMatch {
  line: number
  index: number
  length: number
  lineText: string
}

export interface TerminalOutputSearchResult {
  count: number
  matches: TerminalOutputMatch[]
}

export interface TerminalClientState {
  tabId: string
  jobId: string | null
  generation: number
  writer: TerminalWriter | null
  claiming: boolean
  claimError: string | null
  nextSequence: number
  pendingSequence: number | null
  pendingText: string | null
  inputPending: boolean
  inputUnknown: boolean
  lastInputAck: TerminalInputAck | null
  inputStatus: TerminalAckStatus | null
  inputError: string | null
  cols: number | null
  rows: number | null
  resizeError: string | null
  output: TerminalOutputState
}

export function utf8ByteLength(text: string): number {
  return utf8Encoder.encode(text).byteLength
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function sliceUtf8Tail(text: string, maxBytes: number): string {
  const bytes = utf8Encoder.encode(text)
  if (bytes.byteLength <= maxBytes) return text
  // Keep valid UTF-8 characters when truncating from the front of an oversized chunk.
  let offset = bytes.byteLength - maxBytes
  while (offset < bytes.byteLength && (bytes[offset] & 0b1100_0000) === 0b1000_0000) {
    offset += 1
  }
  return utf8Decoder.decode(bytes.subarray(offset))
}

export function initialTerminalOutput(jobId: string | null = null, generation = 0): TerminalOutputState {
  return {
    jobId,
    generation,
    firstCursor: 0,
    cursor: 0,
    endCursor: 0,
    truncated: false,
    droppedBytes: 0,
    localDroppedBytes: 0,
    resetRevision: 0,
    totalBytes: 0,
    chunks: [],
  }
}

export function initialTerminalClientState(
  tabId: string,
  jobId: string | null = null,
  generation = 0,
): TerminalClientState {
  return {
    tabId,
    jobId,
    generation,
    writer: null,
    claiming: false,
    claimError: null,
    nextSequence: 1,
    pendingSequence: null,
    pendingText: null,
    inputPending: false,
    inputUnknown: false,
    lastInputAck: null,
    inputStatus: null,
    inputError: null,
    cols: null,
    rows: null,
    resizeError: null,
    output: initialTerminalOutput(jobId, generation),
  }
}

function invalidTerminalOutput(message: string): ApiError {
  return new ApiError(502, message, "INVALID_RESPONSE")
}

export function mergeTerminalOutput(previous: TerminalOutputState, page: TerminalOutputPage): TerminalOutputState {
  if (!page || typeof page !== "object" || !Array.isArray(page.chunks)) {
    throw invalidTerminalOutput("Unexpected terminal output response.")
  }
  if (!isNonNegativeInt(page.generation)
    || !isNonNegativeInt(page.firstCursor)
    || !isNonNegativeInt(page.nextCursor)
    || !isNonNegativeInt(page.endCursor)
    || !isNonNegativeInt(page.droppedBytes)) {
    throw invalidTerminalOutput("Unexpected terminal output cursors.")
  }
  if (page.nextCursor < page.firstCursor || page.endCursor < page.nextCursor) {
    throw invalidTerminalOutput("Unexpected terminal output cursor range.")
  }
  if (previous.jobId !== null && page.jobId !== previous.jobId) {
    throw invalidTerminalOutput("Mismatched terminal output jobId.")
  }
  if (previous.generation > 0 && page.generation !== previous.generation) {
    throw invalidTerminalOutput("Mismatched terminal output generation.")
  }

  const reset = Boolean(page.gap || page.parserReset)
  if (!reset && page.nextCursor < previous.cursor) {
    throw invalidTerminalOutput("Terminal output cursor moved backwards without reset.")
  }

  let expectedCursor = reset ? page.firstCursor : previous.cursor
  const appended: TerminalBufferedChunk[] = []
  for (const chunk of page.chunks) {
    if (!chunk || typeof chunk !== "object"
      || !isNonNegativeInt(chunk.cursor)
      || !isNonNegativeInt(chunk.endCursor)
      || chunk.endCursor < chunk.cursor
      || typeof chunk.text !== "string") {
      throw invalidTerminalOutput("Invalid terminal output chunk.")
    }
    if (chunk.cursor < expectedCursor) {
      throw invalidTerminalOutput("Overlapping or out-of-order terminal output chunk.")
    }
    expectedCursor = chunk.endCursor
    appended.push({
      cursor: chunk.cursor,
      endCursor: chunk.endCursor,
      text: chunk.text,
      bytes: utf8ByteLength(chunk.text),
    })
  }
  if (expectedCursor > page.nextCursor) {
    throw invalidTerminalOutput("Terminal output chunk exceeds nextCursor.")
  }

  const chunks = reset ? [...appended] : [...previous.chunks, ...appended]
  let totalBytes = reset
    ? appended.reduce((sum, item) => sum + item.bytes, 0)
    : previous.totalBytes + appended.reduce((sum, item) => sum + item.bytes, 0)
  let localDroppedBytes = reset ? 0 : previous.localDroppedBytes
  let truncated = Boolean(page.truncated || (!reset && previous.truncated))

  while (chunks.length > 1 && (totalBytes > TERMINAL_OUTPUT_MAX_BYTES || chunks.length > TERMINAL_OUTPUT_MAX_CHUNKS)) {
    const evicted = chunks.shift()
    if (!evicted) break
    totalBytes -= evicted.bytes
    localDroppedBytes += evicted.bytes
    truncated = true
  }

  if (chunks.length === 1 && chunks[0].bytes > TERMINAL_OUTPUT_MAX_BYTES) {
    const only = chunks[0]
    const trimmedText = sliceUtf8Tail(only.text, TERMINAL_OUTPUT_MAX_BYTES)
    const trimmedBytes = utf8ByteLength(trimmedText)
    localDroppedBytes += Math.max(0, only.bytes - trimmedBytes)
    chunks[0] = { ...only, text: trimmedText, bytes: trimmedBytes }
    totalBytes = trimmedBytes
    truncated = true
  }

  return {
    jobId: page.jobId,
    generation: page.generation,
    firstCursor: chunks[0]?.cursor ?? page.firstCursor,
    cursor: page.nextCursor,
    endCursor: page.endCursor,
    truncated,
    droppedBytes: page.droppedBytes,
    localDroppedBytes,
    resetRevision: reset ? previous.resetRevision + 1 : previous.resetRevision,
    totalBytes,
    chunks,
  }
}

export function terminalOutputText(output: Pick<TerminalOutputState, "chunks">): string {
  return output.chunks.map(chunk => chunk.text).join("")
}

export function needsTerminalOutputDrain(
  output: Pick<TerminalOutputState, "jobId" | "generation" | "cursor">,
  job: Pick<RunJob, "jobId" | "terminal"> | null | undefined,
): boolean {
  if (!job?.terminal?.available) return false
  if (output.jobId !== null && job.jobId !== output.jobId) return false
  if (job.terminal.generation !== output.generation) {
    return job.terminal.generation > output.generation && job.terminal.endCursor > 0
  }
  return job.terminal.endCursor > output.cursor
}

export function findTerminalOutputMatches(text: string, query: string): TerminalOutputSearchResult {
  if (!query || !query.trim()) return { count: 0, matches: [] }
  const needle = query.toLowerCase()
  const lines = text.split("\n")
  const matches: TerminalOutputMatch[] = []
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
    const lineText = lines[lineIdx].endsWith("\r") ? lines[lineIdx].slice(0, -1) : lines[lineIdx]
    const haystack = lineText.toLowerCase()
    let fromIndex = 0
    while (fromIndex <= haystack.length - needle.length) {
      const hit = haystack.indexOf(needle, fromIndex)
      if (hit === -1) break
      matches.push({
        line: lineIdx + 1,
        index: hit,
        length: query.length,
        lineText,
      })
      fromIndex = hit + Math.max(1, needle.length)
    }
  }
  return { count: matches.length, matches }
}

export function needsTerminalPasteConfirmation(text: string): boolean {
  return /[\r\n]/.test(text)
}

export function resolveTerminalCtrlC(hasSelection: boolean): "copy" | "interrupt" {
  return hasSelection ? "copy" : "interrupt"
}

export function isValidTerminalInputText(text: string): boolean {
  return typeof text === "string" && text.length > 0 && utf8ByteLength(text) <= TERMINAL_INPUT_MAX_BYTES
}

export function clampTerminalSize(cols: number, rows: number): { cols: number; rows: number } | null {
  if (!Number.isSafeInteger(cols) || !Number.isSafeInteger(rows)) return null
  if (cols < TERMINAL_MIN_COLS || cols > TERMINAL_MAX_COLS) return null
  if (rows < TERMINAL_MIN_ROWS || rows > TERMINAL_MAX_ROWS) return null
  return { cols, rows }
}
