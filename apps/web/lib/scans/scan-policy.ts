import type { ScanJob, ScanStatus } from "@/lib/api/types"

export type ScanUiState = { phase: "idle" } | { phase: "starting" }
  | { phase: "tracking"; scanId: string; job: ScanJob | null;
      cancelPending: boolean; pollErrorCode?: string }
  | { phase: "refreshing"; job: ScanJob }

export function initialScanUiState(activeScan: ScanJob | null): ScanUiState {
  return activeScan?.status === "running"
    ? { phase: "tracking", scanId: activeScan.scanId, job: activeScan, cancelPending: false }
    : { phase: "idle" }
}

export function pollFailureAction(code: string): "pause" | "abandon" {
  return code === "NOT_FOUND" ? "abandon" : "pause"
}

export function shouldPoll(status: ScanStatus, visible: boolean): boolean {
  return status === "running" && visible
}

export function terminalAction(status: ScanStatus): "none" | "refresh" | "cancelled" | "failed" {
  if (status === "completed" || status === "timed_out") return "refresh"
  if (status === "cancelled" || status === "failed") return status
  return "none"
}
