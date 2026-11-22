export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const

export type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number]

export interface PaginationMeta {
  totalItems: number
  pageSize: number
  page: number
  totalPages: number
  startIndex: number
  endIndex: number
  showingFrom: number
  showingTo: number
  hasPrev: boolean
  hasNext: boolean
  enabled: boolean
}

export type PageToken =
  | { type: "page"; page: number }
  | { type: "ellipsis"; key: string }

/**
 * Resolves a numeric page size against supported presets, falling back cleanly
 * when unconfigured or outside the preset set.
 */
export function normalizePageSize(
  value: number | null | undefined,
  fallback: PageSizeOption = 25,
): PageSizeOption {
  if (typeof value === "number" && (PAGE_SIZE_OPTIONS as readonly number[]).includes(value)) {
    return value as PageSizeOption
  }
  return fallback
}

/**
 * Computes clamped 1-based page metadata and slice bounds for a filtered list.
 */
export function computePagination(
  totalItems: number,
  requestedPage: number,
  requestedPageSize: number,
  enabled = true,
): PaginationMeta {
  const safeTotal = Number.isFinite(totalItems) && totalItems > 0 ? Math.trunc(totalItems) : 0
  const pageSize = normalizePageSize(requestedPageSize)

  if (!enabled) {
    return {
      totalItems: safeTotal,
      pageSize,
      page: 1,
      totalPages: 1,
      startIndex: 0,
      endIndex: safeTotal,
      showingFrom: safeTotal > 0 ? 1 : 0,
      showingTo: safeTotal,
      hasPrev: false,
      hasNext: false,
      enabled: false,
    }
  }

  const totalPages = Math.max(1, Math.ceil(safeTotal / pageSize))
  const rawPage = Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1
  const page = Math.min(Math.max(1, rawPage), totalPages)
  const startIndex = safeTotal === 0 ? 0 : (page - 1) * pageSize
  const endIndex = safeTotal === 0 ? 0 : Math.min(startIndex + pageSize, safeTotal)

  return {
    totalItems: safeTotal,
    pageSize,
    page,
    totalPages,
    startIndex,
    endIndex,
    showingFrom: safeTotal === 0 ? 0 : startIndex + 1,
    showingTo: endIndex,
    hasPrev: page > 1,
    hasNext: page < totalPages,
    enabled: true,
  }
}

/**
 * Slices items using precomputed pagination bounds without mutating the source array.
 */
export function slicePage<T>(items: readonly T[], meta: PaginationMeta): T[] {
  if (!meta.enabled) return items.slice()
  if (items.length === 0) return []
  return items.slice(meta.startIndex, meta.endIndex)
}

/**
 * Builds compact page number and ellipsis tokens around the active page.
 */
export function buildPageTokens(
  currentPage: number,
  totalPages: number,
  siblingCount = 1,
): PageToken[] {
  const safeTotal = Number.isFinite(totalPages) && totalPages > 0 ? Math.trunc(totalPages) : 0
  if (safeTotal === 0) return []
  if (safeTotal === 1) return [{ type: "page", page: 1 }]

  const siblings = Number.isFinite(siblingCount) && siblingCount >= 0 ? Math.trunc(siblingCount) : 1
  const clampedCurrent = Math.min(
    Math.max(1, Number.isFinite(currentPage) ? Math.trunc(currentPage) : 1),
    safeTotal,
  )

  if (safeTotal <= 5 + siblings * 2) {
    return Array.from({ length: safeTotal }, (_, index) => ({
      type: "page" as const,
      page: index + 1,
    }))
  }

  let leftSibling = Math.max(2, clampedCurrent - siblings)
  let rightSibling = Math.min(safeTotal - 1, clampedCurrent + siblings)

  const showLeftEllipsis = leftSibling > 3
  const showRightEllipsis = rightSibling < safeTotal - 2

  if (!showLeftEllipsis) {
    leftSibling = 2
    rightSibling = Math.max(rightSibling, Math.min(safeTotal - 1, 2 + siblings * 2))
  }
  if (!showRightEllipsis) {
    rightSibling = safeTotal - 1
    leftSibling = Math.min(leftSibling, Math.max(2, safeTotal - 1 - siblings * 2))
  }

  const tokens: PageToken[] = [{ type: "page", page: 1 }]
  if (showLeftEllipsis) {
    tokens.push({ type: "ellipsis", key: "left" })
  }
  for (let page = leftSibling; page <= rightSibling; page += 1) {
    tokens.push({ type: "page", page })
  }
  if (showRightEllipsis) {
    tokens.push({ type: "ellipsis", key: "right" })
  }
  tokens.push({ type: "page", page: safeTotal })

  return tokens
}
