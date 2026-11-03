import type { RunJob, RunLogChunk, RunLogPage } from "@/lib/api/types"

export const RUNNER_LOG_MAX_BYTES = 512 * 1024
export const RUNNER_LOG_MAX_CHUNKS = 2048
const encoder = new TextEncoder()

export interface RunnerLogs {
  jobId: string | null
  chunks: RunLogChunk[]
  cursor: number
  bytes: number
  droppedChunks: number
  localDroppedBytes: number
  serverDroppedBytes: number
}

export function initialRunnerLogs(jobId: string | null = null): RunnerLogs {
  return { jobId, chunks: [], cursor: 0, bytes: 0, droppedChunks: 0, localDroppedBytes: 0, serverDroppedBytes: 0 }
}

export function mergeRunnerLogs(previous: RunnerLogs, page: RunLogPage): RunnerLogs {
  if (page.jobId !== previous.jobId) return previous
  const bySeq = new Map(previous.chunks.map(chunk => [chunk.seq, chunk]))
  for (const chunk of page.chunks) {
    if (chunk.seq >= previous.cursor && !bySeq.has(chunk.seq)) bySeq.set(chunk.seq, { ...chunk })
  }
  const chunks = [...bySeq.values()].sort((a, b) => a.seq - b.seq)
  const sizes = chunks.map(chunk => encoder.encode(chunk.text).byteLength)
  let bytes = sizes.reduce((sum, size) => sum + size, 0)
  let removed = 0
  let localDroppedBytes = previous.localDroppedBytes
  while (chunks.length - removed > RUNNER_LOG_MAX_CHUNKS || bytes > RUNNER_LOG_MAX_BYTES) {
    bytes -= sizes[removed]
    localDroppedBytes += sizes[removed++]
  }
  return { jobId: previous.jobId, chunks: chunks.slice(removed), bytes,
    cursor: Math.max(previous.cursor, page.nextCursor), localDroppedBytes,
    serverDroppedBytes: Math.max(previous.serverDroppedBytes, page.droppedBytes),
    droppedChunks: previous.droppedChunks + Math.max(0, page.firstCursor - previous.cursor) + removed }
}

export interface LogScrollMetrics { scrollHeight: number; scrollTop: number; clientHeight: number }
export function isNearLogBottom({ scrollHeight, scrollTop, clientHeight }: LogScrollMetrics): boolean {
  return scrollHeight - scrollTop - clientHeight <= 24
}
// Read the metrics before appending/rendering new chunks.
export function shouldAutoscroll(following: boolean, metrics: LogScrollMetrics): boolean {
  return following && isNearLogBottom(metrics)
}
export function jumpToLatest(): { following: true; scrollToBottom: true } {
  return { following: true, scrollToBottom: true }
}
export function needsLogDrain(logs: Pick<RunnerLogs, "cursor">, job: Pick<RunJob, "endCursor">): boolean {
  return logs.cursor < job.endCursor
}
