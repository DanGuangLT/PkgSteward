"use client"

import { useId, type ReactNode } from "react"
import { useFormatter, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
  const id = useId()
  return (
    <details className="min-w-0 max-w-full rounded-md border border-input bg-background text-foreground">
      <summary className="min-h-11 cursor-pointer rounded-md px-4 py-3 text-body-sm font-semibold focus-ring [overflow-wrap:anywhere]">
        {label}<span className="ml-2 font-normal">{selectedLabel}</span>
      </summary>
      <fieldset className="min-w-0 space-y-1 border-t border-border p-3">
        <legend className="sr-only">{label}</legend>
        {options.map((option, index) => (
          <div key={option.value} className="flex min-h-11 min-w-0 items-center gap-3 px-2">
            <Checkbox id={`${id}-${index}`} checked={value.includes(option.value)}
              onCheckedChange={checked => onValueChange(checked === true
                ? value.includes(option.value) ? [...value] : [...value, option.value]
                : value.filter(item => item !== option.value))} />
            <Label htmlFor={`${id}-${index}`} className="min-w-0 flex-1 py-3 text-body-sm font-normal leading-normal [overflow-wrap:anywhere]">
              {option.label}
            </Label>
          </div>
        ))}
        <Button type="button" variant="secondary" onClick={() => onValueChange([])}>{clearLabel}</Button>
      </fieldset>
    </details>
  )
}
