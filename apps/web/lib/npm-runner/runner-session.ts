import { ApiError } from "../api/response.ts"
import { initialRunnerState, isRunActive, runnerError, runnerEligibility, runnerFollowHref, buildRunRequest } from "./runner-policy.ts"
import { initialRunnerLogs, mergeRunnerLogs, needsLogDrain } from "./runner-log-view.ts"
import type { RunJob, RunLogPage, RunRequest, RunStart, RunnerContext } from "@/lib/api/types"
import type { RunnerSelection, RunnerState } from "@/lib/npm-runner/runner-policy"

export interface RunnerApi {
  context(path: string, signal: AbortSignal): Promise<RunnerContext>
  start(input: RunRequest, signal: AbortSignal): Promise<RunStart>
  latest(signal: AbortSignal): Promise<RunJob>
  get(id: string, signal: AbortSignal): Promise<RunJob>
  logs(id: string, cursor: number, signal: AbortSignal): Promise<RunLogPage>
  cancel(id: string, signal: AbortSignal): Promise<RunJob>
}
export interface RunnerClock {
  setTimeout(callback: () => void, delay: number): number
  clearTimeout(id: number): void
}
export interface RunnerVisibility {
  isVisible(): boolean
  subscribe(callback: () => void): () => void
}
export interface RunnerSessionOptions {
  api: RunnerApi
  clock: RunnerClock
  visibility: RunnerVisibility
  onChange(state: RunnerState): void
  onMutated(job: RunJob): void
  uuid?: () => string
}

