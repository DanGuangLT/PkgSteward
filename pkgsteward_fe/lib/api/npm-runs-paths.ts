export const npmRunsPaths = {
  context: (path: string): string => `/npm-runs/context?${new URLSearchParams({ path })}`,
  start: "/npm-runs",
  latest: "/npm-runs/latest",
  job: (id: string): string => `/npm-runs/${encodeURIComponent(id)}`,
  cancel: (id: string): string => `/npm-runs/${encodeURIComponent(id)}/cancel`,
  logs(id: string, cursor = 0): string {
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new RangeError("Invalid log cursor")
    return `/npm-runs/${encodeURIComponent(id)}/logs?${new URLSearchParams({ cursor: String(cursor) })}`
  },
}
