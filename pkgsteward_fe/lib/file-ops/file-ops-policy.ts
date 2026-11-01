import { ApiError } from "../api/response.ts"
import type {
  FileOpsExecuteInput, FileOpsOperation, FileOpsOperationStatus, FileOpsPreview, FileOpsSummary,
} from "../api/types.ts"

interface FileOpsContext {
  preview: FileOpsPreview | null
  operation: FileOpsOperation | null
}

export type FileOpsUiState = FileOpsContext & (
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "measuring"; previewId: string; cancelPending: boolean; errorCode?: string }
  | { phase: "reviewing"; summary: FileOpsSummary | null; summarizing: boolean }
  | { phase: "executing"; input: FileOpsExecuteInput; summary: FileOpsSummary | null; resend: boolean }
  // Không biết backend đã nhận execute chưa: chỉ người dùng mới gửi lại được.
  | { phase: "unconfirmed"; input: FileOpsExecuteInput; summary: FileOpsSummary | null }
  | { phase: "operating"; operationId: string; cancelPending: boolean; errorCode?: string }
  | { phase: "finished" }
)

export interface FileOpsError {
  code: string
  paths: string[]
  // Báo riêng lỗi lúc bắt đầu: 404 ở đó là chưa có kết quả quét, không phải mất job.
  source?: "start"
}

type ResponseSource = "poll" | "cancel"
type FileOpsStatus =
  | "idle" | "starting" | "measuring" | "cancellingPreview" | "previewCompleted" | "previewCancelled" | "previewFailed"
  | "executing" | "unconfirmed" | "deleting" | "stopping"
  | "completed" | "completedWithFailures" | "cancelled" | "failed" | "untracked"

export const fileOpsInitialState: FileOpsUiState = { phase: "idle", preview: null, operation: null }

const UNKNOWN_OUTCOME_CODES = new Set(["BACKEND_UNAVAILABLE", "INVALID_RESPONSE", "UNKNOWN"])
const STALE_PREVIEW_CODES = new Set(["NOT_FOUND", "SCAN_CHANGED", "RISK_CHANGED", "TARGET_CHANGED"])

export function fileOpsOperationIsTerminal(status: FileOpsOperationStatus): boolean {
  return status !== "running" && status !== "stopping"
}

export function fileOpsStatusKey(state: FileOpsUiState): `status.${FileOpsStatus}` {
  switch (state.phase) {
    case "starting": return "status.starting"
    case "measuring": return state.cancelPending ? "status.cancellingPreview" : "status.measuring"
    case "reviewing":
      if (state.preview?.status === "cancelled") return "status.previewCancelled"
      return state.preview?.status === "failed" ? "status.previewFailed" : "status.previewCompleted"
    case "executing": return "status.executing"
    case "unconfirmed": return "status.unconfirmed"
    case "operating":
      return state.cancelPending || state.operation?.status === "stopping" ? "status.stopping" : "status.deleting"
    case "finished":
      if (state.operation?.status === "cancelled") return "status.cancelled"
      if (state.operation?.status === "failed") return "status.failed"
      return state.operation?.results.some(({ status }) => status === "failed")
        ? "status.completedWithFailures"
        : "status.completed"
    case "idle":
      return state.operation && !fileOpsOperationIsTerminal(state.operation.status) ? "status.untracked" : "status.idle"
  }
}

export function fileOpsError(error: unknown, source?: "start"): FileOpsError {
  const place = source ? { source } : {}
  if (!(error instanceof ApiError)) return { code: "UNKNOWN", paths: [], ...place }
  const details = error.details
  const paths = typeof details === "object" && details !== null && "paths" in details && Array.isArray(details.paths)
    ? details.paths.filter((path): path is string => typeof path === "string")
    : []
  return { code: error.code ?? (error.statusCode === 404 ? "NOT_FOUND" : "UNKNOWN"), paths, ...place }
}

export function fileOpsCanPoll(state: FileOpsUiState, visible: boolean): boolean {
  return visible && (state.phase === "measuring" || state.phase === "operating")
    && !state.cancelPending && state.errorCode === undefined
}

export function fileOpsBeginStart(state: FileOpsUiState): FileOpsUiState {
  return state.phase === "idle" || state.phase === "reviewing" || state.phase === "finished"
    ? { phase: "starting", preview: null, operation: null }
    : state
}

export function fileOpsStartFailure(state: FileOpsUiState): FileOpsUiState {
  return state.phase === "starting" ? fileOpsInitialState : state
}

export function fileOpsTrackPreview(state: FileOpsUiState, previewId: string): FileOpsUiState {
  return state.phase === "starting"
    ? { phase: "measuring", previewId, cancelPending: false, preview: null, operation: null }
    : state
}

export function fileOpsAcceptPreview(
  state: FileOpsUiState,
  preview: FileOpsPreview,
  expectedGeneration: number,
  responseGeneration: number,
  source: ResponseSource
): boolean {
  return state.phase === "measuring" && state.previewId === preview.previewId
    && expectedGeneration === responseGeneration && (source === "cancel" || !state.cancelPending)
}

export function fileOpsReceivePreview(state: FileOpsUiState, preview: FileOpsPreview): FileOpsUiState {
  if (state.phase !== "measuring") return state
  return preview.status === "running"
    ? { ...state, preview, cancelPending: false }
    : { phase: "reviewing", preview, operation: null, summary: null, summarizing: false }
}

