export const scanPaths = {
  start: "/scans",
  latest: "/scans/latest",
  job: (id: string): string => `/scans/${encodeURIComponent(id)}`,
  cancel: (id: string): string => `/scans/${encodeURIComponent(id)}/cancel`,
}
