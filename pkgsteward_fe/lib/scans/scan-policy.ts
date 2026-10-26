import type { ScanStatus } from "../api/types"

export function shouldPoll(status: ScanStatus, visible: boolean): boolean {
  return status === "running" && visible
}

export function terminalAction(status: ScanStatus): "none" | "refresh" | "cancelled" | "failed" {
  if (status === "completed" || status === "timed_out") return "refresh"
  if (status === "cancelled" || status === "failed") return status
  return "none"
}
