"use client"

import { useId, type FormEvent } from "react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { CleanupKind } from "@/lib/api/types"
import type { CleanupFilterForm } from "@/lib/file-ops/file-ops-list"

export const CLEANUP_KINDS: readonly CleanupKind[] = ["node_modules", "orphan_node_modules", "build_cache"]

interface CleanupFiltersProps {
  form: CleanupFilterForm
  disabled: boolean
  invalid: boolean
  onChange(form: CleanupFilterForm): void
  onSubmit(): void
}

export function CleanupFilters({ form, disabled, invalid, onChange, onSubmit }: CleanupFiltersProps) {
  const t = useTranslations("fileOps")
  const ageId = useId()
  const sizeId = useId()
  const hintId = useId()

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!disabled && !invalid) onSubmit()
  }

  return (
    <form onSubmit={submit} className="min-w-0 space-y-4" aria-describedby={hintId}>
      <div className="flex min-w-0 flex-wrap items-end gap-4">
        <div className="min-w-0 space-y-2">
          <p className="text-body-md font-semibold">{t("filters.kinds")}</p>
          <ToggleGroup type="multiple" variant="outline" disabled={disabled} value={form.kinds} className="w-full flex-wrap"
            aria-label={t("filters.kinds")} onValueChange={(kinds) => onChange({ ...form, kinds: kinds as CleanupKind[] })}>
            {CLEANUP_KINDS.map((kind) => <ToggleGroupItem key={kind} value={kind}>{t(`kinds.${kind}`)}</ToggleGroupItem>)}
          </ToggleGroup>
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor={ageId}>{t("filters.olderThanDays")}</Label>
          <Input id={ageId} inputMode="numeric" autoComplete="off" disabled={disabled} value={form.olderThanDays}
            className="w-40 max-w-full" onChange={(event) => onChange({ ...form, olderThanDays: event.target.value })} />
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor={sizeId}>{t("filters.minSizeMib")}</Label>
          <Input id={sizeId} inputMode="numeric" autoComplete="off" disabled={disabled} value={form.minSizeMib}
            className="w-40 max-w-full" onChange={(event) => onChange({ ...form, minSizeMib: event.target.value })} />
        </div>
      </div>
      <p id={hintId} role={invalid ? "alert" : undefined} className="text-body-sm text-muted-foreground">
        {t(invalid ? "filters.invalid" : "filters.hint")}
      </p>
      <Button type="submit" disabled={disabled || invalid}>{t("actions.findAndMeasure")}</Button>
    </form>
  )
}
