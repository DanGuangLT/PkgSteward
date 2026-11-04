import { ApiError } from "../api/response.ts"
import { isRunActive } from "../npm-runner/runner-policy.ts"
import { initialRunnerLogs, mergeRunnerLogs, needsLogDrain } from "../npm-runner/runner-log-view.ts"
import { globalError } from "./global-types.ts"
import {
  initialGlobalPreviewForm, changeGlobalSelection, displayGlobalPreview, setGlobalConsent,
  clearGlobalPreview, globalConsentError, buildGlobalExecuteInput,
} from "./global-preview-form.ts"
import type {
  GlobalActivityRequest, GlobalError, GlobalExecuteRequest, GlobalJob, GlobalJobStart, GlobalLogPage,
  GlobalJobKind, GlobalPreviewRequest, GlobalSnapshot, GlobalVersionsRequest,
} from "@/lib/global-packages/global-types"
import type { GlobalConsent, GlobalPreviewForm, GlobalSelection } from "@/lib/global-packages/global-preview-form"
import type { RunnerClock, RunnerVisibility } from "@/lib/npm-runner/runner-session"
import type { RunnerLogs } from "@/lib/npm-runner/runner-log-view"

export interface GlobalApi {
  snapshot(signal: AbortSignal): Promise<GlobalSnapshot | null>
  inventory(input: GlobalActivityRequest, signal: AbortSignal): Promise<GlobalJobStart>
  versions(input: GlobalVersionsRequest, signal: AbortSignal): Promise<GlobalJobStart>
  preview(input: GlobalPreviewRequest, signal: AbortSignal): Promise<GlobalJobStart>
  execute(input: GlobalExecuteRequest, signal: AbortSignal): Promise<GlobalJobStart>
  latest(signal: AbortSignal): Promise<GlobalJob | null>
  get(id: string, signal: AbortSignal): Promise<GlobalJob>
  logs(id: string, cursor: number, signal: AbortSignal): Promise<GlobalLogPage>
  cancel(id: string, signal: AbortSignal): Promise<GlobalJob>
}
export interface GlobalClock extends RunnerClock { now(): number }
export interface GlobalState {
  phase: "idle" | "starting" | "tracking" | "lost"
  generation: number
  snapshot: GlobalSnapshot | null
  snapshotError: string | null
  requestId: string | null
  previewId: string | null
  jobId: string | null
  job: GlobalJob | null
  logs: RunnerLogs
  form: GlobalPreviewForm
  error: GlobalError | null
  pollError: string | null
  startUnknown: boolean
  cancelUnknown: boolean
  cancelPending: boolean
  refreshing: boolean
}
export interface GlobalSessionOptions {
  api: GlobalApi
  clock: GlobalClock
  visibility: RunnerVisibility
  onChange(state: GlobalState): void
  onMutated(job: GlobalJob): void
  uuid?: () => string
}
export interface GlobalSession {
  inventory(): Promise<void>
  loadVersions(input: Pick<GlobalVersionsRequest, "manager" | "package">): Promise<void>
  preview(selection: GlobalSelection): Promise<void>
  execute(): Promise<void>
  select(selection: GlobalSelection): void
  consent(input: Partial<GlobalConsent>): void
  cancel(): Promise<void>
  retryPoll(): void
  refresh(snapshot?: GlobalSnapshot | null, latest?: GlobalJob | null): Promise<void>
  dispose(): void
  getSnapshot(): GlobalState
}

