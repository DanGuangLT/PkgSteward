"use client"

import { useId, type ReactNode } from "react"
import { useFormatter, useTranslations } from "next-intl"
import { ChevronDownIcon } from "lucide-react"
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
  onReset(): void
  children?: ReactNode
}

export function ListDiscovery({
  query, onQueryChange, searchLabel, searchPlaceholder, resultLabel, resetLabel, onReset, children,
}: ListDiscoveryProps) {
  const searchId = useId()
  return (
    <div className="min-w-0 space-y-4">
      <div className="min-w-0 space-y-2">
        <Label htmlFor={searchId}>{searchLabel}</Label>
        <Input id={searchId} type="search" value={query} onChange={event => onQueryChange(event.target.value)}
          placeholder={searchPlaceholder} maxLength={512} autoComplete="off" spellCheck={false} />
      </div>
      {children ? <div className="flex min-w-0 flex-wrap items-start gap-3">{children}</div> : null}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <p role="status" aria-live="polite" aria-atomic="true" className="min-w-0 text-body-sm text-muted-foreground [overflow-wrap:anywhere]">
          {resultLabel}
        </p>
        <Button type="button" variant="secondary" onClick={onReset}>{resetLabel}</Button>
      </div>
    </div>
  )
}

export function DiscoveryControls({ query, onQueryChange, count, total, onReset, children }: {
  query: string; onQueryChange(query: string): void; count: number; total: number; onReset(): void; children?: ReactNode
}) {
  const t = useTranslations("listDiscovery")
  const format = useFormatter()
  return <ListDiscovery query={query} onQueryChange={value => onQueryChange(value.slice(0, 512))}
    searchLabel={t("search")} resetLabel={t("reset")} onReset={onReset}
    resultLabel={t("results", { count: format.number(count), total: format.number(total) })}>{children}</ListDiscovery>
}

export function DiscoveryFilter<Value extends string>({ options, ...props }: Omit<ListDiscoveryFilterProps<Value>, "selectedLabel" | "clearLabel">) {
  const t = useTranslations("listDiscovery")
  const format = useFormatter()
  return <ListDiscoveryFilter {...props} options={options.map(option => ({ ...option, label: option.count === undefined ? option.label : `${option.label} (${format.number(option.count)})` }))}
    selectedLabel={props.value.length ? t("selected", { count: format.number(props.value.length) }) : t("all")}
    clearLabel={t("clearGroup")} />
}

export function DiscoverySort<Value extends string>({ value, options, onValueChange }: {
  value: Value; options: readonly ListDiscoveryOption<Value>[]; onValueChange(value: Value): void
}) {
  const t = useTranslations("listDiscovery")
  const id = useId()
  return <div className="min-w-0 space-y-2">
    <Label htmlFor={id}>{t("sort")}</Label>
    <Select value={value} onValueChange={next => { const option = options.find(item => item.value === next); if (option) onValueChange(option.value) }}>
      <SelectTrigger id={id} className="w-full min-w-0"><SelectValue /></SelectTrigger>
      <SelectContent>{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
    </Select>
  </div>
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
        <Button type="button" variant="outline"
          aria-label={`${label}: ${selectedLabel}${selectedNames ? `; ${selectedNames}` : ""}`}
          className="h-auto min-h-11 w-full min-w-0 max-w-full justify-between gap-3 whitespace-normal px-4 py-3 text-left sm:w-auto">
          <span className="min-w-0">
            <span className="block [overflow-wrap:anywhere]">{label}<span className="ml-2 font-normal text-muted-foreground">{selectedLabel}</span></span>
            {selectedNames ? <span className="block truncate text-body-sm font-normal text-muted-foreground" title={selectedNames}>{selectedNames}</span> : null}
          </span>
          <ChevronDownIcon aria-hidden="true" className="shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent aria-label={label}
        className="max-h-[min(20rem,var(--radix-dropdown-menu-content-available-height))] w-72 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {options.map(option => (
          <DropdownMenuCheckboxItem key={option.value} checked={value.includes(option.value)}
            className="min-h-11 whitespace-normal [overflow-wrap:anywhere]"
            onSelect={event => event.preventDefault()}
            onCheckedChange={checked => onValueChange(checked === true
              ? value.includes(option.value) ? [...value] : [...value, option.value]
              : value.filter(item => item !== option.value))}>
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={value.length === 0} onSelect={event => {
          event.preventDefault()
          onValueChange([])
        }}>{clearLabel}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
