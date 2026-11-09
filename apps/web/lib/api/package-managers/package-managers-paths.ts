export const packageManagersPaths = {
  project: (path: string): string => `/package-managers/project?${new URLSearchParams({ path })}`,
  versions: "/package-managers/versions",
  preview: "/package-managers/project/preview",
  execute: "/package-managers/project/execute",
  latest: "/package-managers/jobs/latest",
  job(id: string): string {
    return `/package-managers/jobs/${encodeURIComponent(id)}`
  },
  cancel(id: string): string {
    return `/package-managers/jobs/${encodeURIComponent(id)}/cancel`
  },
}
