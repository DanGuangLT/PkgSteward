import "server-only"

import { apiFetchEnvelope } from "@/lib/api/client"
import { fileOpsPaths } from "@/lib/api/file-ops/file-ops-paths"
import type {
  ApiResponse, CleanupPreviewInput, FileOpsExecuteInput, FileOpsOperation, FileOpsOperationStart,
  FileOpsPreview, FileOpsPreviewStart, FileOpsSummary, FileTreeLevel,
} from "@/lib/api/types"

const postJson = (input: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(input),
})

export function getFileTree(path: string): Promise<ApiResponse<FileTreeLevel>> {
  return apiFetchEnvelope<FileTreeLevel>(fileOpsPaths.tree(path), { method: "GET" })
}

export function startCleanupPreview(input: CleanupPreviewInput): Promise<ApiResponse<FileOpsPreviewStart>> {
  return apiFetchEnvelope<FileOpsPreviewStart>(fileOpsPaths.cleanupPreview, postJson(input))
}

export function startDeletePreview(input: { paths: string[] }): Promise<ApiResponse<FileOpsPreviewStart>> {
  return apiFetchEnvelope<FileOpsPreviewStart>(fileOpsPaths.deletePreview, postJson(input))
}

export function getPreview(id: string): Promise<ApiResponse<FileOpsPreview>> {
  return apiFetchEnvelope<FileOpsPreview>(fileOpsPaths.preview(id), { method: "GET" })
}

export function cancelPreview(id: string): Promise<ApiResponse<FileOpsPreview>> {
  return apiFetchEnvelope<FileOpsPreview>(fileOpsPaths.previewCancel(id), { method: "POST" })
}

export function summarizePreview(id: string, input: { paths: string[] }): Promise<ApiResponse<FileOpsSummary>> {
  return apiFetchEnvelope<FileOpsSummary>(fileOpsPaths.previewSummary(id), postJson(input))
}

// Preflight kiểm lại git + tiến trình cho từng project nên có thể vượt timeout chung.
export function executeDelete(input: FileOpsExecuteInput): Promise<ApiResponse<FileOpsOperationStart>> {
  return apiFetchEnvelope<FileOpsOperationStart>(fileOpsPaths.execute, postJson(input), null)
}

export function getActiveOperation(): Promise<ApiResponse<FileOpsOperation | null>> {
  return apiFetchEnvelope<FileOpsOperation | null>(fileOpsPaths.activeOperation, { method: "GET" })
}

export function getOperation(id: string): Promise<ApiResponse<FileOpsOperation>> {
  return apiFetchEnvelope<FileOpsOperation>(fileOpsPaths.operation(id), { method: "GET" })
}

export function cancelOperation(id: string): Promise<ApiResponse<FileOpsOperation>> {
  return apiFetchEnvelope<FileOpsOperation>(fileOpsPaths.operationCancel(id), { method: "POST" })
}
