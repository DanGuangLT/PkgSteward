import "server-only"

import { apiFetchEnvelope } from "@/lib/api/client"
import { npmRunsPaths } from "@/lib/api/npm-runs/npm-runs-paths"
import type {
  ApiResponse,
  RunnerContext,
  RunRequest,
  RunStart,
  RunJob,
  RunLogPage,
  TerminalClaimRequest,
  TerminalInputAck,
  TerminalInputAckRequest,
  TerminalInputRequest,
  TerminalOutputPage,
  TerminalResizeRequest,
  TerminalResizeResult,
  TerminalWriter,
} from "@/lib/api/types"

export function getRunnerContext(path: string, signal?: AbortSignal): Promise<ApiResponse<RunnerContext>> {
  return apiFetchEnvelope<RunnerContext>(npmRunsPaths.context(path), { method: "GET", signal })
}
export function startNpmRun(input: RunRequest): Promise<ApiResponse<RunStart>> {
  return apiFetchEnvelope<RunStart>(npmRunsPaths.start, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  }, null)
}
export function getLatestNpmRun(signal?: AbortSignal): Promise<ApiResponse<RunJob>> {
  return apiFetchEnvelope<RunJob>(npmRunsPaths.latest, { method: "GET", signal })
}
export function getNpmRun(id: string, signal?: AbortSignal): Promise<ApiResponse<RunJob>> {
  return apiFetchEnvelope<RunJob>(npmRunsPaths.job(id), { method: "GET", signal })
}
export function getNpmRunLogs(id: string, cursor = 0, signal?: AbortSignal): Promise<ApiResponse<RunLogPage>> {
  return apiFetchEnvelope<RunLogPage>(npmRunsPaths.logs(id, cursor), { method: "GET", signal })
}
export function cancelNpmRun(id: string): Promise<ApiResponse<RunJob>> {
  return apiFetchEnvelope<RunJob>(npmRunsPaths.cancel(id), { method: "POST" }, null)
}
export function getNpmRunTerminalOutput(
  id: string,
  generation: number,
  cursor = 0,
  signal?: AbortSignal,
): Promise<ApiResponse<TerminalOutputPage>> {
  return apiFetchEnvelope<TerminalOutputPage>(npmRunsPaths.terminalOutput(id, generation, cursor), {
    method: "GET",
    signal,
  })
}
export function claimNpmRunTerminal(id: string, input: TerminalClaimRequest): Promise<ApiResponse<TerminalWriter>> {
  return apiFetchEnvelope<TerminalWriter>(npmRunsPaths.terminalClaim(id), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  }, null)
}
export function sendNpmRunTerminalInput(id: string, input: TerminalInputRequest): Promise<ApiResponse<TerminalInputAck>> {
  return apiFetchEnvelope<TerminalInputAck>(npmRunsPaths.terminalInput(id), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  }, null)
}
export function getNpmRunTerminalInputAck(
  id: string,
  input: TerminalInputAckRequest,
): Promise<ApiResponse<TerminalInputAck>> {
  return apiFetchEnvelope<TerminalInputAck>(npmRunsPaths.terminalInputAck(id), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  }, null)
}
export function resizeNpmRunTerminal(
  id: string,
  input: TerminalResizeRequest,
): Promise<ApiResponse<TerminalResizeResult>> {
  return apiFetchEnvelope<TerminalResizeResult>(npmRunsPaths.terminalResize(id), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  }, null)
}
