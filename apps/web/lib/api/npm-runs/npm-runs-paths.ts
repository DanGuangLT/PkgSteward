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
  terminalOutput(id: string, generation: number, cursor = 0): string {
    if (!Number.isSafeInteger(generation) || generation < 1) throw new RangeError("Invalid terminal generation")
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new RangeError("Invalid terminal cursor")
    return `/npm-runs/${encodeURIComponent(id)}/terminal-output?${new URLSearchParams({
      generation: String(generation),
      cursor: String(cursor),
    })}`
  },
  terminalClaim: (id: string): string => `/npm-runs/${encodeURIComponent(id)}/terminal-claim`,
  terminalInput: (id: string): string => `/npm-runs/${encodeURIComponent(id)}/terminal-input`,
  terminalInputAck: (id: string): string => `/npm-runs/${encodeURIComponent(id)}/terminal-input-ack`,
  terminalResize: (id: string): string => `/npm-runs/${encodeURIComponent(id)}/terminal-resize`,
}
