import type { DiskUsageRow, DiskView } from "../api/types.ts"

export function sortDiskRows(rows: readonly DiskUsageRow[], locale: string): DiskUsageRow[] {
  return [...rows].sort((a, b) => {
    if (a.sizeBytes === null && b.sizeBytes !== null) return 1
    if (a.sizeBytes !== null && b.sizeBytes === null) return -1
    return (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0)
      || a.name.localeCompare(b.name, locale)
      || a.path.localeCompare(b.path, locale)
  })
}

export function diskSizeKind(sizeBytes: number | null, partial: boolean): "pending" | "lower_bound" | "exact" {
  if (sizeBytes === null) return "pending"
  return partial ? "lower_bound" : "exact"
}

export function diskUsageHref(path: string, view: DiskView): string {
  return `/disk-usage?${new URLSearchParams({ path, view })}`
}
