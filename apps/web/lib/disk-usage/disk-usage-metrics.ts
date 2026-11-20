import type { DiskUsageJob, ScannedProject } from "@/lib/api/types"

export interface DiskTopChild {
  name: string
  path: string
  sizeBytes: number
  sharePercent: number | null
}

export interface DiskUsageMetrics {
  totalBytes: number | null
  totalFiles: number | null
  itemCount: number
  maxChildBytes: number
  topChild: DiskTopChild | null
  excludedCount: number
  partialCount: number
}

export function diskRowSharePercent(rowBytes: number | null, totalBytes: number | null): number | null {
  if (rowBytes === null || totalBytes === null || totalBytes <= 0) return null
  if (rowBytes <= 0) return 0
  const pct = (rowBytes / totalBytes) * 100
  return Math.min(100, Math.round(pct * 10) / 10)
}

export function diskRowBarWidthPercent(rowBytes: number | null, maxBytes: number): number {
  if (rowBytes === null || rowBytes <= 0 || maxBytes <= 0) return 0
  return Math.min(100, Math.max(4, Math.round((rowBytes / maxBytes) * 100)))
}

export function computeDiskUsageMetrics(job: DiskUsageJob): DiskUsageMetrics {
  let maxChildBytes = 0
  let topRow: { name: string; path: string; sizeBytes: number } | null = null
  let excludedCount = 0
  let partialCount = 0

  for (const row of job.children) {
    if (row.state === "excluded") excludedCount += 1
    if (row.state === "partial") partialCount += 1
    if (row.sizeBytes !== null && row.sizeBytes > maxChildBytes) {
      maxChildBytes = row.sizeBytes
      topRow = { name: row.name, path: row.path, sizeBytes: row.sizeBytes }
    }
  }

  return {
    totalBytes: job.sizeBytes,
    totalFiles: job.fileCount,
    itemCount: job.children.length,
    maxChildBytes,
    topChild: topRow
      ? {
          ...topRow,
          sharePercent: diskRowSharePercent(topRow.sizeBytes, job.sizeBytes),
        }
      : null,
    excludedCount,
    partialCount,
  }
}

export function selectTopHeaviestProjects(
  projects: readonly ScannedProject[],
  limit = 6,
): ScannedProject[] {
  if (limit <= 0) return []
  return projects
    .filter((project) => project.nodeModules.exists)
    .sort((a, b) => {
      const aSize = a.nodeModules.sizeBytes
      const bSize = b.nodeModules.sizeBytes
      if (aSize !== null && bSize === null) return -1
      if (aSize === null && bSize !== null) return 1
      if (aSize !== null && bSize !== null && aSize !== bSize) return bSize - aSize
      const aTime = Date.parse(a.lastActivityAt)
      const bTime = Date.parse(b.lastActivityAt)
      if (!Number.isNaN(aTime) && !Number.isNaN(bTime) && aTime !== bTime) return bTime - aTime
      return a.path.localeCompare(b.path)
    })
    .slice(0, limit)
}
