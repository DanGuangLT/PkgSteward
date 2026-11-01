"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import {
  cancelBrowserOperation, cancelBrowserPreview, executeBrowserDelete, getBrowserActiveOperation,
  pollBrowserOperation, pollBrowserPreview, startBrowserCleanupPreview, startBrowserDeletePreview, summarizeBrowserPreview,
} from "@/lib/api/file-ops-browser"
import { ApiError } from "@/lib/api/response"
import type { CleanupPreviewInput, FileOpsExecuteInput, FileOpsPreviewStart } from "@/lib/api/types"
import {
  fileOpsAbandon, fileOpsAcceptOperation, fileOpsAcceptPreview, fileOpsBeginCancel, fileOpsBeginExecute, fileOpsBeginStart,
  fileOpsBeginSummary, fileOpsCanPoll, fileOpsCloseSummary, fileOpsError, fileOpsExecuteFailure, fileOpsFollowOperation,
  fileOpsInitialState, fileOpsPollFailure, fileOpsReceiveOperation, fileOpsReceivePreview, fileOpsReceiveSummary,
  fileOpsReset, fileOpsRetryPoll, fileOpsStartFailure, fileOpsSummaryFailure, fileOpsTrackOperation, fileOpsTrackPreview,
  type FileOpsError, type FileOpsUiState,
} from "@/lib/file-ops/file-ops-policy"

export interface FileOpsController {
  state: FileOpsUiState
  error: FileOpsError | null
  startCleanup(input: CleanupPreviewInput): Promise<void>
  startDelete(paths: string[]): Promise<void>
  cancelPreview(): Promise<void>
  summarize(paths: string[]): Promise<void>
  closeSummary(): void
  execute(input: FileOpsExecuteInput): Promise<void>
  resendExecute(): Promise<void>
  abandon(): void
  cancelOperation(): Promise<void>
  retryPoll(): void
  reset(): void
}