export function fileOpsBeginCancel(state: FileOpsUiState): FileOpsUiState {
  return state.phase === "measuring" || state.phase === "operating"
    ? { ...state, cancelPending: true, errorCode: undefined }
    : state
}

export function fileOpsPollFailure(state: FileOpsUiState, code: string, statusCode?: number): FileOpsUiState {
  if (state.phase !== "measuring" && state.phase !== "operating") return state
  if (code === "NOT_FOUND" || statusCode === 404) {
    return { phase: "idle", preview: null, operation: state.operation }
  }
  return { ...state, cancelPending: false, errorCode: code }
}

export function fileOpsRetryPoll(state: FileOpsUiState): FileOpsUiState {
  return (state.phase === "measuring" || state.phase === "operating") && !state.cancelPending
    ? { ...state, errorCode: undefined }
    : state
}

export function fileOpsBeginSummary(state: FileOpsUiState): FileOpsUiState {
  return state.phase === "reviewing" ? { ...state, summary: null, summarizing: true } : state
}

export function fileOpsReceiveSummary(state: FileOpsUiState, summary: FileOpsSummary): FileOpsUiState {
  return state.phase === "reviewing" ? { ...state, summary, summarizing: false } : state
}

export function fileOpsCloseSummary(state: FileOpsUiState): FileOpsUiState {
  return state.phase === "reviewing" ? { ...state, summary: null, summarizing: false } : state
}

export function fileOpsSummaryFailure(state: FileOpsUiState, code: string): FileOpsUiState {
  if (state.phase !== "reviewing") return state
  return code === "NOT_FOUND" ? fileOpsInitialState : { ...state, summarizing: false }
}

/** Lần đầu cần summary đã xác nhận; gửi lại luôn dùng đúng input cũ, bỏ qua input truyền vào. */
export function fileOpsBeginExecute(state: FileOpsUiState, input?: FileOpsExecuteInput): FileOpsUiState {
  const { preview, operation } = state
  if (state.phase === "unconfirmed") {
    return { phase: "executing", preview, operation, input: state.input, summary: state.summary, resend: true }
  }
  return state.phase === "reviewing" && state.summary !== null && input !== undefined
    ? { phase: "executing", preview, operation, input, summary: state.summary, resend: false }
    : state
}

export function fileOpsExecuteFailure(state: FileOpsUiState, code: string): FileOpsUiState {
  if (state.phase !== "executing") return state
  const { preview, operation, input, summary } = state
  if (STALE_PREVIEW_CODES.has(code)) return fileOpsInitialState
  // Lần gửi lại bị từ chối không cho biết lần đầu ra sao, trừ khi chính xác nhận bị sai.
  // CONFLICT: preflight của lần trước có thể vẫn đang giữ cổng.
  if (UNKNOWN_OUTCOME_CODES.has(code) || (state.resend && code !== "VALIDATION_ERROR")) {
    return { phase: "unconfirmed", preview, operation, input, summary }
  }
  return { phase: "reviewing", preview, operation, summary, summarizing: false }
}

export function fileOpsTrackOperation(state: FileOpsUiState, operationId: string): FileOpsUiState {
  return state.phase === "executing"
    ? { phase: "operating", operationId, cancelPending: false, preview: state.preview, operation: null }
    : state
}

export function fileOpsFollowOperation(state: FileOpsUiState, operation: FileOpsOperation): FileOpsUiState {
  const { operationId } = operation
  if (state.phase === "idle") return { phase: "operating", operationId, cancelPending: false, preview: null, operation }
  return state.phase === "unconfirmed" && state.input.previewId === operation.previewId
    ? { phase: "operating", operationId, cancelPending: false, preview: state.preview, operation }
    : state
}

export function fileOpsResumePreview(state: FileOpsUiState, preview: FileOpsPreview): FileOpsUiState {
  return state.phase === "idle" && preview.status === "running"
    ? { phase: "measuring", previewId: preview.previewId, cancelPending: false, preview, operation: null }
    : state
}

export function fileOpsAcceptOperation(
  state: FileOpsUiState,
  operation: FileOpsOperation,
  expectedGeneration: number,
  responseGeneration: number,
  source: ResponseSource
): boolean {
  return state.phase === "operating" && state.operationId === operation.operationId
    && expectedGeneration === responseGeneration && (source === "cancel" || !state.cancelPending)
}

export function fileOpsReceiveOperation(state: FileOpsUiState, operation: FileOpsOperation): FileOpsUiState {
  if (state.phase !== "operating") return state
  return fileOpsOperationIsTerminal(operation.status)
    ? { phase: "finished", preview: state.preview, operation }
    : { ...state, operation, cancelPending: false }
}

export function fileOpsReset(state: FileOpsUiState): FileOpsUiState {
  return state.phase === "idle" || state.phase === "reviewing" || state.phase === "finished"
    ? fileOpsInitialState
    : state
}

// Lối thoát khi gửi lại vẫn không rõ kết quả; backend vẫn tự chặn nếu đang có thao tác chạy.
export function fileOpsAbandon(state: FileOpsUiState): FileOpsUiState {
  return state.phase === "unconfirmed" ? fileOpsInitialState : state
}
