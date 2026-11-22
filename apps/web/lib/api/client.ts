import "server-only"

import { requestApi } from "./request.ts"
import { unwrapApiData } from "./response.ts"
import type { ApiResponse } from "@/lib/api/types"

const API_BASE_URL = (process.env.API_BASE_URL || "http://127.0.0.1:24681/api/v1").replace(/\/+$/, "")

export function apiFetchEnvelope<T>(path: string, init?: RequestInit, timeoutMs?: number | null): Promise<ApiResponse<T>> {
  return requestApi<T>(`${API_BASE_URL}/${path.replace(/^\/+/, "")}`, init, timeoutMs)
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return unwrapApiData(await apiFetchEnvelope<T>(path, init))
}

export async function apiFetchRawBinary(
  path: string,
  init: RequestInit = {},
  timeoutMs: number | null = 20_000
): Promise<Response> {
  const url = `${API_BASE_URL}/${path.replace(/^\/+/, "")}`
  const timeout = timeoutMs === null ? null : AbortSignal.timeout(timeoutMs)
  const signal =
    timeout && init.signal
      ? AbortSignal.any([init.signal, timeout])
      : timeout ?? init.signal ?? undefined
  return fetch(url, { ...init, cache: "no-store", signal })
}
