"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { cancelBrowserDiskUsage, pollBrowserDiskUsage, startBrowserDiskUsage } from "@/lib/api/disk-usage-browser"
import { ApiError } from "@/lib/api/response"
import type { StartDiskUsage } from "@/lib/api/types"
import {
  acceptDiskJob, diskAcceptPoll, diskBeginCancel, diskCanPoll,
  diskEditTarget, diskPollFailure, diskReceiveJob, diskRequestError, diskRestoreSnapshot, diskRetryPoll, diskTrackJob,
  type DiskError, type DiskRequestTarget, type DiskSnapshot, type DiskUiState,
} from "@/lib/disk-usage/disk-usage-policy"

export interface DiskController {
  state: DiskUiState
  error: DiskError | null
  start(input: StartDiskUsage): Promise<void>
  cancel(): Promise<void>
  retryPoll(): void
  follow(conflict: { jobId: string; path: string }): void
  restore(snapshot: DiskSnapshot): void
  setTarget(target: DiskRequestTarget): void
}

export function useDiskUsage(initialTarget: DiskRequestTarget): DiskController {
  const [state, setState] = useState<DiskUiState>({ phase: "idle", job: null, requestTarget: null, form: initialTarget })
  const [error, setError] = useState<DiskError | null>(null)
  const current = useRef<DiskUiState>(state)
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
      publish(diskReceiveJob(current.current, job))
    } catch (cause) {
      if (!mounted.current || controller.signal.aborted || request.current !== controller
        || generation.current !== responseGeneration) return
      const failure = diskRequestError(current.current, "poll", cause)
      const statusCode = cause instanceof ApiError ? cause.statusCode : undefined
      publish(diskPollFailure(current.current, failure.code, statusCode))
      setError(failure)
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
    const target: DiskRequestTarget = { path: input.path, view: input.view ?? "directory" }
    publish({ ...active, phase: "starting", form: target })
    setError(null)
    const controller = new AbortController()
    request.current = controller
    try {
      const started = await startBrowserDiskUsage(input, controller.signal)
      if (!mounted.current || controller.signal.aborted || request.current !== controller
        || generation.current !== responseGeneration) return
      publish(diskTrackJob(current.current, started.jobId, target))
    } catch (cause) {
      if (!mounted.current || controller.signal.aborted || request.current !== controller
        || generation.current !== responseGeneration) return
      setError(diskRequestError(current.current, "start", cause))
      publish({ ...active, form: target })
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
      publish(diskReceiveJob(current.current, job))
    } catch (cause) {
      if (!mounted.current || controller.signal.aborted || request.current !== controller
        || generation.current !== responseGeneration) return
      const failure = diskRequestError(current.current, "cancel", cause)
      const statusCode = cause instanceof ApiError ? cause.statusCode : undefined
      publish(diskPollFailure(current.current, failure.code, statusCode))
      setError(failure)
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

  const follow = useCallback((conflict: { jobId: string; path: string }) => {
    if (!mounted.current || current.current.phase !== "idle" || request.current) return
    stopRequest()
    generation.current++
    setError(null)
    publish(diskTrackJob(current.current, conflict.jobId, { path: conflict.path, view: null }))
    void poll()
  }, [poll, publish, stopRequest])

  const restore = useCallback((snapshot: DiskSnapshot) => {
    if (!mounted.current || current.current.phase !== "idle" || snapshot.job.status === "running") return
    stopRequest()
    generation.current++
    setError(null)
    publish(diskRestoreSnapshot(snapshot))
  }, [publish, stopRequest])

  const setTarget = useCallback((target: DiskRequestTarget) => {
    publish(diskEditTarget(current.current, target))
  }, [publish])

  return { state, error, start, cancel, retryPoll, follow, restore, setTarget }
}
