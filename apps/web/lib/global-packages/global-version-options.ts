export function newestGlobalVersions(versions: readonly string[]): string[] {
  // The API supplies validated exact versions. Ignore build metadata for precedence.
  const parts = (version: string) => {
    const [core, ...pre] = version.split("+", 1)[0].split("-")
    return { core: core.split("."), pre: pre.length ? pre.join("-").split(".") : [] }
  }
  const compare = (a: string, b: string) => a === b ? 0 : a < b ? -1 : 1
  const numeric = (a: string, b: string) => a.length - b.length || compare(a, b)
  return versions.map(version => ({ version, ...parts(version) })).sort((a, b) => {
    for (let i = 0; i < 3; i++) {
      const order = numeric(b.core[i], a.core[i])
      if (order) return order
    }
    if (!a.pre.length || !b.pre.length) return Number(!!a.pre.length) - Number(!!b.pre.length)
    for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
      if (a.pre[i] === undefined) return 1
      if (b.pre[i] === undefined) return -1
      const aNumeric = /^\d+$/.test(a.pre[i]), bNumeric = /^\d+$/.test(b.pre[i])
      const order = aNumeric && bNumeric ? numeric(b.pre[i], a.pre[i])
        : aNumeric !== bNumeric ? Number(aNumeric) - Number(bNumeric) : compare(b.pre[i], a.pre[i])
      if (order) return order
    }
    return 0
  }).map(item => item.version)
}
