"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { cancelBrowserScan, pollBrowserScan, startBrowserScan } from "@/lib/api/scan-browser"
import { ApiError } from "@/lib/api/response"
import type { ScanJob } from "@/lib/api/types"
import { pollFailureAction, shouldPoll, terminalAction } from "@/lib/scans/scan-policy"

export type ScanUiState = { phase: "idle" } | { phase: "starting" }
  | { phase: "tracking"; scanId: string; job: ScanJob | null;
      cancelPending: boolean; pollErrorCode?: string }
  | { phase: "refreshing"; job: ScanJob }

export interface ScanController {
  state: ScanUiState
  start(): Promise<void>
  cancel(): Promise<void>
  retryPoll(): void
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError"
}

function errorCode(error: unknown): string {
  return error instanceof ApiError ? error.code ?? "UNKNOWN" : "UNKNOWN"
}

export function useScan(): ScanController {
  const router = useRouter()
  const t = useTranslations("projects")
  const [state, setState] = useState<ScanUiState>({ phase: "idle" })
  const [refreshPending, startTransition] = useTransition()
  const current = useRef<ScanUiState>({ phase: "idle" })
  const mounted = useRef(false)
  const request = useRef<AbortController | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notifiedScanId = useRef<string | null>(null)

  const publish = useCallback((next: ScanUiState) => {
    current.current = next
    setState(next)
  }, [])

  const stopRequest = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    request.current?.abort()
    request.current = null
  }, [])

  const notifyError = useCallback((error: unknown) => {
    const code = errorCode(error)
    toast.error(code === "RATE_LIMITED" ? t("errors.rateLimited")
      : code === "BACKEND_UNAVAILABLE" ? t("errors.backendUnavailable")
        : t("errors.generic"))
  }, [t])

  const abandon = useCallback((scanId: string) => {
    const active = current.current
    if (!mounted.current || active.phase !== "tracking" || active.scanId !== scanId) return

    stopRequest()
    if (notifiedScanId.current !== scanId) {
      notifiedScanId.current = scanId
      toast.warning(t("toasts.lost"))
    }
    publish({ phase: "idle" })
  }, [publish, stopRequest, t])

  const applyJob = useCallback((job: ScanJob) => {
    const active = current.current
    if (!mounted.current || active.phase !== "tracking" || active.scanId !== job.scanId) return

    const action = terminalAction(job.status)
    if (action === "none") {
      publish({ phase: "tracking", scanId: job.scanId, job, cancelPending: false })
      return
    }

    stopRequest()
    if (notifiedScanId.current !== job.scanId) {
      notifiedScanId.current = job.scanId
      if (job.status === "completed") toast.success(t("toasts.completed"))
      else if (job.status === "timed_out") toast.warning(t("toasts.partial"))
      else if (action === "cancelled") toast.info(t("toasts.cancelled"))
      else toast.error(t("toasts.failed"))
    }

    if (action === "refresh") {
      publish({ phase: "refreshing", job })
      startTransition(() => router.refresh())
    } else {
      publish({ phase: "idle" })
    }
  }, [publish, router, startTransition, stopRequest, t])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      stopRequest()
    }
  }, [stopRequest])

  const poll = useCallback(async function pollOnce() {
    const active = current.current
    if (!mounted.current || request.current || active.phase !== "tracking" ||
      active.cancelPending || active.pollErrorCode !== undefined ||
      !shouldPoll(active.job?.status ?? "running", document.visibilityState === "visible")) return

    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    const controller = new AbortController()
    request.current = controller
    try {
      const job = await pollBrowserScan(active.scanId, controller.signal)
      if (!mounted.current || controller.signal.aborted || request.current !== controller) return
      applyJob(job)
    } catch (error) {
      if (!mounted.current || controller.signal.aborted || request.current !== controller || isAbort(error)) return
      const latest = current.current
      if (latest.phase === "tracking" && latest.scanId === active.scanId) {
        const code = errorCode(error)
        if (pollFailureAction(code) === "abandon") abandon(active.scanId)
        else publish({ ...latest, pollErrorCode: code })
      }
    } finally {
      if (request.current === controller) request.current = null
    }

    const latest = current.current
    if (mounted.current && !controller.signal.aborted && latest.phase === "tracking" &&
      latest.scanId === active.scanId && !latest.cancelPending && latest.pollErrorCode === undefined &&
      shouldPoll(latest.job?.status ?? "running", document.visibilityState === "visible")) {
      timer.current = setTimeout(() => {
        timer.current = null
        void pollOnce()
      }, 1000)
    }
  }, [abandon, applyJob, publish])

  useEffect(() => {
    function pausePoll() {
      const active = current.current
      if (active.phase === "tracking" && !active.cancelPending) stopRequest()
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") void poll()
      else pausePoll()
    }

    document.addEventListener("visibilitychange", onVisibilityChange)
    void poll()
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange)
      pausePoll()
    }
  }, [poll, stopRequest])

  const start = useCallback(async () => {
    const active = current.current
    if (!mounted.current || request.current ||
      (active.phase !== "idle" && !(active.phase === "refreshing" && !refreshPending))) return

    publish({ phase: "starting" })
    const controller = new AbortController()
    request.current = controller
    try {
      const job = await startBrowserScan(controller.signal)
      if (!mounted.current || controller.signal.aborted || request.current !== controller) return
      publish({ phase: "tracking", scanId: job.scanId, job: null, cancelPending: false })
    } catch (error) {
      if (!mounted.current || controller.signal.aborted || request.current !== controller) return
      if (!isAbort(error)) notifyError(error)
      publish({ phase: "idle" })
    } finally {
      if (request.current === controller) {
        request.current = null
        void poll()
      }
    }
  }, [notifyError, poll, publish, refreshPending])

  const cancel = useCallback(async () => {
    const active = current.current
    if (!mounted.current || active.phase !== "tracking" || active.cancelPending) return

    // Huỷ GET cũ trước POST để kết quả poll không ghi đè kết quả huỷ.
    stopRequest()
    publish({ ...active, cancelPending: true, pollErrorCode: undefined })
    const controller = new AbortController()
    request.current = controller
    try {
      const job = await cancelBrowserScan(active.scanId, controller.signal)
      if (!mounted.current || controller.signal.aborted || request.current !== controller) return
      applyJob(job)
    } catch (error) {
      if (!mounted.current || controller.signal.aborted || request.current !== controller) return
      if (!isAbort(error)) {
        if (pollFailureAction(errorCode(error)) === "abandon") abandon(active.scanId)
        else notifyError(error)
      }
    } finally {
      if (request.current === controller) {
        request.current = null
        const latest = current.current
        if (mounted.current && latest.phase === "tracking" && latest.scanId === active.scanId) {
          publish({ ...latest, cancelPending: false })
          void poll()
        }
      }
    }
  }, [abandon, applyJob, notifyError, poll, publish, stopRequest])

  const retryPoll = useCallback(() => {
    const active = current.current
    if (active.phase !== "tracking" || active.cancelPending || active.pollErrorCode === undefined) return
    publish({ ...active, pollErrorCode: undefined })
    void poll()
  }, [poll, publish])

  // Transition hoàn tất thì mở lại nút quét, không sao chép snapshot server vào state.
  const uiState: ScanUiState = state.phase === "refreshing" && !refreshPending ? { phase: "idle" } : state
  return { state: uiState, start, cancel, retryPoll }
}
