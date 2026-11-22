"use client"

import { useCallback, useId, useMemo, useState } from "react"
import type { RefObject } from "react"
import { useTranslations } from "next-intl"
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useSettingsOptional } from "@/components/settings/settings-provider"
import {
  buildPageTokens,
  computePagination,
  normalizePageSize,
  PAGE_SIZE_OPTIONS,
  slicePage,
  type PageSizeOption,
  type PaginationMeta,
} from "@/lib/ui/pagination"
import { cn } from "@/lib/utils"

export interface UseListPaginationOptions {
  /** Changes when filters/search/sort change so page resets cleanly without effects. */
  resetKey: string
  /** Optional scroll anchor used when scrollToTopOnPageChange is active. */
  scrollTargetRef?: RefObject<HTMLElement | null>
}

export interface UseListPaginationResult<T> {
  items: T[]
  meta: PaginationMeta
  page: number
  pageSize: PageSizeOption
  showPageSizeSelector: boolean
  setPage: (nextPage: number) => void
  setPageSize: (nextSize: PageSizeOption) => void
}

/**
 * Slices an already filtered and sorted list using dynamic Settings pagination
 * preferences without mutating filters, searches, metrics, or selection sets.
 */
export function useListPagination<T>(
  filteredItems: readonly T[],
  options: UseListPaginationOptions,
): UseListPaginationResult<T> {
  const { resetKey, scrollTargetRef } = options
  const settings = useSettingsOptional()
  const paginationEnabled = settings?.behavior.paginationEnabled ?? true
  const defaultPageSize = normalizePageSize(settings?.behavior.defaultPageSize)
  const showPageSizeSelector = settings?.behavior.showPageSizeSelector ?? true
  const scrollToTopOnPageChange = settings?.behavior.scrollToTopOnPageChange ?? true

  const [pageState, setPageState] = useState<{ key: string; page: number }>({
    key: resetKey,
    page: 1,
  })
  const [sizeState, setSizeState] = useState<{
    base: PageSizeOption
    value: PageSizeOption
  }>({
    base: defaultPageSize,
    value: defaultPageSize,
  })

  // Derive active size so updates in Settings modal take effect immediately without effects.
  const pageSize = sizeState.base === defaultPageSize ? sizeState.value : defaultPageSize
  const requestedPage = pageState.key === resetKey ? pageState.page : 1

  const meta = useMemo(
    () => computePagination(filteredItems.length, requestedPage, pageSize, paginationEnabled),
    [filteredItems.length, requestedPage, pageSize, paginationEnabled],
  )

  const items = useMemo(() => slicePage(filteredItems, meta), [filteredItems, meta])

  const scrollToTop = useCallback(() => {
    if (!scrollToTopOnPageChange || typeof window === "undefined") return
    const target = scrollTargetRef?.current
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", block: "start" })
      return
    }
    window.scrollTo({ top: 0, behavior: "smooth" })
  }, [scrollTargetRef, scrollToTopOnPageChange])

  const setPage = useCallback(
    (nextPage: number) => {
      const clamped = Math.min(Math.max(1, Math.trunc(nextPage)), meta.totalPages)
      setPageState({ key: resetKey, page: clamped })
      if (clamped !== meta.page) {
        scrollToTop()
      }
    },
    [meta.page, meta.totalPages, resetKey, scrollToTop],
  )

  const setPageSize = useCallback(
    (nextSize: PageSizeOption) => {
      const normalized = normalizePageSize(nextSize, defaultPageSize)
      setSizeState({ base: defaultPageSize, value: normalized })
      setPageState({ key: resetKey, page: 1 })
      scrollToTop()
    },
    [defaultPageSize, resetKey, scrollToTop],
  )

  return {
    items,
    meta,
    page: meta.page,
    pageSize,
    showPageSizeSelector,
    setPage,
    setPageSize,
  }
}

export interface ListPaginationProps {
  meta: PaginationMeta
  pageSize: PageSizeOption
  showPageSizeSelector: boolean
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: PageSizeOption) => void
  className?: string
  ariaLabel?: string
}

/**
 * Accessible pagination bar displaying item range, page navigation buttons,
 * and an optional per-page size selector.
 */
export function ListPagination({
  meta,
  pageSize,
  showPageSizeSelector,
  onPageChange,
  onPageSizeChange,
  className,
  ariaLabel,
}: ListPaginationProps) {
  const t = useTranslations("pagination")
  const selectId = useId()

  if (!meta.enabled || meta.totalItems === 0) return null

  const hasControls =
    meta.totalPages > 1 || (showPageSizeSelector && meta.totalItems > PAGE_SIZE_OPTIONS[0])
  if (!hasControls) return null

  const tokens = buildPageTokens(meta.page, meta.totalPages)

  return (
    <nav
      data-slot="list-pagination"
      aria-label={ariaLabel ?? t("navLabel")}
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card/85 px-3.5 py-2.5 text-body-sm text-foreground backdrop-blur-xs",
        className,
      )}
    >
      <p className="text-caption tabular-nums text-muted-foreground">
        {t("showingRange", {
          from: meta.showingFrom,
          to: meta.showingTo,
          total: meta.totalItems,
        })}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        {showPageSizeSelector && (
          <div className="flex items-center gap-2">
            <label
              htmlFor={selectId}
              className="text-caption whitespace-nowrap text-muted-foreground"
            >
              {t("perPageLabel")}
            </label>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => {
                const parsed = Number(value)
                if ((PAGE_SIZE_OPTIONS as readonly number[]).includes(parsed)) {
                  onPageSizeChange(parsed as PageSizeOption)
                }
              }}
            >
              <SelectTrigger
                id={selectId}
                size="sm"
                className="h-8 min-w-28 bg-background text-caption"
                aria-label={t("perPageAria")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="end">
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {t("pageSizeOption", { count: size })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {meta.totalPages > 1 && (
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t("pagesGroupAria")}>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="rounded-md"
              disabled={!meta.hasPrev}
              onClick={() => onPageChange(1)}
              aria-label={t("firstPage")}
              title={t("firstPage")}
            >
              <ChevronsLeft className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="rounded-md"
              disabled={!meta.hasPrev}
              onClick={() => onPageChange(meta.page - 1)}
              aria-label={t("prevPage")}
              title={t("prevPage")}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Button>

            {tokens.map((token) =>
              token.type === "ellipsis" ? (
                <span
                  key={token.key}
                  aria-hidden="true"
                  className="inline-flex h-8 min-w-7 items-center justify-center px-1 text-caption text-muted-foreground select-none"
                >
                  &hellip;
                </span>
              ) : (
                <Button
                  key={token.page}
                  type="button"
                  size="sm"
                  variant={token.page === meta.page ? "default" : "ghost"}
                  className="h-8 min-w-8 px-2.5 tabular-nums"
                  onClick={() => onPageChange(token.page)}
                  aria-current={token.page === meta.page ? "page" : undefined}
                  aria-label={t("pageAria", { page: token.page, totalPages: meta.totalPages })}
                >
                  {token.page}
                </Button>
              ),
            )}

            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="rounded-md"
              disabled={!meta.hasNext}
              onClick={() => onPageChange(meta.page + 1)}
              aria-label={t("nextPage")}
              title={t("nextPage")}
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="rounded-md"
              disabled={!meta.hasNext}
              onClick={() => onPageChange(meta.totalPages)}
              aria-label={t("lastPage")}
              title={t("lastPage")}
            >
              <ChevronsRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>
    </nav>
  )
}
