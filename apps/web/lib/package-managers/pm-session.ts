import { ApiError } from "../api/response.ts"
import {
  initialPmPreviewForm, changePmSelection, displayPmPreview, setPmRiskAcknowledged,
  clearPmPreview, pmConsentError, buildPmExecuteInput,
} from "./pm-preview-form.ts"
import type { PmPreviewForm, PmSelection } from "@/lib/package-managers/pm-preview-form"
import type {
  PmContext, PmExecuteRequest, PmJob, PmJobKind, PmJobStart, PmManager, PmPreview, PmPreviewRequest,
  PmVersions, PmVersionsRequest,
} from "@/lib/package-managers/pm-types"

export interface PmApi {
  context(path: string, signal: AbortSignal): Promise<PmContext>
  versions(input: PmVersionsRequest, signal: AbortSignal): Promise<PmJobStart>
  preview(input: PmPreviewRequest, signal: AbortSignal): Promise<PmJobStart>
  execute(input: PmExecuteRequest, signal: AbortSignal): Promise<PmJobStart>
  latest(signal: AbortSignal): Promise<PmJob | null>
  get(id: string, signal: AbortSignal): Promise<PmJob>
  cancel(id: string, signal: AbortSignal): Promise<PmJob>
}
export interface PmClock {
  now(): number
  setTimeout(callback: () => void, delay: number): number
  clearTimeout(id: number): void
}
export interface PmVisibility { isVisible(): boolean; subscribe(callback: () => void): () => void }
export interface PmError { code: string; statusCode?: number }
export interface PmState {
  phase: "idle" | "starting" | "tracking" | "lost"
  generation: number
  context: PmContext | null
  contextError: PmError | null
  contextLoading: boolean
  requestId: string | null
  previewId: string | null
  jobId: string | null
  job: PmJob | null
  activity: { kind: PmJobKind; manager: PmManager } | null
  versions: PmVersions | null
  mutationResult: PmJob | null
  // A job of another project holds the single slot: actions wait, UI links to it.
  otherJob: PmJob | null
  form: PmPreviewForm
  error: PmError | null
  pollError: string | null
  startUnknown: boolean
  cancelPending: boolean
  // A job lost after a 404 whose outcome is unknown; cleared once recovered or a new action starts.
  lostJobId: string | null
}
export interface PmSessionOptions {
  path: string
  api: PmApi
  clock: PmClock
  visibility: PmVisibility
  onChange(state: PmState): void
  onMutated(job: PmJob): void
  uuid?: () => string
}

const CODE = /^[A-Z][A-Z0-9_]{0,63}$/
export function pmError(cause: unknown): PmError {
  if (!(cause instanceof ApiError)) return { code: "UNKNOWN" }
  const details = cause.details
  if (typeof details === "object" && details !== null && "reason" in details
    && typeof details.reason === "string" && CODE.test(details.reason)) return { code: details.reason, statusCode: cause.statusCode }
  return { code: cause.code && CODE.test(cause.code) ? cause.code : "UNKNOWN", statusCode: cause.statusCode }
}
// The server reports status before audit/invalidation finish: only phase "done" is final.
export const pmJobSettling = (job: PmJob): boolean => job.status === "running" || job.phase !== "done"
// A settled job may still hold the shared gate until cleanup, audit or refresh finishes.
export const pmCleanupPending = (job: PmJob | null): boolean =>
  job !== null && !pmJobSettling(job) && (job.gateHeld || job.cleanupRequired || job.refreshRequired)
