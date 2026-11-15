export const scanPaths = {
  start: "/scans",
  active: "/scans/active",
  latest: "/scans/latest",
  job: (id: string): string => `/scans/${encodeURIComponent(id)}`,
  cancel: (id: string): string => `/scans/${encodeURIComponent(id)}/cancel`,
}
