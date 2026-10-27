"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { cancelBrowserDiskUsage, pollBrowserDiskUsage, startBrowserDiskUsage } from "@/lib/api/disk-usage-browser"
import { ApiError } from "@/lib/api/response"
import type { DiskUsageJob, StartDiskUsage } from "@/lib/api/types"
import {
  acceptDiskJob, diskAcceptPoll, diskBeginCancel, diskCanPoll,
  diskPollFailure, diskRetryPoll, diskTrackJob, type DiskUiState,
} from "@/lib/disk-usage/disk-usage-policy"

export interface DiskError {
  code: string
  conflict?: { jobId: string; path: string }
}

export interface DiskController {
  state: DiskUiState
  error: DiskError | null
  start(input: StartDiskUsage): Promise<void>
  cancel(): Promise<void>
  retryPoll(): void
  follow(jobId: string): void
  restore(job: DiskUsageJob): void
}

function readError(error: unknown): DiskError {
  if (!(error instanceof ApiError)) return { code: "UNKNOWN" }
  const details = error.details
  if (error.code === "CONFLICT" && typeof details === "object" && details !== null
    && "jobId" in details && typeof details.jobId === "string"
    && "path" in details && typeof details.path === "string") {
    return { code: "CONFLICT", conflict: { jobId: details.jobId, path: details.path } }
  }
  return { code: error.code ?? (error.statusCode === 404 ? "NOT_FOUND" : "UNKNOWN") }
}

export function useDiskUsage(): DiskController {
  const [state, setState] = useState<DiskUiState>({ phase: "idle", job: null })
  const [error, setError] = useState<DiskError | null>(null)
  const current = useRef<DiskUiState>({ phase: "idle", job: null })
  const mounted = useRef(false)
  const generation = useRef(0)
  const request = useRef<AbortController | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const publish = useCallback((next: DiskUiState) => {
    current.current = next
    setState(next)
  }, [])

  const stopRequest = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    request.current?.abort()
    request.current = null
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      stopRequest()
    }
  }, [stopRequest])

  const poll = useCallback(async function pollOnce() {
    const active = current.current
    if (!mounted.current || request.current || active.phase !== "tracking"
      || !diskCanPoll(active, document.visibilityState === "visible")) return
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    const controller = new AbortController()
    const responseGeneration = generation.current
    request.current = controller
    try {
      const job = await pollBrowserDiskUsage(active.jobId, controller.signal)
      if (!mounted.current || controller.signal.aborted || request.current !== controller
        || !diskAcceptPoll(current.current, job, generation.current, responseGeneration)) return
      publish(job.status === "running"
        ? { phase: "tracking", jobId: job.jobId, job, cancelPending: false }
        : { phase: "idle", job })
    } catch (cause) {
      if (!mounted.current || controller.signal.aborted || request.current !== controller
        || generation.current !== responseGeneration) return
      const failure = readError(cause)
      const statusCode = cause instanceof ApiError ? cause.statusCode : undefined
      publish(diskPollFailure(current.current, failure.code, statusCode))
      setError(statusCode === 404 ? { code: "NOT_FOUND" } : failure)
    } finally {
      if (request.current === controller) request.current = null
    }
    if (mounted.current && !controller.signal.aborted && generation.current === responseGeneration
      && diskCanPoll(current.current, document.visibilityState === "visible")) {
      timer.current = setTimeout(() => {
        timer.current = null
        void pollOnce()
      }, 1000)
    }
  }, [publish])

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "visible") void poll()
      else if (current.current.phase === "tracking" && !current.current.cancelPending) stopRequest()
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => document.removeEventListener("visibilitychange", onVisibilityChange)
  }, [poll, stopRequest])

  const start = useCallback(async (input: StartDiskUsage) => {
    const active = current.current
    if (!mounted.current || request.current || active.phase !== "idle") return
    stopRequest()
    const responseGeneration = ++generation.current
    publish({ phase: "starting", job: active.job })
    setError(null)
    const controller = new AbortController()
    request.current = controller
    try {
      const started = await startBrowserDiskUsage(input, controller.signal)
      if (!mounted.current || controller.signal.aborted || request.current !== controller
        || generation.current !== responseGeneration) return
      publish(diskTrackJob(current.current, started.jobId))
    } catch (cause) {
      if (!mounted.current || controller.signal.aborted || request.current !== controller
        || generation.current !== responseGeneration) return
      setError(readError(cause))
      publish({ phase: "idle", job: active.job })
    } finally {
      if (request.current === controller) {
        request.current = null
        void poll()
      }
    }
  }, [poll, publish, stopRequest])

  const cancel = useCallback(async () => {
    const active = current.current
    if (!mounted.current || active.phase !== "tracking" || active.cancelPending) return
    stopRequest()
    const responseGeneration = ++generation.current
    publish(diskBeginCancel(active))
    setError(null)
    const controller = new AbortController()
    request.current = controller
    try {
      const job = await cancelBrowserDiskUsage(active.jobId, controller.signal)
      if (!mounted.current || controller.signal.aborted || request.current !== controller
        || !acceptDiskJob(current.current, job, generation.current, responseGeneration)) return
      publish(job.status === "running"
        ? { phase: "tracking", jobId: job.jobId, job, cancelPending: false }
        : { phase: "idle", job })
    } catch (cause) {
      if (!mounted.current || controller.signal.aborted || request.current !== controller
        || generation.current !== responseGeneration) return
      const failure = readError(cause)
      const statusCode = cause instanceof ApiError ? cause.statusCode : undefined
      publish(diskPollFailure(current.current, failure.code, statusCode))
      setError(statusCode === 404 ? { code: "NOT_FOUND" } : failure)
    } finally {
      if (request.current === controller) {
        request.current = null
        void poll()
      }
    }
  }, [poll, publish, stopRequest])

  const retryPoll = useCallback(() => {
    if (current.current.phase !== "tracking" || current.current.cancelPending || request.current) return
    publish(diskRetryPoll(current.current))
    setError(null)
    void poll()
  }, [poll, publish])

  const follow = useCallback((jobId: string) => {
    if (!mounted.current || current.current.phase !== "idle" || request.current) return
    stopRequest()
    generation.current++
    setError(null)
    publish(diskTrackJob(current.current, jobId))
    void poll()
  }, [poll, publish, stopRequest])

  const restore = useCallback((job: DiskUsageJob) => {
    if (!mounted.current || current.current.phase !== "idle" || job.status === "running") return
    stopRequest()
    generation.current++
    setError(null)
    publish({ phase: "idle", job })
  }, [publish, stopRequest])

  return { state, error, start, cancel, retryPoll, follow, restore }
}
