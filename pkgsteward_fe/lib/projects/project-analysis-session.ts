import { ApiError } from "../api/response.ts"
import type { ProjectAnalysisJob, ProjectAnalysisStart, ProjectDetail, StartProjectAnalysis } from "@/lib/api/types"
import {
  acceptAnalysisJob, beginAnalysisCancel, canPollAnalysis, failAnalysisRequest,
  initialAnalysisState, receiveAnalysisJob, retryAnalysisPoll, trackAnalysis,
} from "./project-analysis-policy.ts"
import type { AnalysisConflict, ProjectAnalysisState } from "@/lib/projects/project-analysis-policy"

export interface ProjectAnalysisApi {
  start(input: StartProjectAnalysis, signal: AbortSignal): Promise<ProjectAnalysisStart>
  get(id: string, signal: AbortSignal): Promise<ProjectAnalysisJob>
  cancel(id: string, signal: AbortSignal): Promise<ProjectAnalysisJob>
}

export interface ProjectAnalysisClock {
  setTimeout(callback: () => void, delay: number): number
  clearTimeout(id: number): void
}

export interface ProjectAnalysisVisibility {
  isVisible(): boolean
  subscribe(callback: () => void): () => void
}

export interface ProjectAnalysisSessionOptions {
  api: ProjectAnalysisApi
  clock: ProjectAnalysisClock
  visibility: ProjectAnalysisVisibility
  onChange(state: ProjectAnalysisState): void
}

export function createProjectAnalysisSession({ api, clock, visibility, onChange }: ProjectAnalysisSessionOptions) {
  let state = initialAnalysisState()
  let disposed = false
  let timer: number | null = null
  // Keep an aborted GET in the slot until it settles: hide/show and path switches
  // must not overlap requests even if a transport ignores AbortSignal temporarily.
  let pollRequest: AbortController | null = null
  let commandRequest: AbortController | null = null

  function publish(next: ProjectAnalysisState) {
    if (disposed) return
    state = next
    onChange(state)
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
    return state.generation + 1
  }

  function active(controller: AbortController, generation: number) {
    return !disposed && !controller.signal.aborted && state.generation === generation
  }

  async function poll() {
    if (disposed || pollRequest || commandRequest || state.phase !== "tracking"
      || !canPollAnalysis(state, visibility.isVisible())) return
    if (timer !== null) clock.clearTimeout(timer)
    timer = null
    const controller = new AbortController()
    const generation = state.generation
    const jobId = state.jobId
    pollRequest = controller
    try {
      const job = await api.get(jobId, controller.signal)
      if (!active(controller, generation) || pollRequest !== controller) return
      if (!acceptAnalysisJob(state, job, generation)) {
        throw new ApiError(502, "The analysis response has an unexpected job id.", "INVALID_RESPONSE")
      }
      publish(receiveAnalysisJob(state, job))
    } catch (cause) {
      if (active(controller, generation) && pollRequest === controller) {
        publish(failAnalysisRequest(state, "poll", cause))
      }
    } finally {
      if (pollRequest === controller) pollRequest = null
      if (!disposed && !commandRequest && canPollAnalysis(state, visibility.isVisible())) {
        if (controller.signal.aborted || state.generation !== generation) {
          // A visible tab/new generation was waiting for the old GET to settle.
          void poll()
        } else {
          timer = clock.setTimeout(() => { timer = null; void poll() }, 1000)
        }
      }
    }
  }

  const unsubscribe = visibility.subscribe(() => {
    if (disposed) return
    if (visibility.isVisible()) void poll()
    else stopPoll()
  })

  async function start(path: string): Promise<void> {
    if (disposed || commandRequest || state.phase === "starting" || state.phase === "tracking") return
    if (state.detail?.warnings.includes("REGISTRY_CONFIG_UNSUPPORTED")) return
    const generation = invalidate()
    publish({ ...state, phase: "starting", generation, requestPath: path, error: null,
      startUnknown: false, cancelUnknown: false })
    const controller = new AbortController()
    commandRequest = controller
    try {
      const started = await api.start({ path }, controller.signal)
      if (!active(controller, generation) || commandRequest !== controller) return
      publish(trackAnalysis(state, started.jobId, path))
    } catch (cause) {
      if (active(controller, generation) && commandRequest === controller) {
        publish(failAnalysisRequest(state, "start", cause))
      }
    } finally {
      if (commandRequest === controller) commandRequest = null
      if (active(controller, generation)) void poll()
    }
  }

  async function cancel(): Promise<void> {
    if (disposed || commandRequest || state.phase !== "tracking" || state.cancelPending) return
    const jobId = state.jobId
    const generation = invalidate()
    publish(beginAnalysisCancel({ ...state, generation }))
    const controller = new AbortController()
    commandRequest = controller
    try {
      const job = await api.cancel(jobId, controller.signal)
      if (!active(controller, generation) || commandRequest !== controller) return
      if (!acceptAnalysisJob(state, job, generation, "cancel")) {
        throw new ApiError(502, "The cancellation response has an unexpected job id.", "INVALID_RESPONSE")
      }
      publish(receiveAnalysisJob(state, job))
    } catch (cause) {
      if (active(controller, generation) && commandRequest === controller) {
        publish(failAnalysisRequest(state, "cancel", cause))
      }
    } finally {
      if (commandRequest === controller) commandRequest = null
      if (active(controller, generation)) void poll()
    }
  }

  function retryPoll() {
    if (disposed || commandRequest || state.phase !== "tracking" || state.cancelPending) return
    publish(retryAnalysisPoll(state))
    void poll()
  }

  function follow(conflict: AnalysisConflict) {
    if (disposed || commandRequest || state.phase === "starting" || state.phase === "tracking"
      || conflict.reason !== "ANALYSIS_RUNNING" || typeof conflict.jobId !== "string" || !conflict.jobId
      || typeof conflict.path !== "string" || !conflict.path) return
    const generation = invalidate()
    publish(trackAnalysis({ ...state, generation }, conflict.jobId, conflict.path))
    void poll()
  }

  function refresh(detail: ProjectDetail) {
    if (disposed) return
    const switched = state.detail
      ? state.detail.path !== detail.path || state.detail.requestPath !== detail.requestPath
      : state.requestPath !== null && state.requestPath !== detail.requestPath
    if (switched) {
      const generation = invalidate()
      publish({ ...initialAnalysisState(detail), generation })
      return
    }
    if (state.phase === "starting" || state.phase === "tracking") return
    const changed = state.job && (state.job.inputHash !== detail.inputHash || state.job.scanId !== detail.scanId)
    publish({ ...state, detail, requestPath: detail.requestPath,
      job: changed && state.job ? { ...state.job, stale: true } : state.job })
  }

  function dispose() {
    if (disposed) return
    disposed = true
    stopPoll()
    commandRequest?.abort()
    commandRequest = null
    unsubscribe()
  }

  return { start, cancel, retryPoll, follow, refresh, dispose, getSnapshot: () => state }
}

export type ProjectAnalysisSession = ReturnType<typeof createProjectAnalysisSession>
