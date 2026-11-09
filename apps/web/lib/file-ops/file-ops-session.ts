import {
  cancelBrowserOperation, cancelBrowserPreview, executeBrowserDelete, getBrowserActiveOperation,
  pollBrowserOperation, pollBrowserPreview, startBrowserCleanupPreview, startBrowserDeletePreview, summarizeBrowserPreview,
} from "../api/file-ops/file-ops-browser.ts"
import { ApiError } from "../api/response.ts"
import type { CleanupPreviewInput, FileOpsPreviewStart } from "@/lib/api/types"
import { buildExecuteInput, type ConfirmationInput } from "./confirmation.ts"
import {
  fileOpsAbandon, fileOpsAcceptOperation, fileOpsAcceptPreview, fileOpsBeginCancel, fileOpsBeginExecute, fileOpsBeginStart,
  fileOpsBeginSummary, fileOpsCanPoll, fileOpsCloseSummary, fileOpsError, fileOpsExecuteFailure, fileOpsFollowOperation,
  fileOpsInitialState, fileOpsPollFailure, fileOpsReceiveOperation, fileOpsReceivePreview, fileOpsReceiveSummary,
  fileOpsReset, fileOpsResumePreview, fileOpsRetryPoll, fileOpsStartFailure, fileOpsSummaryFailure, fileOpsTrackOperation,
  fileOpsTrackPreview, type FileOpsError, type FileOpsUiState,
} from "./file-ops-policy.ts"

export const POLL_INTERVAL_MS = 1000
export const ACTIVE_CHECK_INTERVAL_MS = 3000

export interface FileOpsEnvironment {
  isVisible(): boolean
  onVisibilityChange(listener: () => void): () => void
  recallPreview(): string | null
  rememberPreview(previewId: string | null): void
}

export interface FileOpsSnapshot {
  state: FileOpsUiState
  error: FileOpsError | null
}

export interface FileOpsActions {
  startCleanup(input: CleanupPreviewInput): Promise<void>
  startDelete(paths: string[]): Promise<void>
  cancelPreview(): Promise<void>
  summarize(paths: string[]): Promise<void>
  closeSummary(): void
  execute(confirmation: ConfirmationInput): Promise<void>
  resendExecute(): Promise<void>
  abandon(): void
  cancelOperation(): Promise<void>
  retryPoll(): void
  reset(): void
}

export interface FileOpsSession extends FileOpsActions {
  subscribe(listener: () => void): () => void
  getSnapshot(): FileOpsSnapshot
  connect(): () => void
}

/**
 * Điều phối preview → summary → execute → operation, tách khỏi React để test được cả chuỗi.
 * Chỉ thao tác của người dùng mới gửi execute: poll, khôi phục sau reload hay kết nối lại đều chỉ đọc.
 */
