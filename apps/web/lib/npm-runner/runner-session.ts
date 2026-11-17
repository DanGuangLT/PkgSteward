import { ApiError } from "../api/response.ts"
import {
  buildRunRequest,
  initialRunnerState,
  isLatestRecoveryHold,
  isRunActive,
  runnerEligibility,
  runnerError,
  runnerFollowHref,
} from "./runner-policy.ts"
import { initialRunnerLogs, mergeRunnerLogs, needsLogDrain } from "./runner-log-view.ts"
import {
  clampTerminalSize,
  initialTerminalClientState,
  initialTerminalOutput,
  isValidTerminalInputText,
  mergeTerminalOutput,
  needsTerminalOutputDrain,
} from "./terminal-session.ts"
import type {
  RecoveryClearRequest,
  RecoveryClearResult,
  RunJob,
  RunLatestResult,
  RunLogPage,
  RunRequest,
  RunStart,
  RunnerContext,
  TerminalClaimRequest,
  TerminalInputAck,
  TerminalInputAckRequest,
  TerminalInputRequest,
  TerminalOutputPage,
  TerminalResizeRequest,
  TerminalResizeResult,
  TerminalWriter,
} from "@/lib/api/types"
import type { RunnerSelection, RunnerState } from "@/lib/npm-runner/runner-policy"
import type { TerminalClientState } from "@/lib/npm-runner/terminal-session"

const RESIZE_COALESCE_MS = 60

export interface RunnerApi {
  context(path: string, signal: AbortSignal): Promise<RunnerContext>
  start(input: RunRequest, signal: AbortSignal): Promise<RunStart>
  latest(signal: AbortSignal): Promise<RunLatestResult>
  clearRecovery?(input: RecoveryClearRequest, signal: AbortSignal): Promise<RecoveryClearResult>
  get(id: string, signal: AbortSignal): Promise<RunJob>
  logs(id: string, cursor: number, signal: AbortSignal): Promise<RunLogPage>
  cancel(id: string, signal: AbortSignal): Promise<RunJob>
  terminalOutput?(id: string, generation: number, cursor: number, signal: AbortSignal): Promise<TerminalOutputPage>
  claimTerminal?(id: string, input: TerminalClaimRequest, signal: AbortSignal): Promise<TerminalWriter>
  terminalInput?(id: string, input: TerminalInputRequest, signal: AbortSignal): Promise<TerminalInputAck>
  terminalInputAck?(id: string, input: TerminalInputAckRequest, signal: AbortSignal): Promise<TerminalInputAck>
  resizeTerminal?(id: string, input: TerminalResizeRequest, signal: AbortSignal): Promise<TerminalResizeResult>
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
  const tabId = uuid()
  let state = initialRunnerState(null, tabId)
  let disposed = false
  let recoveredOnce = false
  let timer: number | null = null
  let pollRequest: AbortController | null = null
  let commandRequest: AbortController | null = null
  let latestRequest: AbortController | null = null
  let contextRequest: AbortController | null = null
  let claimRequest: AbortController | null = null
  let inputRequest: AbortController | null = null
  let resizeRequest: AbortController | null = null
  let resizeTimer: number | null = null
  let pendingResize: { cols: number; rows: number } | null = null
  let pendingRecovery = false
  let pendingContext = false
  const mutated = new Set<string>()

