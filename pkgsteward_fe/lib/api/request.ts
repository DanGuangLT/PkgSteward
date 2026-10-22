import { ApiError, readApiResponse } from "./response.ts"
import type { ApiResponse } from "./types"

export const API_TIMEOUT_MS = 10000

function transportError(callerSignal?: AbortSignal | null): ApiError | DOMException {
  return callerSignal?.aborted
    ? new DOMException("The request was aborted.", "AbortError")
    : new ApiError(503, "The backend is unavailable.", "BACKEND_UNAVAILABLE")
}

export async function requestApi<T>(url: string, init: RequestInit = {}): Promise<ApiResponse<T>> {
  const timeout = AbortSignal.timeout(API_TIMEOUT_MS)
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  let response: Response
  try {
    response = await fetch(url, { ...init, cache: "no-store", signal })
  } catch {
    throw transportError(init.signal)
  }
  try {
    return await readApiResponse<T>(response)
  } catch (error) {
    // Fetch có thể đã nhận headers khi timeout/huỷ ngắt luồng đọc body.
    if (signal.aborted) throw transportError(init.signal)
    throw error
  }
}
