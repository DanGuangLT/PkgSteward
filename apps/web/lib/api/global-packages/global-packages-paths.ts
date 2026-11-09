export const globalPackagesPaths = {
  snapshot: "/global-packages",
  inventory: "/global-packages/inventory",
  versions: "/global-packages/versions",
  preview: "/global-packages/preview",
  execute: "/global-packages/execute",
  latest: "/global-packages/jobs/latest",
  job(id: string): string {
    return `/global-packages/jobs/${encodeURIComponent(id)}`
  },
  logs(id: string, cursor = 0): string {
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new RangeError("Invalid log cursor")
    return `/global-packages/jobs/${encodeURIComponent(id)}/logs?${new URLSearchParams({ cursor: String(cursor) })}`
  },
  cancel(id: string): string {
    return `/global-packages/jobs/${encodeURIComponent(id)}/cancel`
  },
}