  function resetTerminal(jobId: string | null = null, generation = 0): TerminalClientState {
    return {
      ...initialTerminalClientState(tabId, jobId, generation),
      cols: state.terminal.cols,
      rows: state.terminal.rows,
    }
  }
  function abortTerminalRequests() {
    claimRequest?.abort()
    claimRequest = null
    inputRequest?.abort()
    inputRequest = null
    if (resizeTimer !== null) {
      clock.clearTimeout(resizeTimer)
      resizeTimer = null
    }
    resizeRequest?.abort()
    resizeRequest = null
    pendingResize = null
  }
  function syncTerminalMeta(prev: TerminalClientState, job: RunJob): TerminalClientState {
    const meta = job.terminal
    if (!meta?.available) return prev
    if (prev.jobId !== job.jobId || prev.generation !== meta.generation) {
      return {
        ...initialTerminalClientState(tabId, job.jobId, meta.generation),
        cols: prev.cols,
        rows: prev.rows,
        inputUnknown: Boolean(meta.inputBlocked),
      }
    }
    const writerSuperseded = prev.writer !== null
      && meta.writerGeneration !== null
      && meta.writerGeneration !== prev.writer.writerGeneration
    if (!writerSuperseded) return prev
    return {
      ...prev,
      writer: null,
      claimError: "WRITER_SUPERSEDED",
    }
  }
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
    abortTerminalRequests()
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
    if (state.job && state.job.status !== "running" && state.job.status !== "stopping"
      && !needsLogDrain(state.logs, state.job)
      && !needsTerminalOutputDrain(state.terminal.output, state.job)) {
      publish({ ...state, phase: "idle" })
    }
  }
  function receiveJob(job: RunJob) {
    const terminal = syncTerminalMeta(state.terminal, job)
    const nextHold = job.recoveryHold !== undefined
      ? (job.recoveryHold?.active ? job.recoveryHold : null)
      : state.recoveryHold
    publish({
      ...state,
      job,
      recoveryHold: nextHold,
      terminal,
      cancelPending: false,
      cancelUnknown: false,
      error: null,
      pollError: null,
    })
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
      && (!state.job
        || state.job.status === "running"
        || state.job.status === "stopping"
        || needsLogDrain(state.logs, state.job)
        || needsTerminalOutputDrain(state.terminal.output, state.job))
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
    const termMeta = state.job?.terminal
    const needTerminalOutput = Boolean(
      api.terminalOutput
      && termMeta?.available
      && termMeta.generation >= 1
      && (needStatus || needsTerminalOutputDrain(state.terminal.output, state.job)),
    )
    const termGeneration = termMeta?.generation ?? 0
    const termCursor = state.terminal.output.generation === termGeneration ? state.terminal.output.cursor : 0
    pollRequest = controller
    // Hold the slot until all parallel poll requests settle, including ignored aborts.
    const [status, output, termOutput] = await Promise.allSettled([
      needStatus ? api.get(id, controller.signal) : Promise.resolve(null),
      api.logs(id, cursor, controller.signal),
      needTerminalOutput && api.terminalOutput
        ? api.terminalOutput(id, termGeneration, termCursor, controller.signal)
        : Promise.resolve(null),
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
      if (termOutput.status === "fulfilled" && termOutput.value) {
        try {
          const baseOutput = state.terminal.output.jobId === id && state.terminal.output.generation === termGeneration
            ? state.terminal.output
            : initialTerminalOutput(id, termGeneration)
          publish({
            ...state,
            terminal: { ...state.terminal, output: mergeTerminalOutput(baseOutput, termOutput.value) },
          })
        } catch (cause) { failure ??= cause }
      } else if (termOutput.status === "rejected") failure ??= termOutput.reason
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
      const nextHold = context.recoveryHold !== undefined
        ? (context.recoveryHold?.active ? context.recoveryHold : null)
        : state.recoveryHold
      publish({ ...state, context, recoveryHold: nextHold, contextError: null })
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
      logs: sameJob ? state.logs : initialRunnerLogs(job.jobId),
      terminal: sameJob ? state.terminal : resetTerminal(job.jobId, job.terminal?.generation ?? 0),
      error: null, pollError: null,
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
      const latest = await api.latest(controller.signal)
      if (!active(controller, generation)) return
      if (isLatestRecoveryHold(latest)) {
        const nextHold = latest.recoveryHold.active ? latest.recoveryHold : null
        publish({
          ...state,
          recoveryHold: nextHold,
          job: nextHold && state.job?.recoveryHold?.active === false ? null : state.job,
          error: state.error?.code === "RUNNING" || state.error?.code === "READERS_RUNNING" ? null : state.error,
        })
        return
      }
      const job = latest
      if (job.recoveryHold?.active) {
        publish({ ...state, recoveryHold: job.recoveryHold })
      }
      if (requestId) {
        if (job.requestId === requestId && job.requestPath === requestPath) track(job)
        // A different retained job is no evidence about our ambiguous POST.
      } else if (isRunActive(job) || job.jobId === state.jobId) {
        if (job.requestPath === requestPath) track(job)
        else publish({ ...state, error: { code: "RUNNING", statusCode: 409,
          conflict: { reason: "RUNNING", jobId: job.jobId, requestPath: job.requestPath } } })
      } else if (state.error?.code === "RUNNING" || state.error?.code === "READERS_RUNNING" || state.error?.code === "RECOVERY_HOLD") {
        publish({ ...state, error: null, recoveryHold: state.context?.recoveryHold?.active ? state.context.recoveryHold : null })
      }
    } catch (cause) {
      if (active(controller, generation)) {
        const error = runnerError(cause)
        if (error.statusCode === 404 && !requestId) {
          publish({
            ...state,
            recoveryHold: state.context?.recoveryHold?.active ? state.context.recoveryHold : null,
            error: null,
          })
        }
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
      logs: initialRunnerLogs(), terminal: resetTerminal(), startUnknown: false, cancelUnknown: false, error: null, pollError: null })
    const controller = new AbortController()
    commandRequest = controller
    try {
      const started = await api.start(input, controller.signal)
      if (!active(controller, generation) || commandRequest !== controller) return
      if (!started.jobId || started.requestId !== requestId) throw new ApiError(502, "Unexpected start response.", "INVALID_RESPONSE")
      publish({ ...state, phase: "tracking", jobId: started.jobId, logs: initialRunnerLogs(started.jobId), terminal: resetTerminal(started.jobId, 0) })
    } catch (cause) {
      if (active(controller, generation) && commandRequest === controller) {
        const error = runnerError(cause)
        const startUnknown = error.statusCode === undefined || error.statusCode >= 500
        publish({
          ...state,
          phase: "idle",
          error,
          recoveryHold: error.recoveryHold?.active ? error.recoveryHold : state.recoveryHold,
          startUnknown,
        })
        if (startUnknown) { pendingRecovery = true; await recoverLatest() }
      }
    } finally {
      if (commandRequest === controller) commandRequest = null
      if (active(controller, generation)) void poll()
    }
  }
  async function clearRecovery(): Promise<void> {
    if (disposed || commandRequest || state.clearPending || !api.clearRecovery) return
    const controller = new AbortController()
    const generation = state.generation
    commandRequest = controller
    publish({ ...state, clearPending: true, error: null })
    try {
      const result = await api.clearRecovery({ confirm: true }, controller.signal)
      if (!active(controller, generation) || commandRequest !== controller) return
      const nextHold = result.recoveryHold?.active ? result.recoveryHold : null
      const nextContext = state.context && nextHold === null && state.context.recoveryHold?.active
        ? { ...state.context, recoveryHold: null }
        : state.context
      const nextJob = state.job && nextHold === null && state.job.recoveryHold?.active
        ? { ...state.job, gateHeld: false, recoveryHold: null }
        : state.job
      publish({ ...state, clearPending: false, recoveryHold: nextHold, context: nextContext, job: nextJob, error: null })
      if (result.cleared) {
        if (state.requestPath) pendingContext = true
        pendingRecovery = true
        await Promise.all([refreshContext(), recoverLatest()])
      }
    } catch (cause) {
      if (active(controller, generation) && commandRequest === controller) {
        const error = runnerError(cause)
        publish({
          ...state,
          clearPending: false,
          recoveryHold: error.recoveryHold?.active ? error.recoveryHold : state.recoveryHold,
          error,
        })
      }
    } finally {
      if (commandRequest === controller) commandRequest = null
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
        recoveredOnce = true
        const generation = invalidate()
        publish({ ...initialRunnerState(context, tabId), generation, requestPath, terminal: resetTerminal() })
        pendingRecovery = true
        await recoverLatest()
      } else publish({ ...state, context })
      return
    }
    recoveredOnce = true
    pendingContext = true
    if (state.startUnknown || state.phase === "lost" || !state.jobId) pendingRecovery = true
    await Promise.all([refreshContext(), recoverLatest()])
    if (state.phase === "tracking" && state.pollError) retryPoll()
  }
  function hasBusyRun(): boolean {
    if (state.phase === "starting" || state.startUnknown || state.cancelUnknown) return true
    if (state.jobId === null) return false
    if (!state.job) return state.phase === "tracking"
    return isRunActive(state.job)
      || state.phase === "tracking"
      || needsLogDrain(state.logs, state.job)
      || needsTerminalOutputDrain(state.terminal.output, state.job)
  }
  function syncProjectContext(context: RunnerContext | null, nextRequestPath = context?.requestPath ?? null): void {
    if (disposed) return
    const switched = state.requestPath !== nextRequestPath
    if (!switched && state.context === context && recoveredOnce) return
    if (contextRequest && switched) {
      contextRequest.abort()
      contextRequest = null
    }
    pendingContext = false
    const busy = hasBusyRun()
    const nextError = busy ? state.error : (state.error?.code === "RUNNING" ? null : state.error)
    const nextHold = context !== null
      ? (context.recoveryHold !== undefined
          ? (context.recoveryHold?.active ? context.recoveryHold : (state.job?.recoveryHold?.active ? state.job.recoveryHold : null))
          : state.recoveryHold)
      : state.recoveryHold
    publish({
      ...state,
      context,
      requestPath: nextRequestPath,
      recoveryHold: nextHold,
      contextError: null,
      error: nextError,
    })
    if (!busy && (!recoveredOnce || (switched && !state.jobId))) {
      recoveredOnce = true
      pendingRecovery = true
      void recoverLatest()
    }
  }
  async function flushResize(): Promise<void> {
    if (disposed || resizeRequest || !pendingResize || !api.resizeTerminal) return
    const nextSize = pendingResize
    const jobId = state.jobId
    const requestId = state.requestId
    const termMeta = state.job?.terminal
    const writer = state.terminal.writer
    if (!jobId || !requestId || state.job?.status !== "running" || !termMeta?.available || !termMeta.ready || !writer) {
      pendingResize = null
      return
    }
    pendingResize = null
    const controller = new AbortController()
    const generation = state.generation
    const termGeneration = termMeta.generation
    resizeRequest = controller
    try {
      await api.resizeTerminal(jobId, {
        requestId,
        generation: termGeneration,
        tabId,
        token: writer.token,
        writerGeneration: writer.writerGeneration,
        cols: nextSize.cols,
        rows: nextSize.rows,
      }, controller.signal)
      if (!active(controller, generation) || resizeRequest !== controller) return
      publish({ ...state, terminal: { ...state.terminal, resizeError: null } })
    } catch (cause) {
      if (active(controller, generation) && resizeRequest === controller) {
        const err = runnerError(cause)
        const stale = err.terminalCode === "STALE_WRITER"
        publish({
          ...state,
          terminal: {
            ...state.terminal,
            writer: stale ? null : state.terminal.writer,
            claimError: stale ? "STALE_WRITER" : state.terminal.claimError,
            resizeError: err.terminalCode ?? err.code,
          },
        })
      }
    } finally {
      if (resizeRequest === controller) resizeRequest = null
      if (!disposed && pendingResize && state.terminal.writer && resizeTimer === null) {
        resizeTimer = clock.setTimeout(() => { resizeTimer = null; void flushResize() }, RESIZE_COALESCE_MS)
      }
    }
  }
  function resizeTerminal(cols: number, rows: number): void {
    if (disposed) return
    const clamped = clampTerminalSize(cols, rows)
    if (!clamped) return
    if (state.terminal.cols !== clamped.cols || state.terminal.rows !== clamped.rows) {
      publish({ ...state, terminal: { ...state.terminal, cols: clamped.cols, rows: clamped.rows } })
    }
    const termMeta = state.job?.terminal
    if (!api.resizeTerminal || !state.jobId || !state.requestId || state.job?.status !== "running"
      || !termMeta?.available || !termMeta.ready || !state.terminal.writer) {
      return
    }
    pendingResize = clamped
    if (resizeTimer === null && !resizeRequest) {
      resizeTimer = clock.setTimeout(() => { resizeTimer = null; void flushResize() }, RESIZE_COALESCE_MS)
    }
  }
  async function claimTerminal(takeover = false): Promise<void> {
    if (disposed || !api.claimTerminal || claimRequest) return
    const jobId = state.jobId
    const requestId = state.requestId
    const termMeta = state.job?.terminal
    if (!jobId || !requestId || state.job?.status !== "running" || !termMeta?.available || !termMeta.ready) return
    if (!takeover && state.terminal.writer) return
    if (takeover && (state.terminal.inputUnknown || termMeta.inputBlocked)) {
      publish({ ...state, terminal: { ...state.terminal, claimError: "INPUT_UNKNOWN" } })
      return
    }
    const controller = new AbortController()
    const generation = state.generation
    const termGeneration = termMeta.generation
    claimRequest = controller
    publish({ ...state, terminal: { ...state.terminal, claiming: true, claimError: null } })
    try {
      const writer = await api.claimTerminal(jobId, {
        requestId,
        generation: termGeneration,
        tabId,
        takeover,
      }, controller.signal)
      if (!active(controller, generation) || claimRequest !== controller || state.jobId !== jobId) return
      publish({
        ...state,
        terminal: {
          ...state.terminal,
          writer,
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
          resizeError: null,
        },
      })
      if (state.terminal.cols !== null && state.terminal.rows !== null) {
        pendingResize = { cols: state.terminal.cols, rows: state.terminal.rows }
        if (resizeTimer === null && !resizeRequest) {
          resizeTimer = clock.setTimeout(() => { resizeTimer = null; void flushResize() }, RESIZE_COALESCE_MS)
        }
      }
    } catch (cause) {
      if (active(controller, generation) && claimRequest === controller) {
        const err = runnerError(cause)
        const code = err.terminalCode ?? err.code
        publish({
          ...state,
          terminal: {
            ...state.terminal,
            claiming: false,
            claimError: code,
            inputUnknown: state.terminal.inputUnknown || code === "INPUT_UNKNOWN",
          },
        })
      }
    } finally {
      if (claimRequest === controller) claimRequest = null
    }
  }
  async function sendTerminalInput(text: string): Promise<void> {
    if (disposed || !api.terminalInput || inputRequest || state.terminal.inputPending) return
    const jobId = state.jobId
    const requestId = state.requestId
    const termMeta = state.job?.terminal
    const writer = state.terminal.writer
    if (!jobId || !requestId || state.job?.status !== "running" || !termMeta?.available || !termMeta.ready || !writer) return
    if (state.terminal.inputUnknown || termMeta.inputBlocked) return
    if (!isValidTerminalInputText(text)) {
      publish({ ...state, terminal: { ...state.terminal, inputError: "INVALID_INPUT" } })
      return
    }
    const sequence = state.terminal.nextSequence
    const controller = new AbortController()
    const generation = state.generation
    const termGeneration = termMeta.generation
    inputRequest = controller
    publish({
      ...state,
      terminal: {
        ...state.terminal,
        nextSequence: sequence + 1,
        pendingSequence: sequence,
        pendingText: text,
        inputPending: true,
        inputStatus: "pending",
        inputError: null,
      },
    })
    try {
      const ack = await api.terminalInput(jobId, {
        requestId,
        generation: termGeneration,
        tabId,
        token: writer.token,
        writerGeneration: writer.writerGeneration,
        sequence,
        text,
      }, controller.signal)
      if (!active(controller, generation) || inputRequest !== controller || state.jobId !== jobId) return
      if (ack.status === "delivered") {
        publish({
          ...state,
          terminal: {
            ...state.terminal,
            inputPending: false,
            inputUnknown: false,
            pendingSequence: null,
            pendingText: null,
            lastInputAck: ack,
            inputStatus: "delivered",
            inputError: null,
          },
        })
      } else if (ack.status === "not_delivered") {
        publish({
          ...state,
          terminal: {
            ...state.terminal,
            inputPending: false,
            inputUnknown: false,
            pendingSequence: null,
            pendingText: null,
            lastInputAck: ack,
            inputStatus: "not_delivered",
            inputError: "INPUT_NOT_DELIVERED",
          },
        })
      } else {
        publish({
          ...state,
          terminal: {
            ...state.terminal,
            inputPending: false,
            inputUnknown: true,
            lastInputAck: ack,
            inputStatus: ack.status,
            inputError: "INPUT_UNKNOWN",
          },
        })
      }
    } catch (cause) {
      if (active(controller, generation) && inputRequest === controller) {
        const err = runnerError(cause)
        const code = err.terminalCode ?? err.code
        if (code === "STALE_WRITER") {
          publish({
            ...state,
            terminal: {
              ...state.terminal,
              writer: null,
              inputPending: false,
              pendingSequence: null,
              pendingText: null,
              claimError: "STALE_WRITER",
              inputError: "STALE_WRITER",
            },
          })
        } else if (err.statusCode === undefined || err.statusCode >= 500 || code === "INPUT_UNKNOWN") {
          publish({
            ...state,
            terminal: {
              ...state.terminal,
              inputPending: false,
              inputUnknown: true,
              inputStatus: "unknown",
              inputError: code,
            },
          })
        } else {
          publish({
            ...state,
            terminal: {
              ...state.terminal,
              inputPending: false,
              inputUnknown: false,
              pendingSequence: null,
              pendingText: null,
              inputStatus: "not_delivered",
              inputError: code,
            },
          })
        }
      }
    } finally {
      if (inputRequest === controller) inputRequest = null
    }
  }
  async function reconcileTerminalInput(): Promise<void> {
    if (disposed || !api.terminalInputAck || inputRequest) return
    const jobId = state.jobId
    const requestId = state.requestId
    const termMeta = state.job?.terminal
    const writer = state.terminal.writer
    const sequence = state.terminal.pendingSequence
    if (!jobId || !requestId || !termMeta?.available || !writer || sequence === null) return
    const controller = new AbortController()
    const generation = state.generation
    const termGeneration = termMeta.generation
    inputRequest = controller
    publish({ ...state, terminal: { ...state.terminal, inputPending: true } })
    try {
      const ack = await api.terminalInputAck(jobId, {
        requestId,
        generation: termGeneration,
        tabId,
        token: writer.token,
        writerGeneration: writer.writerGeneration,
        sequence,
      }, controller.signal)
      if (!active(controller, generation) || inputRequest !== controller || state.jobId !== jobId) return
      if (ack.status === "delivered" || ack.status === "not_delivered") {
        publish({
          ...state,
          terminal: {
            ...state.terminal,
            inputPending: false,
            inputUnknown: false,
            pendingSequence: null,
            pendingText: null,
            lastInputAck: ack,
            inputStatus: ack.status,
            inputError: ack.status === "not_delivered" ? "INPUT_NOT_DELIVERED" : null,
          },
        })
      } else {
        publish({
          ...state,
          terminal: {
            ...state.terminal,
            inputPending: false,
            inputUnknown: true,
            lastInputAck: ack,
            inputStatus: ack.status,
            inputError: "INPUT_UNKNOWN",
          },
        })
      }
    } catch (cause) {
      if (active(controller, generation) && inputRequest === controller) {
        const err = runnerError(cause)
        const code = err.terminalCode ?? err.code
        if (err.statusCode === 404 && code === "ACK_NOT_FOUND") {
          publish({
            ...state,
            terminal: {
              ...state.terminal,
              inputPending: false,
              inputUnknown: false,
              pendingSequence: null,
              pendingText: null,
              inputStatus: "not_delivered",
              inputError: "ACK_NOT_FOUND",
            },
          })
        } else if (code === "STALE_WRITER") {
          publish({
            ...state,
            terminal: {
              ...state.terminal,
              writer: null,
              inputPending: false,
              claimError: "STALE_WRITER",
              inputError: "STALE_WRITER",
            },
          })
        } else {
          publish({
            ...state,
            terminal: {
              ...state.terminal,
              inputPending: false,
              inputError: code,
            },
          })
        }
      }
    } finally {
      if (inputRequest === controller) inputRequest = null
    }
  }
  function clearTerminalOutput(): void {
    if (disposed) return
    publish({
      ...state,
      logs: { ...state.logs, chunks: [] },
      terminal: {
        ...state.terminal,
        output: {
          ...state.terminal.output,
          chunks: [],
          totalBytes: 0,
          localDroppedBytes: 0,
          resetRevision: state.terminal.output.resetRevision + 1,
        },
      },
    })
  }
  function dismissCompletedJob(): void {
    if (disposed || hasBusyRun()) return
    publish({
      ...state,
      jobId: null,
      requestId: null,
      job: null,
      logs: initialRunnerLogs(),
      terminal: resetTerminal(),
      error: null,
      pollError: null,
    })
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
  return { start, cancel, clearRecovery, retryPoll, refresh, syncProjectContext, claimTerminal, sendTerminalInput,
    reconcileTerminalInput, resizeTerminal, clearTerminalOutput, dismissCompletedJob,
    follow: () => state.error?.conflict ? runnerFollowHref(state.error.conflict) : null,
    dispose, getSnapshot: () => state }
}
export type RunnerSession = ReturnType<typeof createRunnerSession>
