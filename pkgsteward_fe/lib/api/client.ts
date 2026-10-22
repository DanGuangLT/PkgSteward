import "server-only"

import { requestApi } from "./request.ts"
import { unwrapApiData } from "./response.ts"
import type { ApiResponse } from "./types"

const API_BASE_URL = (process.env.API_BASE_URL || "http://127.0.0.1:24681/api/v1").replace(/\/+$/, "")

export function apiFetchEnvelope<T>(path: string, init?: RequestInit): Promise<ApiResponse<T>> {
  return requestApi<T>(`${API_BASE_URL}/${path.replace(/^\/+/, "")}`, init)
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return unwrapApiData(await apiFetchEnvelope<T>(path, init))
}
