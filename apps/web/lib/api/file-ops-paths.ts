const previewPath = (id: string): string => `/file-ops/previews/${encodeURIComponent(id)}`
const operationPath = (id: string): string => `/file-ops/operations/${encodeURIComponent(id)}`

export const fileOpsPaths = {
  tree: (path: string): string => `/file-ops/tree?${new URLSearchParams({ path })}`,
  cleanupPreview: "/file-ops/cleanup/preview",
  deletePreview: "/file-ops/delete/preview",
  preview: previewPath,
  previewCancel: (id: string): string => `${previewPath(id)}/cancel`,
  previewSummary: (id: string): string => `${previewPath(id)}/summary`,
  execute: "/file-ops/delete/execute",
  activeOperation: "/file-ops/operations/active",
  operation: operationPath,
  operationCancel: (id: string): string => `${operationPath(id)}/cancel`,
}
