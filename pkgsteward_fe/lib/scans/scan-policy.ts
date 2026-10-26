import type { ScanStatus } from "../api/types"

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
