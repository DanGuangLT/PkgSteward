import { fileOpsPaths } from "./file-ops-paths.ts"
import { requestApi } from "./request.ts"
import { unwrapApiData } from "./response.ts"
import type {
  CleanupPreviewInput, FileOpsExecuteInput, FileOpsOperation, FileOpsOperationStart,
  FileOpsPreview, FileOpsPreviewStart, FileOpsSummary, FileTreeLevel,
} from "@/lib/api/types"

const postJson = (input: unknown, signal?: AbortSignal): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(input),
  signal,
})

export async function getBrowserFileTree(path: string, signal?: AbortSignal): Promise<FileTreeLevel> {
  return unwrapApiData(await requestApi<FileTreeLevel>(`/api${fileOpsPaths.tree(path)}`, { method: "GET", signal }))
}

export async function startBrowserCleanupPreview(input: CleanupPreviewInput, signal?: AbortSignal): Promise<FileOpsPreviewStart> {
  return unwrapApiData(await requestApi<FileOpsPreviewStart>(`/api${fileOpsPaths.cleanupPreview}`, postJson(input, signal)))
}

export async function startBrowserDeletePreview(paths: string[], signal?: AbortSignal): Promise<FileOpsPreviewStart> {
  return unwrapApiData(await requestApi<FileOpsPreviewStart>(`/api${fileOpsPaths.deletePreview}`, postJson({ paths }, signal)))
}

export async function pollBrowserPreview(id: string, signal?: AbortSignal): Promise<FileOpsPreview> {
  return unwrapApiData(await requestApi<FileOpsPreview>(`/api${fileOpsPaths.preview(id)}`, { method: "GET", signal }))
}

export async function cancelBrowserPreview(id: string, signal?: AbortSignal): Promise<FileOpsPreview> {
  return unwrapApiData(await requestApi<FileOpsPreview>(`/api${fileOpsPaths.previewCancel(id)}`, { method: "POST", signal }))
}

export async function summarizeBrowserPreview(id: string, paths: string[], signal?: AbortSignal): Promise<FileOpsSummary> {
  return unwrapApiData(await requestApi<FileOpsSummary>(`/api${fileOpsPaths.previewSummary(id)}`, postJson({ paths }, signal)))
}

// Không timeout: mất phản hồi giữa lúc backend đã nhận sẽ thành lỗi giả sau khi xoá đã chạy.
export async function executeBrowserDelete(input: FileOpsExecuteInput, signal?: AbortSignal): Promise<FileOpsOperationStart> {
  return unwrapApiData(await requestApi<FileOpsOperationStart>(`/api${fileOpsPaths.execute}`, postJson(input, signal), null))
}

export async function getBrowserActiveOperation(signal?: AbortSignal): Promise<FileOpsOperation | null> {
  return unwrapApiData(await requestApi<FileOpsOperation | null>(`/api${fileOpsPaths.activeOperation}`, { method: "GET", signal }))
}

export async function pollBrowserOperation(id: string, signal?: AbortSignal): Promise<FileOpsOperation> {
  return unwrapApiData(await requestApi<FileOpsOperation>(`/api${fileOpsPaths.operation(id)}`, { method: "GET", signal }))
}

export async function cancelBrowserOperation(id: string, signal?: AbortSignal): Promise<FileOpsOperation> {
  return unwrapApiData(await requestApi<FileOpsOperation>(`/api${fileOpsPaths.operationCancel(id)}`, { method: "POST", signal }))
}
