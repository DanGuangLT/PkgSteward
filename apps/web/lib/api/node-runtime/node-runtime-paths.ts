export const nodeRuntimePaths = {
  overview: (refresh = false) =>
    refresh ? "/node-runtime?refresh=true" : "/node-runtime",
  project: (path: string) =>
    `/node-runtime/project?${new URLSearchParams({ path })}`,
}
