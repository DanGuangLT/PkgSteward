export const diskUsagePaths = {
  start: "/disk-usage",
  job: (id: string): string => `/disk-usage/${encodeURIComponent(id)}`,
  cancel: (id: string): string => `/disk-usage/${encodeURIComponent(id)}/cancel`,
}