export function createFileOpsSession(environment: FileOpsEnvironment): FileOpsSession {
  const listeners = new Set<() => void>()
  let snapshot: FileOpsSnapshot = { state: fileOpsInitialState, error: null }
  let connected = false
  let generation = 0
  let request: AbortController | null = null
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let activeTimer: ReturnType<typeof setTimeout> | null = null
  let background: AbortController | null = null

  function update(state: FileOpsUiState, error: FileOpsError | null = snapshot.error) {
    if (state === snapshot.state && error === snapshot.error) return
    if (snapshot.state.phase === "measuring" && state.phase !== "measuring") environment.rememberPreview(null)
    snapshot = { state, error }
    for (const listener of listeners) listener()
  }

  function clearPollTimer() {
    if (pollTimer !== null) clearTimeout(pollTimer)
    pollTimer = null
  }

  function stopRequest() {
    clearPollTimer()
    request?.abort()
    request = null
  }

  function reportJobFailure(cause: unknown) {
    const failure = fileOpsError(cause)
    update(
      fileOpsPollFailure(snapshot.state, failure.code, cause instanceof ApiError ? cause.statusCode : undefined),
      failure
    )
  }

  async function poll(): Promise<void> {
    const active = snapshot.state
    if (!connected || request || !fileOpsCanPoll(active, environment.isVisible())) return
    clearPollTimer()
    const controller = new AbortController()
    const responseGeneration = generation
    request = controller
    const isStale = () => !connected || controller.signal.aborted || request !== controller
      || generation !== responseGeneration
    try {
      if (active.phase === "measuring") {
        const preview = await pollBrowserPreview(active.previewId, controller.signal)
        if (!isStale() && fileOpsAcceptPreview(snapshot.state, preview, generation, responseGeneration, "poll")) {
          update(fileOpsReceivePreview(snapshot.state, preview))
        }
      } else if (active.phase === "operating") {
        const operation = await pollBrowserOperation(active.operationId, controller.signal)
        if (!isStale() && fileOpsAcceptOperation(snapshot.state, operation, generation, responseGeneration, "poll")) {
          update(fileOpsReceiveOperation(snapshot.state, operation))
        }
      }
    } catch (cause) {
      if (!isStale()) reportJobFailure(cause)
    } finally {
      if (request === controller) request = null
    }
    if (connected && !controller.signal.aborted && generation === responseGeneration
      && fileOpsCanPoll(snapshot.state, environment.isVisible())) {
      pollTimer = setTimeout(() => {
        pollTimer = null
        void poll()
      }, POLL_INTERVAL_MS)
    }
  }

  // Mỗi lần chỉ một request thao tác; response đến muộn hoặc đã bị thay thế thì bỏ qua.
  async function exclusive<T>(
    call: (signal: AbortSignal) => Promise<T>,
    onSuccess: (value: T) => void,
    onFailure: (cause: unknown) => void
  ): Promise<void> {
    const responseGeneration = generation
    const controller = new AbortController()
    request = controller
    const isStale = () => !connected || controller.signal.aborted || request !== controller
      || generation !== responseGeneration
    try {
      const value = await call(controller.signal)
      if (!isStale()) onSuccess(value)
    } catch (cause) {
      if (!isStale()) onFailure(cause)
    } finally {
      if (request === controller) {
        request = null
        void poll()
      }
    }
  }

  function begin(call: (signal: AbortSignal) => Promise<FileOpsPreviewStart>): Promise<void> {
    const starting = fileOpsBeginStart(snapshot.state)
    if (!connected || starting === snapshot.state) return Promise.resolve()
    stopRequest()
    generation += 1
    update(starting, null)
    return exclusive(call, (started) => {
      environment.rememberPreview(started.previewId)
      update(fileOpsTrackPreview(snapshot.state, started.previewId))
    }, (cause) => update(fileOpsStartFailure(snapshot.state), fileOpsError(cause, "start")))
  }

  function send(next: FileOpsUiState): Promise<void> {
    if (!connected || request || next.phase !== "executing") return Promise.resolve()
    generation += 1
    update(next, null)
    return exclusive((signal) => executeBrowserDelete(next.input, signal), (started) => {
      update(fileOpsTrackOperation(snapshot.state, started.operationId))
    }, (cause) => {
      const failure = fileOpsError(cause)
      update(fileOpsExecuteFailure(snapshot.state, failure.code), failure)
    })
  }

  async function restorePreview(signal: AbortSignal): Promise<void> {
    const previewId = environment.recallPreview()
    if (previewId === null) return
    try {
      const preview = await pollBrowserPreview(previewId, signal)
      if (signal.aborted) return
      const resumed = fileOpsResumePreview(snapshot.state, preview)
      if (preview.status !== "running") environment.rememberPreview(null)
      if (resumed === snapshot.state) return
      generation += 1
      update(resumed)
      void poll()
    } catch (cause) {
      // Lỗi tạm thời: preview có thể vẫn chạy, giữ lại id để còn dừng được.
      if (!signal.aborted && cause instanceof ApiError && cause.statusCode === 404) environment.rememberPreview(null)
    }
  }

  // Bắt cả operation bắt đầu sau khi trang đã mở: preflight dài, tải lại, tab khác.
  async function checkActiveOperation(signal: AbortSignal): Promise<void> {
    const { phase } = snapshot.state
    if ((phase === "idle" || phase === "unconfirmed") && environment.isVisible()) {
      try {
        const operation = await getBrowserActiveOperation(signal)
        const followed = operation && !signal.aborted ? fileOpsFollowOperation(snapshot.state, operation) : snapshot.state
        if (followed !== snapshot.state) {
          generation += 1
          update(followed, null)
          void poll()
        }
      } catch {
        // Chỉ là theo dõi nền; backend lỗi sẽ hiện khi người dùng thao tác.
      }
    }
    if (!signal.aborted) {
      activeTimer = setTimeout(() => void checkActiveOperation(signal), ACTIVE_CHECK_INTERVAL_MS)
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    getSnapshot: () => snapshot,

    connect() {
      connected = true
      const controller = new AbortController()
      background = controller
      const stopWatching = environment.onVisibilityChange(() => {
        const active = snapshot.state
        if (environment.isVisible()) void poll()
        // Chỉ huỷ request theo dõi; execute hoặc cancel đang gửi phải chạy tới cùng.
        else if ((active.phase === "measuring" || active.phase === "operating") && !active.cancelPending) stopRequest()
      })
      void restorePreview(controller.signal)
      void checkActiveOperation(controller.signal)

      return () => {
        connected = false
        stopWatching()
        background?.abort()
        background = null
        if (activeTimer !== null) clearTimeout(activeTimer)
        activeTimer = null
        // Người dùng đã xác nhận: rời trang không được làm mất lệnh xoá đang gửi.
        if (snapshot.state.phase === "executing") clearPollTimer()
        else stopRequest()
      }
    },

    startCleanup: (input) => begin((signal) => startBrowserCleanupPreview(input, signal)),

    startDelete: (paths) => begin((signal) => startBrowserDeletePreview(paths, signal)),

    cancelPreview() {
      const active = snapshot.state
      if (!connected || active.phase !== "measuring" || active.cancelPending) return Promise.resolve()
      stopRequest()
      generation += 1
      update(fileOpsBeginCancel(active), null)
      return exclusive((signal) => cancelBrowserPreview(active.previewId, signal), (preview) => {
        if (fileOpsAcceptPreview(snapshot.state, preview, generation, generation, "cancel")) {
          update(fileOpsReceivePreview(snapshot.state, preview))
        }
      }, reportJobFailure)
    },

    summarize(paths) {
      const active = snapshot.state
      if (!connected || active.phase !== "reviewing" || active.preview === null) return Promise.resolve()
      const { previewId } = active.preview
      // Lựa chọn mới nhất thắng: summary cũ không được quay lại dialog.
      stopRequest()
      generation += 1
      update(fileOpsBeginSummary(active), null)
      return exclusive((signal) => summarizeBrowserPreview(previewId, paths, signal), (summary) => {
        update(fileOpsReceiveSummary(snapshot.state, summary))
      }, (cause) => {
        const failure = fileOpsError(cause)
        update(fileOpsSummaryFailure(snapshot.state, failure.code), failure)
      })
    },

    closeSummary() {
      if (snapshot.state.phase !== "reviewing") return
      stopRequest()
      generation += 1
      update(fileOpsCloseSummary(snapshot.state), null)
    },

    execute(confirmation) {
      const active = snapshot.state
      if (active.phase !== "reviewing" || active.preview === null || active.summary === null) return Promise.resolve()
      // Dựng từ summary đang hiện, không nhận path hay previewId từ nơi gọi.
      const input = buildExecuteInput(active.preview.previewId, active.summary, confirmation)
      return input ? send(fileOpsBeginExecute(active, input)) : Promise.resolve()
    },

    resendExecute() {
      const active = snapshot.state
      return active.phase === "unconfirmed" ? send(fileOpsBeginExecute(active)) : Promise.resolve()
    },

    abandon() {
      update(fileOpsAbandon(snapshot.state), null)
    },

    cancelOperation() {
      const active = snapshot.state
      if (!connected || active.phase !== "operating" || active.cancelPending) return Promise.resolve()
      stopRequest()
      generation += 1
      update(fileOpsBeginCancel(active), null)
      return exclusive((signal) => cancelBrowserOperation(active.operationId, signal), (operation) => {
        if (fileOpsAcceptOperation(snapshot.state, operation, generation, generation, "cancel")) {
          update(fileOpsReceiveOperation(snapshot.state, operation))
        }
      }, reportJobFailure)
    },

    retryPoll() {
      const next = fileOpsRetryPoll(snapshot.state)
      if (next === snapshot.state || request) return
      update(next, null)
      void poll()
    },

    reset() {
      const next = fileOpsReset(snapshot.state)
      if (next === snapshot.state) return
      stopRequest()
      generation += 1
      update(next, null)
    },
  }
}