export function useFileOps(): FileOpsController {
  const [state, setState] = useState<FileOpsUiState>(fileOpsInitialState)
  const [error, setError] = useState<FileOpsError | null>(null)
  const current = useRef<FileOpsUiState>(state)
  const mounted = useRef(false)
  const generation = useRef(0)
  const request = useRef<AbortController | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const publish = useCallback((next: FileOpsUiState) => {
    current.current = next
    setState(next)
  }, [])

  const stopRequest = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    request.current?.abort()
    request.current = null
  }, [])

  const isStale = useCallback((controller: AbortController, responseGeneration: number) => (
    !mounted.current || controller.signal.aborted || request.current !== controller
      || generation.current !== responseGeneration
  ), [])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      stopRequest()
    }
  }, [stopRequest])

  const poll = useCallback(async function pollOnce() {
    const active = current.current
    if (!mounted.current || request.current || !fileOpsCanPoll(active, document.visibilityState === "visible")) return
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    const controller = new AbortController()
    const responseGeneration = generation.current
    request.current = controller
    try {
      if (active.phase === "measuring") {
        const preview = await pollBrowserPreview(active.previewId, controller.signal)
        if (isStale(controller, responseGeneration)
          || !fileOpsAcceptPreview(current.current, preview, generation.current, responseGeneration, "poll")) return
        publish(fileOpsReceivePreview(current.current, preview))
      } else if (active.phase === "operating") {
        const operation = await pollBrowserOperation(active.operationId, controller.signal)
        if (isStale(controller, responseGeneration)
          || !fileOpsAcceptOperation(current.current, operation, generation.current, responseGeneration, "poll")) return
        publish(fileOpsReceiveOperation(current.current, operation))
      }
    } catch (cause) {
      if (isStale(controller, responseGeneration)) return
      const failure = fileOpsError(cause)
      publish(fileOpsPollFailure(current.current, failure.code, cause instanceof ApiError ? cause.statusCode : undefined))
      setError(failure)
    } finally {
      if (request.current === controller) request.current = null
    }
    if (mounted.current && !controller.signal.aborted && generation.current === responseGeneration
      && fileOpsCanPoll(current.current, document.visibilityState === "visible")) {
      timer.current = setTimeout(() => {
        timer.current = null
        void pollOnce()
      }, 1000)
    }
  }, [isStale, publish])

  useEffect(() => {
    function onVisibilityChange() {
      const active = current.current
      if (document.visibilityState === "visible") void poll()
      // Chỉ huỷ request theo dõi; execute hoặc cancel đang gửi phải chạy tới cùng.
      else if ((active.phase === "measuring" || active.phase === "operating") && !active.cancelPending) stopRequest()
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => document.removeEventListener("visibilitychange", onVisibilityChange)
  }, [poll, stopRequest])

  // Tải lại trang khi đang xoá: nối lại đúng operation đang chạy, không gửi lại execute.
  useEffect(() => {
    const controller = new AbortController()
    getBrowserActiveOperation(controller.signal).then((operation) => {
      if (operation === null || controller.signal.aborted || !mounted.current) return
      const followed = fileOpsFollowOperation(current.current, operation)
      if (followed === current.current) return
      generation.current++
      publish(followed)
      void poll()
    }, () => undefined) // Chỉ là khôi phục; backend lỗi sẽ hiện khi người dùng thao tác.
    return () => controller.abort()
  }, [poll, publish])

  const begin = useCallback(async (call: (signal: AbortSignal) => Promise<FileOpsPreviewStart>) => {
    const active = current.current
    const starting = fileOpsBeginStart(active)
    if (!mounted.current || starting === active) return
    stopRequest()
    const responseGeneration = ++generation.current
    publish(starting)
    setError(null)
    const controller = new AbortController()
    request.current = controller
    try {
      const started = await call(controller.signal)
      if (isStale(controller, responseGeneration)) return
      publish(fileOpsTrackPreview(current.current, started.previewId))
    } catch (cause) {
      if (isStale(controller, responseGeneration)) return
      setError(fileOpsError(cause))
      publish(fileOpsStartFailure(current.current))
    } finally {
      if (request.current === controller) {
        request.current = null
        void poll()
      }
    }
  }, [isStale, poll, publish, stopRequest])

  const startCleanup = useCallback(
    (input: CleanupPreviewInput) => begin((signal) => startBrowserCleanupPreview(input, signal)),
    [begin]
  )

  const startDelete = useCallback(
    (paths: string[]) => begin((signal) => startBrowserDeletePreview(paths, signal)),
    [begin]
  )

  const cancelPreview = useCallback(async () => {
    const active = current.current
    if (!mounted.current || active.phase !== "measuring" || active.cancelPending) return
    stopRequest()
    const responseGeneration = ++generation.current
    publish(fileOpsBeginCancel(active))
    setError(null)
    const controller = new AbortController()
    request.current = controller
    try {
      const preview = await cancelBrowserPreview(active.previewId, controller.signal)
      if (isStale(controller, responseGeneration)
        || !fileOpsAcceptPreview(current.current, preview, generation.current, responseGeneration, "cancel")) return
      publish(fileOpsReceivePreview(current.current, preview))
    } catch (cause) {
      if (isStale(controller, responseGeneration)) return
      const failure = fileOpsError(cause)
      publish(fileOpsPollFailure(current.current, failure.code, cause instanceof ApiError ? cause.statusCode : undefined))
      setError(failure)
    } finally {
      if (request.current === controller) {
        request.current = null
        void poll()
      }
    }
  }, [isStale, poll, publish, stopRequest])

  const summarize = useCallback(async (paths: string[]) => {
    const active = current.current
    if (!mounted.current || request.current || active.phase !== "reviewing" || active.preview === null) return
    const responseGeneration = ++generation.current
    publish(fileOpsBeginSummary(active))
    setError(null)
    const controller = new AbortController()
    request.current = controller
    try {
      const summary = await summarizeBrowserPreview(active.preview.previewId, paths, controller.signal)
      if (isStale(controller, responseGeneration)) return
      publish(fileOpsReceiveSummary(current.current, summary))
    } catch (cause) {
      if (isStale(controller, responseGeneration)) return
      const failure = fileOpsError(cause)
      publish(fileOpsSummaryFailure(current.current, failure.code))
      setError(failure)
    } finally {
      if (request.current === controller) request.current = null
    }
  }, [isStale, publish])

  const closeSummary = useCallback(() => {
    setError(null)
    publish(fileOpsCloseSummary(current.current))
  }, [publish])

  const send = useCallback(async (next: FileOpsUiState) => {
    if (!mounted.current || request.current || next.phase !== "executing") return
    const responseGeneration = ++generation.current
    publish(next)
    setError(null)
    const controller = new AbortController()
    request.current = controller
    try {
      const started = await executeBrowserDelete(next.input, controller.signal)
      if (isStale(controller, responseGeneration)) return
      publish(fileOpsTrackOperation(current.current, started.operationId))
    } catch (cause) {
      if (isStale(controller, responseGeneration)) return
      const failure = fileOpsError(cause)
      publish(fileOpsExecuteFailure(current.current, failure.code))
      setError(failure)
    } finally {
      if (request.current === controller) {
        request.current = null
        void poll()
      }
    }
  }, [isStale, poll, publish])

  const execute = useCallback(
    (input: FileOpsExecuteInput) => send(fileOpsBeginExecute(current.current, input)),
    [send]
  )

  const resendExecute = useCallback(() => {
    const active = current.current
    return active.phase === "unconfirmed" ? send(fileOpsBeginExecute(active)) : Promise.resolve()
  }, [send])

  const abandon = useCallback(() => {
    setError(null)
    publish(fileOpsAbandon(current.current))
  }, [publish])

  const cancelOperation = useCallback(async () => {
    const active = current.current
    if (!mounted.current || active.phase !== "operating" || active.cancelPending) return
    stopRequest()
    const responseGeneration = ++generation.current
    publish(fileOpsBeginCancel(active))
    setError(null)
    const controller = new AbortController()
    request.current = controller
    try {
      const operation = await cancelBrowserOperation(active.operationId, controller.signal)
      if (isStale(controller, responseGeneration)
        || !fileOpsAcceptOperation(current.current, operation, generation.current, responseGeneration, "cancel")) return
      publish(fileOpsReceiveOperation(current.current, operation))
    } catch (cause) {
      if (isStale(controller, responseGeneration)) return
      const failure = fileOpsError(cause)
      publish(fileOpsPollFailure(current.current, failure.code, cause instanceof ApiError ? cause.statusCode : undefined))
      setError(failure)
    } finally {
      if (request.current === controller) {
        request.current = null
        void poll()
      }
    }
  }, [isStale, poll, publish, stopRequest])

  const retryPoll = useCallback(() => {
    const active = current.current
    const next = fileOpsRetryPoll(active)
    if (next === active || request.current) return
    publish(next)
    setError(null)
    void poll()
  }, [poll, publish])

  const reset = useCallback(() => {
    const active = current.current
    const next = fileOpsReset(active)
    if (next === active) return
    stopRequest()
    generation.current++
    setError(null)
    publish(next)
  }, [publish, stopRequest])

  return {
    state, error, startCleanup, startDelete, cancelPreview, summarize, closeSummary,
    execute, resendExecute, abandon, cancelOperation, retryPoll, reset,
  }
}
