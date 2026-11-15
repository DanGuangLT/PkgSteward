export const diskUsagePaths = {
  start: "/disk-usage",
  active: "/disk-usage/active",
  job: (id: string): string => `/disk-usage/${encodeURIComponent(id)}`,
  cancel: (id: string): string => `/disk-usage/${encodeURIComponent(id)}/cancel`,
}