export function createRunnerSession({ api, clock, visibility, onChange, onMutated, uuid = () => crypto.randomUUID() }: RunnerSessionOptions) {
  let state = initialRunnerState()
  let disposed = false
  let timer: number | null = null
  let pollRequest: AbortController | null = null
  let commandRequest: AbortController | null = null
  let latestRequest: AbortController | null = null
  let contextRequest: AbortController | null = null
  let pendingRecovery = false
  let pendingContext = false
  const mutated = new Set<string>()

  function publish(next: RunnerState) {
    if (disposed) return
    state = next
    onChange(state)
  }
  function active(controller: AbortController, generation: number): boolean {
    return !disposed && !controller.signal.aborted && generation === state.generation
  }
  function stopPoll() {
    if (timer !== null) clock.clearTimeout(timer)
    timer = null
    pollRequest?.abort()
  }
  function invalidate() {
    stopPoll()
    commandRequest?.abort()
    commandRequest = null
    latestRequest?.abort()
    contextRequest?.abort()
    contextRequest = null
    pendingRecovery = false
    pendingContext = false
    return state.generation + 1
  }
  function failPoll(cause: unknown) {
    const error = runnerError(cause)
    publish({ ...state, error, pollError: error.code, phase: error.statusCode === 404 ? "lost" : state.phase })
  }
  function checkJob(job: RunJob, id: string) {
    if (job.jobId !== id || (state.requestId !== null && job.requestId !== state.requestId)) {
      throw new ApiError(502, "Unexpected run response.", "INVALID_RESPONSE")
    }
  }
  function finishDrain() {
    if (state.job && state.job.status !== "running" && state.job.status !== "stopping" && !needsLogDrain(state.logs, state.job)) {
      publish({ ...state, phase: "idle" })
    }
  }
  function receiveJob(job: RunJob) {
    publish({ ...state, job, cancelPending: false, cancelUnknown: false, error: null, pollError: null })
    if (job.spawned && job.status !== "running" && job.status !== "stopping" && !mutated.has(job.jobId)) {
      mutated.add(job.jobId)
      // Context refresh is local metadata only. The caller refreshes its server
      // view; neither side starts a scan, analysis or another command here.
      pendingContext = true
      void refreshContext()
      onMutated(job)
    }
  }
  function canPoll(): boolean {
    return !disposed && visibility.isVisible() && state.phase === "tracking" && state.jobId !== null
      && !state.cancelPending && !state.pollError && !commandRequest
      && (!state.job || state.job.status === "running" || state.job.status === "stopping" || needsLogDrain(state.logs, state.job))
  }
  async function poll(): Promise<void> {
    if (pollRequest || !canPoll() || !state.jobId) return
    if (timer !== null) clock.clearTimeout(timer)
    timer = null
    const controller = new AbortController()
    const generation = state.generation
    const id = state.jobId
    const cursor = state.logs.cursor
    const needStatus = !state.job || state.job.status === "running" || state.job.status === "stopping"
    pollRequest = controller
    // Hold the slot until BOTH requests settle, including ignored aborts.
    const [status, output] = await Promise.allSettled([
      needStatus ? api.get(id, controller.signal) : Promise.resolve(null),
      api.logs(id, cursor, controller.signal),
    ])
    if (active(controller, generation) && state.jobId === id) {
      let failure: unknown = null
      if (status.status === "fulfilled" && status.value) {
        try { checkJob(status.value, id); receiveJob(status.value) } catch (cause) { failure = cause }
      } else if (status.status === "rejected") failure = status.reason
      if (output.status === "fulfilled") {
        try {
          const page = output.value
          if (page.jobId !== id || !Number.isSafeInteger(page.nextCursor) || page.nextCursor < cursor
            || page.nextCursor > page.endCursor || (!page.chunks.length && page.nextCursor < page.endCursor)) {
            throw new ApiError(502, "Unexpected log response.", "INVALID_RESPONSE")
          }
          publish({ ...state, logs: mergeRunnerLogs(state.logs, page) })
        } catch (cause) { failure ??= cause }
      } else failure ??= output.reason
      finishDrain()
      if (failure) failPoll(failure)
    }
    if (pollRequest === controller) pollRequest = null
    if (canPoll()) {
      if (controller.signal.aborted || generation !== state.generation) void poll()
      else timer = clock.setTimeout(() => { timer = null; void poll() }, 1000)
    }
  }

  async function refreshContext(): Promise<void> {
    if (disposed || !pendingContext || !state.requestPath || contextRequest || !visibility.isVisible()) return
    pendingContext = false
    const controller = new AbortController()
    const generation = state.generation
    const requestPath = state.requestPath
    contextRequest = controller
    publish({ ...state, refreshing: true })
    try {
      const context = await api.context(requestPath, controller.signal)
      if (!active(controller, generation) || contextRequest !== controller) return
      if (context.requestPath !== requestPath) throw new ApiError(502, "Unexpected context response.", "INVALID_RESPONSE")
      publish({ ...state, context, contextError: null })
    } catch (cause) {
      if (active(controller, generation) && contextRequest === controller) {
        publish({ ...state, context: null, contextError: runnerError(cause).code })
      }
    } finally {
      if (contextRequest === controller) {
        contextRequest = null
        if (active(controller, generation)) publish({ ...state, refreshing: latestRequest !== null })
      }
      if (!disposed && pendingContext && visibility.isVisible()) void refreshContext()
    }
  }
  function track(job: RunJob) {
    const sameJob = state.jobId === job.jobId
    publish({ ...state, phase: "tracking", jobId: job.jobId, requestId: job.requestId,
      logs: sameJob ? state.logs : initialRunnerLogs(job.jobId), error: null, pollError: null,
      startUnknown: false, cancelPending: false, cancelUnknown: false })
    receiveJob(job)
    finishDrain()
  }
  async function recoverLatest(): Promise<void> {
    if (disposed || !pendingRecovery || latestRequest || !visibility.isVisible()) return
    pendingRecovery = false
    const controller = new AbortController()
    const generation = state.generation
    const requestId = state.startUnknown ? state.requestId : null
    const requestPath = state.requestPath
    latestRequest = controller
    publish({ ...state, refreshing: true })
    try {
      const job = await api.latest(controller.signal)
      if (!active(controller, generation)) return
      if (requestId) {
        if (job.requestId === requestId && job.requestPath === requestPath) track(job)
        // A different retained job is no evidence about our ambiguous POST.
      } else if (isRunActive(job) || job.jobId === state.jobId) {
        if (job.requestPath === requestPath) track(job)
        else publish({ ...state, error: { code: "RUNNING", statusCode: 409,
          conflict: { reason: "RUNNING", jobId: job.jobId, requestPath: job.requestPath } } })
      } else if (state.error?.code === "RUNNING" || state.error?.code === "READERS_RUNNING") {
        publish({ ...state, error: null })
      }
    } catch (cause) {
      if (active(controller, generation)) {
        const error = runnerError(cause)
        if (error.statusCode === 404 && !requestId) publish({ ...state, error: null })
        else if (!requestId) publish({ ...state, error })
      }
    } finally {
      if (latestRequest === controller) latestRequest = null
      if (active(controller, generation)) {
        publish({ ...state, refreshing: contextRequest !== null })
        void poll()
      }
      if (!disposed && pendingRecovery && visibility.isVisible()) void recoverLatest()
    }
  }

  async function start(selection: RunnerSelection): Promise<void> {
    if (disposed || commandRequest || runnerEligibility(state, selection) || !state.context) return
    const requestId = uuid()
    const input = buildRunRequest(state.context, selection, requestId)
    const generation = invalidate()
    publish({ ...state, phase: "starting", generation, requestId, jobId: null, job: null,
      logs: initialRunnerLogs(), startUnknown: false, cancelUnknown: false, error: null, pollError: null })
    const controller = new AbortController()
    commandRequest = controller
    try {
      const started = await api.start(input, controller.signal)
      if (!active(controller, generation) || commandRequest !== controller) return
      if (!started.jobId || started.requestId !== requestId) throw new ApiError(502, "Unexpected start response.", "INVALID_RESPONSE")
      publish({ ...state, phase: "tracking", jobId: started.jobId, logs: initialRunnerLogs(started.jobId) })
    } catch (cause) {
      if (active(controller, generation) && commandRequest === controller) {
        const error = runnerError(cause)
        const startUnknown = error.statusCode === undefined || error.statusCode >= 500
        publish({ ...state, phase: "idle", error, startUnknown })
        if (startUnknown) { pendingRecovery = true; await recoverLatest() }
      }
    } finally {
      if (commandRequest === controller) commandRequest = null
      if (active(controller, generation)) void poll()
    }
  }
  async function cancel(): Promise<void> {
    // Job đã biết thì phải còn active (kể cả termination_failed/gateHeld); chưa có
    // status thì chỉ khi đang tracking. Job xong mà còn đọc nốt log thì không gửi cancel.
    if (disposed || commandRequest || !state.jobId || state.cancelPending
      || (state.job ? !isRunActive(state.job) : state.phase !== "tracking")) return
    const id = state.jobId
    // invalidate() huỷ cả lần đọc lại context đang chạy: ghi nhớ để đọc lại sau cleanup.
    const resumeContext = contextRequest !== null || pendingContext
    const generation = invalidate()
    publish({ ...state, generation, phase: "tracking", cancelPending: true, cancelUnknown: false, error: null, pollError: null,
      refreshing: false })
    const controller = new AbortController()
    commandRequest = controller
    try {
      const job = await api.cancel(id, controller.signal)
      if (!active(controller, generation) || commandRequest !== controller) return
      checkJob(job, id)
      receiveJob(job)
      finishDrain()
    } catch (cause) {
      if (active(controller, generation) && commandRequest === controller) {
        publish({ ...state, cancelPending: false, cancelUnknown: true })
        failPoll(cause)
      }
    } finally {
      if (commandRequest === controller) commandRequest = null
      if (active(controller, generation)) {
        if (resumeContext) { pendingContext = true; void refreshContext() }
        void poll()
      }
    }
  }
  function retryPoll() {
    if (disposed || commandRequest || state.cancelPending || state.phase === "lost" || !state.jobId) return
    publish({ ...state, phase: "tracking", error: null, pollError: null })
    void poll()
  }
  // Passing server context seeds/updates this screen. No arguments means an
  // explicit local-context/status refresh, including unknown-start recovery.
  async function refresh(context?: RunnerContext | null, requestPath = context?.requestPath ?? state.requestPath): Promise<void> {
    if (disposed) return
    if (context !== undefined) {
      const switched = state.requestPath !== requestPath
      if (switched) {
        const generation = invalidate()
        publish({ ...initialRunnerState(context), generation, requestPath })
        pendingRecovery = true
        await recoverLatest()
      } else publish({ ...state, context })
      return
    }
    pendingContext = true
    if (state.startUnknown || state.phase === "lost" || !state.jobId) pendingRecovery = true
    await Promise.all([refreshContext(), recoverLatest()])
    if (state.phase === "tracking" && state.pollError) retryPoll()
  }

  const unsubscribe = visibility.subscribe(() => {
    if (disposed) return
    if (!visibility.isVisible()) {
      stopPoll()
      if (latestRequest) { pendingRecovery = true; latestRequest.abort() }
      if (contextRequest) { pendingContext = true; contextRequest.abort() }
    } else {
      void recoverLatest()
      void refreshContext()
      void poll()
    }
  })
  function dispose() {
    if (disposed) return
    disposed = true
    invalidate()
    unsubscribe()
  }
  return { start, cancel, retryPoll, refresh,
    follow: () => state.error?.conflict ? runnerFollowHref(state.error.conflict) : null,
    dispose, getSnapshot: () => state }
}
export type RunnerSession = ReturnType<typeof createRunnerSession>