export function initialGlobalState(snapshot: GlobalSnapshot | null = null): GlobalState {
  return { phase: "idle", generation: 0, snapshot, snapshotError: null, requestId: null, previewId: null,
    jobId: null, job: null, logs: initialRunnerLogs(), form: initialGlobalPreviewForm(), error: null,
    pollError: null, startUnknown: false, cancelUnknown: false, cancelPending: false, refreshing: false }
}
export function createGlobalSession({ api, clock, visibility, onChange, onMutated, uuid = () => crypto.randomUUID() }: GlobalSessionOptions): GlobalSession {
  let state = initialGlobalState()
  let disposed = false
  let timer: number | null = null
  let pollRequest: AbortController | null = null
  let commandRequest: AbortController | null = null
  let commandKind: "start" | "cancel" | null = null
  let latestRequest: AbortController | null = null
  let snapshotRequest: AbortController | null = null
  let pendingRecovery = false
  let pendingSnapshot = false
  let requestKind: GlobalJobKind | null = null
  let selectionVersion = 0
  let previewSelectionVersion = 0
  let displayedPreviewJob: string | null = null
  let notifiedMutation: string | null = null
  let refreshedJob: string | null = null

  function publish(next: GlobalState) {
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
  function invalidate(): number {
    stopPoll()
    commandRequest?.abort()
    commandRequest = null
    commandKind = null
    latestRequest?.abort()
    snapshotRequest?.abort()
    pendingRecovery = false
    pendingSnapshot = false
    return state.generation + 1
  }
  function invalidResponse(): never {
    throw new ApiError(502, "Unexpected global activity response.", "INVALID_RESPONSE")
  }
  function checkJob(job: GlobalJob, id: string) {
    if (job.jobId !== id || (state.requestId !== null && job.requestId !== state.requestId)
      || (state.previewId !== null && job.previewId !== state.previewId)
      || (requestKind !== null && job.kind !== requestKind)
      || !Number.isSafeInteger(job.endCursor) || job.endCursor < 0) invalidResponse()
  }
  function finishDrain() {
    if (state.job && state.job.status !== "running" && state.job.status !== "stopping" && !needsLogDrain(state.logs, state.job)) {
      publish({ ...state, phase: "idle" })
    }
  }
  function matchesSelection(preview: NonNullable<GlobalJob["preview"]>): boolean {
    const selection = state.form.selection
    return previewSelectionVersion === selectionVersion && selection.manager === preview.manager
      && selection.package === preview.package && selection.action === preview.action
      && (selection.targetVersion ?? null) === preview.requestedVersion
  }
  function receiveJob(job: GlobalJob) {
    const generation = state.generation
    let form = state.form
    if (job.kind === "preview" && job.status === "completed" && job.preview && displayedPreviewJob !== job.jobId) {
      if (job.preview.previewId !== job.previewId) invalidResponse()
      displayedPreviewJob = job.jobId
      if (matchesSelection(job.preview)) form = displayGlobalPreview(form, job.preview)
    }
    const changedMutation = job.mutationSpawned && (!state.job || state.job.jobId !== job.jobId || !state.job.mutationSpawned
      || state.job.gateHeld !== job.gateHeld || state.job.refreshRequired !== job.refreshRequired)
    const snapshot = changedMutation && state.snapshot ? { ...state.snapshot, stale: true } : state.snapshot
    publish({ ...state, job, previewId: job.previewId, form, snapshot, cancelPending: false, cancelUnknown: false, error: null, pollError: null })
    if (disposed || generation !== state.generation) return
    const terminal = job.status !== "running" && job.status !== "stopping"
    if (terminal && (job.kind === "inventory" || job.mutationSpawned)) {
      const key = `${job.jobId}:${job.gateHeld}:${job.refreshRequired}`
      if (refreshedJob !== key) {
        refreshedJob = key
        pendingSnapshot = true
        void refreshSnapshot()
      }
    }
    if (terminal && job.mutationSpawned && notifiedMutation !== job.jobId) {
      notifiedMutation = job.jobId
      onMutated(job)
    }
  }
  function canPoll(): boolean {
    return !disposed && visibility.isVisible() && state.phase === "tracking" && state.jobId !== null
      && !state.cancelPending && !state.pollError && (!commandRequest || (commandKind === "start" && state.job !== null))
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
    // Keep this slot until both reads settle, even when abort is ignored.
    const [status, output] = await Promise.allSettled([
      needStatus ? api.get(id, controller.signal) : Promise.resolve(null),
      api.logs(id, cursor, controller.signal),
    ])
    if (active(controller, generation) && state.jobId === id) {
      let failure: unknown = null
      if (status.status === "fulfilled" && status.value) {
        try { checkJob(status.value, id); receiveJob(status.value) } catch (cause) { failure = cause }
      } else if (status.status === "rejected") failure = status.reason
      if (active(controller, generation) && state.jobId === id && output.status === "fulfilled") {
        try {
          const page = output.value
          if (page.jobId !== id || !Number.isSafeInteger(page.nextCursor) || !Number.isSafeInteger(page.endCursor)
            || !Number.isSafeInteger(page.firstCursor) || page.firstCursor < 0 || page.nextCursor < cursor
            || page.firstCursor > page.nextCursor || page.nextCursor > page.endCursor
            || (!page.chunks.length && page.nextCursor < page.endCursor)) invalidResponse()
          publish({ ...state, logs: mergeRunnerLogs(state.logs, page) })
        } catch (cause) { failure ??= cause }
      } else if (output.status === "rejected") failure ??= output.reason
      if (active(controller, generation) && state.jobId === id) finishDrain()
      if (failure && active(controller, generation) && state.jobId === id) {
        const error = globalError(failure)
        publish({ ...state, error, pollError: error.code, phase: error.statusCode === 404 ? "lost" : state.phase })
      }
    }
    if (pollRequest === controller) pollRequest = null
    if (canPoll()) {
      if (controller.signal.aborted || generation !== state.generation) void poll()
      else {
        const scheduled = clock.setTimeout(() => {
          if (timer !== scheduled) return
          timer = null
          if (active(controller, generation)) void poll()
        }, 1000)
        timer = scheduled
      }
    }
  }
  async function refreshSnapshot(): Promise<void> {
    if (disposed || !pendingSnapshot || snapshotRequest || !visibility.isVisible()) return
    pendingSnapshot = false
    const controller = new AbortController()
    const generation = state.generation
    snapshotRequest = controller
    publish({ ...state, refreshing: true })
    try {
      const snapshot = await api.snapshot(controller.signal)
      if (active(controller, generation)) {
        publish({ ...state, snapshot: snapshot && state.job?.mutationSpawned && isRunActive(state.job)
          ? { ...snapshot, stale: true } : snapshot, snapshotError: null })
      }
    } catch (cause) {
      if (active(controller, generation)) publish({ ...state, snapshot: state.snapshot ? { ...state.snapshot, stale: true } : null,
        snapshotError: globalError(cause).code })
    } finally {
      if (snapshotRequest === controller) snapshotRequest = null
      if (active(controller, generation)) publish({ ...state, refreshing: latestRequest !== null })
      if (!disposed && pendingSnapshot && visibility.isVisible()) void refreshSnapshot()
    }
  }
  function track(job: GlobalJob) {
    const sameJob = state.jobId === job.jobId
    const generation = state.jobId !== null && !sameJob ? invalidate() : state.generation
    requestKind = job.kind
    publish({ ...state, generation, phase: "tracking", jobId: job.jobId, requestId: job.requestId, previewId: job.previewId,
      logs: sameJob ? state.logs : initialRunnerLogs(job.jobId), error: null, pollError: null,
      startUnknown: false, cancelPending: false, cancelUnknown: false, refreshing: generation === state.generation ? state.refreshing : false,
      form: job.kind === "mutation" ? clearGlobalPreview(state.form) : state.form })
    if (disposed || generation !== state.generation) return
    receiveJob(job)
    finishDrain()
    if (generation !== state.generation) return
    void poll()
  }
  function matchesPending(job: GlobalJob): boolean {
    return job.requestId === state.requestId && (state.previewId === null || job.previewId === state.previewId)
      && (requestKind === null || job.kind === requestKind)
  }
  async function recoverLatest(): Promise<void> {
    if (disposed || !pendingRecovery || latestRequest || !visibility.isVisible()) return
    pendingRecovery = false
    const controller = new AbortController()
    const generation = state.generation
    const recoveringStart = state.startUnknown || commandKind === "start" || state.phase === "starting"
    latestRequest = controller
    publish({ ...state, refreshing: true })
    try {
      const job = await api.latest(controller.signal)
      if (!active(controller, generation)) return
      if (job && (!recoveringStart || matchesPending(job))) {
        if (recoveringStart || isRunActive(job) || job.jobId === state.jobId) {
          if (job.jobId === state.jobId) checkJob(job, job.jobId)
          track(job)
        }
      } else if (!job && !recoveringStart && state.phase !== "lost" && !state.jobId) {
        publish({ ...state, error: null })
      }
    } catch (cause) {
      if (active(controller, generation) && !recoveringStart) {
        const error = globalError(cause)
        if (error.statusCode !== 404 || state.phase === "lost") publish({ ...state, error })
      }
    } finally {
      if (latestRequest === controller) latestRequest = null
      if (active(controller, generation)) {
        publish({ ...state, refreshing: snapshotRequest !== null })
        void poll()
      }
      if (!disposed && pendingRecovery && visibility.isVisible()) void recoverLatest()
    }
  }
  function blocked(): boolean {
    return disposed || commandRequest !== null || state.startUnknown || state.cancelPending || state.refreshing
      || state.phase !== "idle" || (state.job !== null && isRunActive(state.job))
      || state.error?.code === "RUNNING" || state.error?.code === "READERS_RUNNING"
  }
  async function begin(
    kind: GlobalJobKind,
    input: GlobalActivityRequest & { previewId?: string },
    send: (signal: AbortSignal) => Promise<GlobalJobStart>,
  ): Promise<void> {
    const generation = invalidate()
    requestKind = kind
    if (kind === "preview") previewSelectionVersion = selectionVersion
    publish({ ...state, phase: "starting", generation, requestId: input.requestId, previewId: input.previewId ?? null,
      jobId: null, job: null, logs: initialRunnerLogs(), startUnknown: false, cancelUnknown: false,
      cancelPending: false, error: null, pollError: null, refreshing: false })
    if (disposed || generation !== state.generation) return
    const controller = new AbortController()
    commandRequest = controller
    commandKind = "start"
    try {
      const started = await send(controller.signal)
      if (!active(controller, generation) || commandRequest !== controller) return
      if (!started.jobId || started.requestId !== input.requestId
        || (input.previewId !== undefined && started.previewId !== input.previewId)) invalidResponse()
      if (state.jobId !== null && state.jobId !== started.jobId) invalidResponse()
      if (!state.job) publish({ ...state, phase: "tracking", jobId: started.jobId, previewId: started.previewId,
        logs: initialRunnerLogs(started.jobId), form: kind === "mutation" ? clearGlobalPreview(state.form) : state.form })
    } catch (cause) {
      if (active(controller, generation) && commandRequest === controller) {
        const error = globalError(cause)
        const startUnknown = !state.job && (error.statusCode === undefined || error.statusCode >= 500)
        publish({ ...state, phase: state.job ? state.phase : "idle", error, startUnknown,
          form: error.statusCode === 409 ? clearGlobalPreview(state.form) : state.form })
        if (startUnknown) { pendingRecovery = true; await recoverLatest() }
      }
    } finally {
      if (commandRequest === controller) { commandRequest = null; commandKind = null }
      if (active(controller, generation)) void poll()
    }
  }
  function select(selection: GlobalSelection) {
    if (disposed) return
    const form = changeGlobalSelection(state.form, selection)
    if (form !== state.form) { selectionVersion++; publish({ ...state, form }) }
  }
  async function inventory(): Promise<void> {
    if (blocked()) return
    const input = { requestId: uuid() }
    await begin("inventory", input, signal => api.inventory(input, signal))
  }
  async function loadVersions(input: Pick<GlobalVersionsRequest, "manager" | "package">): Promise<void> {
    if (blocked()) return
    const request = { requestId: uuid(), manager: input.manager, package: input.package }
    await begin("versions", request, signal => api.versions(request, signal))
  }
  async function preview(selection: GlobalSelection): Promise<void> {
    if (blocked()) return
    select(selection)
    publish({ ...state, form: clearGlobalPreview(state.form) })
    const input: GlobalPreviewRequest = { requestId: uuid(), manager: selection.manager, package: selection.package,
      action: selection.action, ...(selection.action === "change" ? { targetVersion: selection.targetVersion } : {}) }
    await begin("preview", input, signal => api.preview(input, signal))
  }
  async function execute(): Promise<void> {
    if (blocked()) return
    const now = clock.now()
    const error = globalConsentError(state.form, now)
    if (error) { publish({ ...state, error: { code: error, statusCode: 400 } }); return }
    const input = buildGlobalExecuteInput(state.form, uuid(), now)
    await begin("mutation", input, signal => api.execute(input, signal))
  }
  async function cancel(): Promise<void> {
    if (disposed || state.cancelPending || !state.jobId || commandKind === "cancel"
      || (state.job ? !isRunActive(state.job) : state.phase !== "tracking")) return
    const id = state.jobId
    const resumeSnapshot = snapshotRequest !== null || pendingSnapshot
    const generation = invalidate()
    publish({ ...state, generation, phase: "tracking", cancelPending: true, cancelUnknown: false,
      error: null, pollError: null, refreshing: false })
    if (disposed || generation !== state.generation) return
    const controller = new AbortController()
    commandRequest = controller
    commandKind = "cancel"
    try {
      const job = await api.cancel(id, controller.signal)
      if (!active(controller, generation) || commandRequest !== controller) return
      checkJob(job, id)
      receiveJob(job)
      finishDrain()
    } catch (cause) {
      if (active(controller, generation) && commandRequest === controller) {
        const error = globalError(cause)
        publish({ ...state, cancelPending: false, cancelUnknown: true, error, pollError: error.code,
          phase: error.statusCode === 404 ? "lost" : state.phase })
      }
    } finally {
      if (commandRequest === controller) { commandRequest = null; commandKind = null }
      if (active(controller, generation)) {
        if (resumeSnapshot) { pendingSnapshot = true; void refreshSnapshot() }
        void poll()
      }
    }
  }
  function retryPoll() {
    if (disposed || commandRequest || state.cancelPending || state.phase === "lost" || !state.jobId) return
    publish({ ...state, phase: "tracking", error: null, pollError: null })
    void poll()
  }
  async function refresh(snapshot?: GlobalSnapshot | null, latest?: GlobalJob | null): Promise<void> {
    if (disposed) return
    if (snapshot !== undefined) {
      publish({ ...state, snapshot: snapshot && state.job?.mutationSpawned && isRunActive(state.job)
        ? { ...snapshot, stale: true } : snapshot, snapshotError: null })
      if (latest && (!state.requestId || matchesPending(latest))) {
        if (latest.kind === "preview" && latest.preview && !state.form.selection.package) {
          select({ manager: latest.preview.manager, package: latest.preview.package, action: latest.preview.action,
            ...(latest.preview.requestedVersion !== null ? { targetVersion: latest.preview.requestedVersion } : {}) })
          previewSelectionVersion = selectionVersion
        }
        if (latest.kind === "preview" && state.jobId === null && state.requestId === null) previewSelectionVersion = selectionVersion
        track(latest)
        void poll()
      }
      return
    }
    pendingSnapshot = true
    pendingRecovery = true
    await Promise.all([refreshSnapshot(), recoverLatest()])
    if (state.phase === "tracking" && state.pollError) retryPoll()
  }
  const unsubscribe = visibility.subscribe(() => {
    if (disposed) return
    if (!visibility.isVisible()) {
      stopPoll()
      if (latestRequest) { pendingRecovery = true; latestRequest.abort() }
      if (snapshotRequest) { pendingSnapshot = true; snapshotRequest.abort() }
    } else {
      void recoverLatest()
      void refreshSnapshot()
      void poll()
    }
  })
  function dispose() {
    if (disposed) return
    disposed = true
    invalidate()
    unsubscribe()
  }
  return { inventory, loadVersions, preview, execute, select,
    consent: input => { if (!disposed) publish({ ...state, form: setGlobalConsent(state.form, input) }) },
    cancel, retryPoll, refresh, dispose, getSnapshot: () => state }
}