export function pmReadFailure(state: PmState): string | null {
  const job = state.job
  if (!job || job.kind === "mutation" || pmJobSettling(job) || job.status === "completed") return null
  return job.failureCode ?? (job.status === "cancelled" ? "CANCELLED" : job.status === "timed_out" ? "TIMED_OUT" : "UNKNOWN")
}
export function pmMutationSucceeded(job: PmJob): boolean {
  return job.kind === "mutation" && job.status === "completed" && job.phase === "done" && job.fileCommitted
    && job.auditWritten && !job.failureCode && !job.gateHeld && !job.refreshRequired && !job.cleanupRequired
}
const pathKey = (value: string): string => value.replace(/\//g, "\\").replace(/(?<!^[A-Za-z]:)\\+$/, "").toLowerCase()

export function initialPmState(): PmState {
  return { phase: "idle", generation: 0, context: null, contextError: null, contextLoading: false, requestId: null,
    previewId: null, jobId: null, job: null, activity: null, versions: null, mutationResult: null, otherJob: null,
    form: initialPmPreviewForm(), error: null, pollError: null, startUnknown: false, cancelPending: false, lostJobId: null }
}

export function createPmSession({ path, api, clock, visibility, onChange, onMutated, uuid = () => crypto.randomUUID() }: PmSessionOptions) {
  let state = initialPmState()
  let disposed = false
  let timer: number | null = null
  let pollRequest: AbortController | null = null
  let commandRequest: AbortController | null = null
  let commandKind: "start" | "cancel" | null = null
  let contextRequest: AbortController | null = null
  let latestRequest: AbortController | null = null
  let requestKind: PmJobKind | null = null
  let selectionVersion = 0
  let previewSelectionVersion = 0
  let displayedPreviewJob: string | null = null
  // A preview stopped by Escape is never displayed, even if the server finished it first.
  let stoppedPreviewRequest: string | null = null
  let notifiedMutation: string | null = null

  function publish(next: PmState) {
    if (disposed) return
    state = next
    onChange(state)
  }
  function active(controller: AbortController, generation: number): boolean {
    return !disposed && !controller.signal.aborted && generation === state.generation
  }
  function ours(value: string): boolean {
    const key = pathKey(value)
    return key === pathKey(path) || (state.context !== null && key === pathKey(state.context.path))
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
    return state.generation + 1
  }
  function invalidResponse(): never {
    throw new ApiError(502, "Unexpected package manager activity response.", "INVALID_RESPONSE")
  }
  function checkJob(job: PmJob, id: string) {
    if (job.jobId !== id || (state.requestId !== null && job.requestId !== state.requestId)
      || (requestKind !== null && job.kind !== requestKind) || !ours(job.path)) invalidResponse()
  }
  function matchesSelection(preview: PmPreview): boolean {
    const selection = state.form.selection
    return previewSelectionVersion === selectionVersion && selection?.manager === preview.manager
      && selection.targetVersion === preview.requestedVersion
  }
  function receiveJob(job: PmJob) {
    let form = state.form
    if (job.kind === "preview" && job.status === "completed" && job.preview && displayedPreviewJob !== job.jobId
      && job.requestId !== stoppedPreviewRequest) {
      if (job.preview.previewId !== job.previewId) invalidResponse()
      displayedPreviewJob = job.jobId
      if (matchesSelection(job.preview)) form = displayPmPreview(form, job.preview)
    }
    const terminal = !pmJobSettling(job)
    publish({ ...state, job, previewId: job.previewId, form, phase: terminal ? "idle" : state.phase,
      versions: terminal && job.status === "completed" && job.versions ? job.versions : state.versions,
      mutationResult: terminal && job.kind === "mutation" ? job : state.mutationResult,
      cancelPending: false, error: null, pollError: null })
    if (terminal && job.kind === "mutation" && (job.mayHaveChanged || job.fileCommitted) && notifiedMutation !== job.jobId) {
      notifiedMutation = job.jobId
      onMutated(job)
    }
  }
  function canPoll(): boolean {
    return !disposed && visibility.isVisible() && state.phase === "tracking" && state.jobId !== null
      && !state.cancelPending && !state.pollError && (commandRequest === null || (commandKind === "start" && state.job !== null))
      && (!state.job || pmJobSettling(state.job))
  }
  async function poll(): Promise<void> {
    if (pollRequest || !canPoll() || !state.jobId) return
    if (timer !== null) clock.clearTimeout(timer)
    timer = null
    const controller = new AbortController()
    const generation = state.generation
    const id = state.jobId
    pollRequest = controller
    try {
      const job = await api.get(id, controller.signal)
      if (active(controller, generation) && state.jobId === id) { checkJob(job, id); receiveJob(job) }
    } catch (cause) {
      if (active(controller, generation) && state.jobId === id) {
        const error = pmError(cause)
        publish({ ...state, error, pollError: error.code, phase: error.statusCode === 404 ? "lost" : state.phase })
      }
    } finally {
      // Keep the slot until the GET settles, even when a transport ignores abort.
      if (pollRequest === controller) pollRequest = null
      if (canPoll()) {
        if (controller.signal.aborted || generation !== state.generation) void poll()
        else {
          const scheduled = clock.setTimeout(() => {
            if (timer !== scheduled) return
            timer = null
            void poll()
          }, 1000)
          timer = scheduled
        }
      }
    }
  }
  function track(job: PmJob) {
    const generation = state.jobId !== null && state.jobId !== job.jobId ? invalidate() : state.generation
    requestKind = job.kind
    publish({ ...state, generation, phase: "tracking", jobId: job.jobId, requestId: job.requestId, previewId: job.previewId,
      activity: { kind: job.kind, manager: job.manager }, error: null, pollError: null, startUnknown: false,
      cancelPending: false, lostJobId: null, form: job.kind === "mutation" ? clearPmPreview(state.form) : state.form })
    receiveJob(job)
    void poll()
  }
  async function recoverLatest(recoveringStart: boolean): Promise<void> {
    if (disposed || latestRequest) return
    const controller = new AbortController()
    const generation = state.generation
    latestRequest = controller
    try {
      const latest = await api.latest(controller.signal)
      if (!active(controller, generation)) return
      if (!latest || !ours(latest.path)) {
        publish({ ...state, otherJob: latest && pmJobSettling(latest) ? latest : null })
        return
      }
      publish({ ...state, otherJob: null })
      // Only one job runs at a time: a running job that is not ours means our start was refused.
      if (recoveringStart ? latest.requestId === state.requestId
        : latest.jobId === state.lostJobId || ((pmJobSettling(latest) || pmCleanupPending(latest)) && state.phase === "idle")) track(latest)
    } catch (cause) {
      if (active(controller, generation) && !recoveringStart) publish({ ...state, error: pmError(cause) })
    } finally {
      if (latestRequest === controller) latestRequest = null
    }
  }
  function blocked(): boolean {
    return disposed || commandRequest !== null || state.startUnknown || state.cancelPending || state.phase !== "idle"
      || (state.job !== null && (pmJobSettling(state.job) || pmCleanupPending(state.job)))
      || (state.otherJob !== null && (pmJobSettling(state.otherJob) || pmCleanupPending(state.otherJob)))
  }
  async function begin(kind: PmJobKind, manager: PmManager, input: { requestId: string; previewId?: string },
    send: (signal: AbortSignal) => Promise<PmJobStart>): Promise<void> {
    const generation = invalidate()
    requestKind = kind
    if (kind === "preview") previewSelectionVersion = selectionVersion
    publish({ ...state, phase: "starting", generation, requestId: input.requestId, previewId: input.previewId ?? null,
      jobId: null, job: null, activity: { kind, manager }, mutationResult: kind === "mutation" ? null : state.mutationResult,
      error: null, pollError: null, startUnknown: false, cancelPending: false, lostJobId: null })
    const controller = new AbortController()
    commandRequest = controller
    commandKind = "start"
    // Execute answers only after preflight: find the admitted job through latest meanwhile, so it can be cancelled.
    let discovery: number | null = null
    const discover = () => {
      discovery = clock.setTimeout(() => {
        discovery = null
        if (disposed || commandRequest !== controller || state.jobId) return
        void recoverLatest(true).finally(() => { if (commandRequest === controller && !state.jobId) discover() })
      }, 1000)
    }
    if (kind === "mutation") discover()
    try {
      const started = await send(controller.signal)
      if (!active(controller, generation) || commandRequest !== controller) return
      if (!started.jobId || started.requestId !== input.requestId
        || (input.previewId !== undefined && started.previewId !== input.previewId)) invalidResponse()
      publish({ ...state, phase: "tracking", jobId: started.jobId, previewId: started.previewId,
        form: kind === "mutation" ? clearPmPreview(state.form) : state.form })
    } catch (cause) {
      if (active(controller, generation) && commandRequest === controller) {
        const error = pmError(cause)
        // No status or a 5xx: the job may exist; recover it through latest, never by resending.
        const startUnknown = error.statusCode === undefined || error.statusCode >= 500
        publish({ ...state, phase: "idle", error, startUnknown,
          form: error.statusCode === 409 ? clearPmPreview(state.form) : state.form })
        if (startUnknown) {
          commandRequest = null
          commandKind = null
          await recoverLatest(true)
        }
      }
    } finally {
      if (discovery !== null) clock.clearTimeout(discovery)
      if (commandRequest === controller) { commandRequest = null; commandKind = null }
      if (active(controller, generation)) {
        if (kind === "preview" && stoppedPreviewRequest === input.requestId && state.jobId) void cancel()
        else void poll()
      }
    }
  }
  function select(selection: PmSelection) {
    if (disposed) return
    const form = changePmSelection(state.form, selection)
    if (form !== state.form) { selectionVersion++; publish({ ...state, form }) }
  }
  async function loadContext(): Promise<void> {
    if (disposed) return
    contextRequest?.abort()
    const controller = new AbortController()
    contextRequest = controller
    publish({ ...state, contextLoading: true })
    try {
      const context = await api.context(path, controller.signal)
      if (!disposed && !controller.signal.aborted) publish({ ...state, context, contextError: null })
    } catch (cause) {
      if (!disposed && !controller.signal.aborted) publish({ ...state, contextError: pmError(cause) })
    } finally {
      if (contextRequest === controller) {
        contextRequest = null
        publish({ ...state, contextLoading: false })
      }
    }
  }
  async function loadVersions(manager: PmManager): Promise<void> {
    if (blocked()) return
    const input: PmVersionsRequest = { requestId: uuid(), path, manager }
    await begin("versions", manager, input, signal => api.versions(input, signal))
  }
  async function preview(selection: PmSelection): Promise<void> {
    if (blocked()) return
    select(selection)
    publish({ ...state, form: clearPmPreview(state.form) })
    stoppedPreviewRequest = null
    const input: PmPreviewRequest = { requestId: uuid(), path, manager: selection.manager, targetVersion: selection.targetVersion }
    await begin("preview", selection.manager, input, signal => api.preview(input, signal))
  }
  async function execute(): Promise<void> {
    if (blocked()) return
    const now = clock.now()
    const error = pmConsentError(state.form, now)
    if (error) { publish({ ...state, error: { code: error, statusCode: 400 } }); return }
    const input = buildPmExecuteInput(state.form, uuid(), now)
    await begin("mutation", state.form.selection?.manager ?? "npm", input, signal => api.execute(input, signal))
  }
  function stopPreview(): boolean {
    if (disposed || state.activity?.kind !== "preview" || (state.phase !== "starting" && state.phase !== "tracking")
      || state.form.preview !== null || state.cancelPending || commandKind === "cancel"
      || state.requestId === null || stoppedPreviewRequest === state.requestId) return false
    stoppedPreviewRequest = state.requestId
    if (state.jobId && commandRequest === null) void cancel()
    return true
  }
  async function cancel(): Promise<void> {
    if (disposed || state.cancelPending || !state.jobId || commandKind === "cancel"
      || (state.job ? !pmJobSettling(state.job) && !pmCleanupPending(state.job) : state.phase !== "tracking")) return
    const id = state.jobId
    const generation = invalidate()
    publish({ ...state, generation, phase: "tracking", cancelPending: true, error: null, pollError: null })
    const controller = new AbortController()
    commandRequest = controller
    commandKind = "cancel"
    try {
      const job = await api.cancel(id, controller.signal)
      if (!active(controller, generation) || commandRequest !== controller) return
      checkJob(job, id)
      receiveJob(job)
    } catch (cause) {
      if (active(controller, generation) && commandRequest === controller) {
        const error = pmError(cause)
        publish({ ...state, cancelPending: false, error, pollError: error.code,
          phase: error.statusCode === 404 ? "lost" : state.phase })
      }
    } finally {
      if (commandRequest === controller) { commandRequest = null; commandKind = null }
      if (active(controller, generation)) void poll()
    }
  }
  function retryPoll() {
    if (disposed || commandRequest || state.cancelPending || state.phase === "lost" || !state.jobId || !state.pollError) return
    publish({ ...state, phase: "tracking", error: null, pollError: null })
    void poll()
  }
  async function refresh(): Promise<void> {
    if (disposed) return
    if (state.phase === "lost") {
      const lostJobId = state.jobId
      const generation = invalidate()
      publish({ ...state, generation, phase: "idle", jobId: null, job: null, requestId: null, previewId: null,
        activity: null, error: null, pollError: null, cancelPending: false, lostJobId })
    }
    await Promise.all([loadContext(), recoverLatest(state.startUnknown)])
  }
  const unsubscribe = visibility.subscribe(() => {
    if (disposed) return
    if (visibility.isVisible()) void poll()
    else stopPoll()
  })
  function dispose() {
    if (disposed) return
    disposed = true
    invalidate()
    contextRequest?.abort()
    unsubscribe()
  }
  return {
    loadContext, loadVersions, preview, stopPreview, execute, select, cancel, retryPoll, refresh, dispose,
    // Closing the dialog drops the preview and consent; the server preview simply expires.
    dismissPreview: () => { if (!disposed) publish({ ...state, form: clearPmPreview(state.form) }) },
    acknowledge: (code: string, checked: boolean) => {
      if (!disposed) publish({ ...state, form: setPmRiskAcknowledged(state.form, code, checked) })
    },
    getSnapshot: () => state,
  }
}

export type PmSession = ReturnType<typeof createPmSession>
