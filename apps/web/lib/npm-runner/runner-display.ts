import { isRunActive, isRunSuccessful, runnerEligibility } from "./runner-policy.ts"
import type { RunAction, RunStatus } from "@/lib/api/types"
import type { RunnerSelection, RunnerState } from "@/lib/npm-runner/runner-policy"

export function runnerUsesPackage(action: RunAction): boolean {
  return action === "install_one" || action === "update_one" || action === "uninstall_one"
}

export function runnerDisplay(state: RunnerState, selection: RunnerSelection, serverContextError: string | null = null) {
  const job = state.job
  const canCancel = job ? isRunActive(job) : state.phase === "tracking"
  const busy = state.phase === "starting" || state.phase === "tracking" || state.phase === "lost"
    || state.startUnknown || state.cancelUnknown || state.cancelPending || state.pollError !== null
    || Boolean(job && isRunActive(job)) || state.error?.code === "RUNNING"
  const effective = !state.context && !state.contextError && serverContextError
    ? { ...state, contextError: serverContextError } : state
  const blockedReason = state.cancelUnknown ? "CANCEL_UNKNOWN" : state.phase === "lost" ? "LOST"
    : runnerEligibility(effective, selection)
  const cancelLabel: "stopping" | "retryCleanup" | "cancel" = state.cancelPending ? "stopping"
    : job && (job.status === "termination_failed" || (job.gateHeld && job.status !== "running" && job.status !== "stopping"))
      ? "retryCleanup" : "cancel"
  const status: RunStatus | "idle" | "starting" | "startUnknown" | "cancelUnknown" | "lost" | "success" | "incomplete" =
    state.startUnknown ? "startUnknown" : state.cancelUnknown ? "cancelUnknown" : state.phase === "lost" ? "lost"
      : state.phase === "starting" ? "starting" : job?.status === "completed"
        ? isRunSuccessful(job) ? "success" : "incomplete" : job?.status ?? "idle"
  return { busy, blockedReason, canCancel, cancelLabel, status }
}
