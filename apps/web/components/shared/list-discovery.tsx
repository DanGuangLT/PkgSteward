"use client"

import { useId, type ReactNode } from "react"
import { useFormatter, useTranslations } from "next-intl"
import { ChevronDownIcon, RotateCcwIcon, SearchIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export interface ListDiscoveryProps {
  query: string
  onQueryChange(query: string): void
  searchLabel: string
  searchPlaceholder?: string
  resultLabel: string
  resetLabel: string
  hint?: ReactNode
  onReset(): void
  children?: ReactNode
}

export function ListDiscovery({
  query, onQueryChange, searchLabel, searchPlaceholder, resultLabel, resetLabel, hint, onReset, children,
}: ListDiscoveryProps) {
  const searchId = useId()
  return (
    <div className="min-w-0 space-y-3">
      <div className="relative min-w-0">
        <Label htmlFor={searchId} className="sr-only">{searchLabel}</Label>
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id={searchId}
          type="search"
          value={query}
          onChange={event => onQueryChange(event.target.value)}
          placeholder={searchPlaceholder ?? searchLabel}
          maxLength={512}
          autoComplete="off"
          spellCheck={false}
          className={
            query
              ? "pr-10 pl-10 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-cancel-button]:hidden"
              : "pl-10 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-cancel-button]:hidden"
          }
        />
        {query ? (
          <button
            type="button"
            aria-label={`${resetLabel}: ${searchLabel}`}
            onClick={() => onQueryChange("")}
            className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors focus-ring hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {children ? <div className="flex min-w-0 flex-wrap items-center gap-2.5">{children}</div> : null}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border/60 pt-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <p role="status" aria-live="polite" aria-atomic="true" className="min-w-0 text-caption font-medium text-muted-foreground [overflow-wrap:anywhere]">
            {resultLabel}
          </p>
          {hint ? <div className="text-caption text-muted-foreground">{hint}</div> : null}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onReset}>
          <RotateCcwIcon aria-hidden="true" />
          {resetLabel}
        </Button>
      </div>
    </div>
  )
}

export function DiscoveryControls({ query, onQueryChange, count, total, hint, onReset, children }: {
  query: string; onQueryChange(query: string): void; count: number; total: number; hint?: ReactNode; onReset(): void; children?: ReactNode
}) {
  const t = useTranslations("listDiscovery")
  const format = useFormatter()
  return (
    <ListDiscovery
      query={query}
      onQueryChange={value => onQueryChange(value.slice(0, 512))}
      searchLabel={t("search")}
      searchPlaceholder={t("search")}
      resetLabel={t("reset")}
      hint={hint}
      onReset={onReset}
      resultLabel={t("results", { count: format.number(count), total: format.number(total) })}
    >
      {children}
    </ListDiscovery>
  )
}

export function DiscoveryFilter<Value extends string>({ options, ...props }: Omit<ListDiscoveryFilterProps<Value>, "selectedLabel" | "clearLabel">) {
  const t = useTranslations("listDiscovery")
  const format = useFormatter()
  return (
    <ListDiscoveryFilter
      {...props}
      options={options.map(option => ({ ...option, label: option.count === undefined ? option.label : `${option.label} (${format.number(option.count)})` }))}
      selectedLabel={props.value.length ? t("selected", { count: format.number(props.value.length) }) : t("all")}
      clearLabel={t("clearGroup")}
    />
  )
}

export function DiscoverySort<Value extends string>({ value, options, onValueChange }: {
  value: Value; options: readonly ListDiscoveryOption<Value>[]; onValueChange(value: Value): void
}) {
  const t = useTranslations("listDiscovery")
  const id = useId()
  const activeOption = options.find(item => item.value === value)
  return (
    <div className="min-w-0 max-w-full sm:w-auto">
      <Select value={value} onValueChange={next => { const option = options.find(item => item.value === next); if (option) onValueChange(option.value) }}>
        <SelectTrigger
          id={id}
          aria-label={`${t("sort")}: ${activeOption?.label ?? value}`}
          className="h-auto min-h-10 w-full min-w-0 max-w-full gap-2.5 border-border bg-background px-3.5 py-2 text-body-sm hover:bg-muted data-[size=default]:h-auto sm:w-auto"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 font-semibold text-foreground">{t("sort")}</span>
            <span className="truncate font-normal text-muted-foreground">
              <SelectValue />
            </span>
          </span>
        </SelectTrigger>
        <SelectContent>
          {options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

export function DiscoveryEmpty({ total }: { total: number }) {
  const t = useTranslations("listDiscovery")
  return <p className="text-body-sm text-muted-foreground">{t(total === 0 ? "empty" : "noMatches")}</p>
}

export interface ListDiscoveryOption<Value extends string> {
  value: Value
  label: string
  count?: number
}

export interface ListDiscoveryFilterProps<Value extends string> {
  label: string
  selectedLabel: string
  clearLabel: string
  value: readonly Value[]
  options: readonly ListDiscoveryOption<Value>[]
  onValueChange(value: Value[]): void
}

export function ListDiscoveryFilter<Value extends string>({
  label, selectedLabel, clearLabel, value, options, onValueChange,
}: ListDiscoveryFilterProps<Value>) {
  const selectedNames = options.filter(option => value.includes(option.value)).map(option => option.label).join(", ")
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label={`${label}: ${selectedLabel}${selectedNames ? `; ${selectedNames}` : ""}`}
          className="h-auto min-h-10 w-full min-w-0 max-w-full justify-between gap-2.5 whitespace-normal px-3.5 py-2 text-left text-body-sm sm:w-auto"
        >
          <span className="min-w-0">
            <span className="flex flex-wrap items-baseline gap-x-2 [overflow-wrap:anywhere]">
              <span className="font-semibold text-foreground">{label}</span>
              <span className="font-normal text-muted-foreground">{selectedLabel}</span>
            </span>
            {selectedNames ? <span className="block truncate text-caption font-normal text-muted-foreground" title={selectedNames}>{selectedNames}</span> : null}
          </span>
          <ChevronDownIcon aria-hidden="true" className="shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        aria-label={label}
        className="max-h-[min(20rem,var(--radix-dropdown-menu-content-available-height))] w-72 max-w-[calc(100vw-2rem)]"
      >
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {options.map(option => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={value.includes(option.value)}
            className="min-h-10 whitespace-normal [overflow-wrap:anywhere]"
            onSelect={event => event.preventDefault()}
            onCheckedChange={checked => onValueChange(checked === true
              ? value.includes(option.value) ? [...value] : [...value, option.value]
              : value.filter(item => item !== option.value))}
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={value.length === 0}
          onSelect={event => {
            event.preventDefault()
            onValueChange([])
          }}
        >
          {clearLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
