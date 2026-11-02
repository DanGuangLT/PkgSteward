export const projectsPaths = {
  detail: (path: string): string => `/projects?${new URLSearchParams({ path })}`,
  start: "/projects/analyses",
  job: (id: string): string => `/projects/analyses/${encodeURIComponent(id)}`,
  cancel: (id: string): string => `/projects/analyses/${encodeURIComponent(id)}/cancel`,
}
