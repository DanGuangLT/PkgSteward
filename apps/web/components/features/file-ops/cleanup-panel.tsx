"use client"

import { useRef, useState } from "react"
import { useTranslations } from "next-intl"

import {
  ActiveCriteriaBar,
  CleanupFilters,
  DEFAULT_CLEANUP_FORM,
} from "@/components/features/file-ops/cleanup-filters"
import { CleanupPresetsBar } from "@/components/features/file-ops/cleanup-presets-bar"
import {
  CleanupScanBanner,
  type CleanupScanContext,
} from "@/components/features/file-ops/cleanup-scan-banner"
import { FileOpsJob } from "@/components/features/file-ops/file-ops-job"
import { PreviewReview } from "@/components/features/file-ops/preview-review"
import { useCustomCleanupPresets } from "@/hooks/use-custom-cleanup-presets"
import { useFileOps } from "@/hooks/use-file-ops"
import { useRouteScrollContinuity } from "@/hooks/use-navigation-continuity"
import type { CleanupPreviewInput } from "@/lib/api/types"
import type { CustomCleanupPreset } from "@/lib/file-ops/cleanup-presets"
import { cleanupPreviewInput, type CleanupFilterForm } from "@/lib/file-ops/file-ops-list"
import { cleanupRunDisabledReason } from "@/lib/ui/disabled-reasons"
import { makeViewStateKey } from "@/lib/ui/navigation-targets"

interface SubmittedCriteria {
  form: Required<CleanupFilterForm>
  label: string | null
}

export function CleanupPanel({ scanContext }: { scanContext: CleanupScanContext | null }) {
  const t = useTranslations("fileOps")
  const tDisabled = useTranslations("disabledReasons")
  const controller = useFileOps()
  const { presets: customPresets, savePreset, removePreset } = useCustomCleanupPresets()
  const [form, setForm] = useState<Required<CleanupFilterForm>>(DEFAULT_CLEANUP_FORM)
  const [customizerOpen, setCustomizerOpen] = useState(false)
  const [reviewSetupExpanded, setReviewSetupExpanded] = useState(false)
  const [submittedCriteria, setSubmittedCriteria] = useState<SubmittedCriteria | null>(null)
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null)
  const [selectedCustomPresetId, setSelectedCustomPresetId] = useState<string | null>(null)
  const reviewAction = useRef<HTMLButtonElement>(null)
  const customizerSectionRef = useRef<HTMLDivElement>(null)

  const { state } = controller
  const hasScan = scanContext !== null
  const canConfigure = state.phase === "idle" || state.phase === "starting" || state.phase === "reviewing"
  const isReviewing = state.phase === "reviewing"
  const isCleanupReview = isReviewing && state.preview?.source === "cleanup"
  const busy = state.phase === "starting" || (isReviewing && state.summarizing)
  const editingPreset = editingPresetId
    ? customPresets.find((preset) => preset.id === editingPresetId) ?? null
    : null
  const activeCustomPresetId = editingPresetId ?? selectedCustomPresetId
  const activeBarReasonKey = cleanupRunDisabledReason({ busy, hasScan })
  const activeBarDisabledReason = activeBarReasonKey ? tDisabled(activeBarReasonKey) : null

  useRouteScrollContinuity({ routeKey: makeViewStateKey("cleanup"), ready: true })

  function runWithInput(
    nextForm: Required<CleanupFilterForm>,
    input: CleanupPreviewInput,
    label: string | null,
  ) {
    setSubmittedCriteria({ form: nextForm, label })
    setReviewSetupExpanded(false)
    void controller.startCleanup(input)
  }

  function scrollCustomizerIntoView() {
    window.requestAnimationFrame(() => {
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      customizerSectionRef.current?.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "nearest",
      })
    })
  }

  function handleSelectBuiltinPreset(presetForm: Required<CleanupFilterForm>) {
    setForm(presetForm)
    setEditingPresetId(null)
    setSelectedCustomPresetId(null)
    setCustomizerOpen(false)
  }

  function handleSelectCustomPreset(preset: CustomCleanupPreset) {
    setForm(preset.form)
    setEditingPresetId(null)
    setSelectedCustomPresetId(preset.id)
    setCustomizerOpen(false)
  }

  function handleRunPreset(presetForm: Required<CleanupFilterForm>, label: string, customId?: string) {
    setForm(presetForm)
    setEditingPresetId(null)
    setSelectedCustomPresetId(customId ?? null)
    const input = cleanupPreviewInput(presetForm)
    if (input) runWithInput(presetForm, input, label)
  }

  function handleCustomizePreset(presetForm: Required<CleanupFilterForm>) {
    setForm(presetForm)
    setEditingPresetId(null)
    setSelectedCustomPresetId(null)
    setCustomizerOpen(true)
    if (isReviewing) setReviewSetupExpanded(true)
    scrollCustomizerIntoView()
  }

  function handleEditCustomPreset(preset: CustomCleanupPreset) {
    setForm(preset.form)
    setEditingPresetId(preset.id)
    setSelectedCustomPresetId(preset.id)
    setCustomizerOpen(true)
    if (isReviewing) setReviewSetupExpanded(true)
    scrollCustomizerIntoView()
  }

  function handleDeleteCustomPreset(id: string) {
    if (editingPresetId === id) setEditingPresetId(null)
    if (selectedCustomPresetId === id) setSelectedCustomPresetId(null)
    removePreset(id)
  }

  function handleFormChange(nextForm: Required<CleanupFilterForm>) {
    setForm(nextForm)
    if (editingPresetId === null) setSelectedCustomPresetId(null)
  }

  function handleSavePreset(name: string, updateId?: string) {
    const result = savePreset({ id: updateId, name, form })
    if (result.ok) {
      setEditingPresetId(result.preset.id)
      setSelectedCustomPresetId(result.preset.id)
    }
    return result
  }

  function handleRemeasure() {
    if (!submittedCriteria) {
      setReviewSetupExpanded(true)
      return
    }
    const input = cleanupPreviewInput(submittedCriteria.form)
    if (input) runWithInput(submittedCriteria.form, input, submittedCriteria.label)
    else setReviewSetupExpanded(true)
  }

  function handleStartOver() {
    setSubmittedCriteria(null)
    setReviewSetupExpanded(false)
    controller.reset()
  }

  return (
    <section className="flex min-w-0 flex-col gap-6" aria-label={t("cleanup.title")}>
      <CleanupScanBanner scanContext={scanContext} />

      {isCleanupReview ? (
        <ActiveCriteriaBar
          form={submittedCriteria?.form ?? null}
          activeLabel={submittedCriteria?.label ?? null}
          disabled={busy || !hasScan}
          disabledReason={activeBarDisabledReason}
          expanded={reviewSetupExpanded}
          onToggleExpand={() => setReviewSetupExpanded((open) => !open)}
          onRemeasure={submittedCriteria ? handleRemeasure : undefined}
        />
      ) : null}

      {canConfigure && (!isReviewing || reviewSetupExpanded) ? (
        <div className="flex min-w-0 flex-col gap-5">
          <CleanupPresetsBar
            currentForm={form}
            customPresets={customPresets}
            activeCustomPresetId={activeCustomPresetId}
            disabled={busy}
            hasScan={hasScan}
            allowPrimaryCta={!customizerOpen && hasScan}
            onSelectBuiltinPreset={handleSelectBuiltinPreset}
            onSelectCustomPreset={handleSelectCustomPreset}
            onRunPreset={handleRunPreset}
            onCustomizePreset={handleCustomizePreset}
            onEditCustomPreset={handleEditCustomPreset}
            onDeleteCustomPreset={handleDeleteCustomPreset}
          />
          <div ref={customizerSectionRef} className="min-w-0">
            <CleanupFilters
              form={form}
              open={customizerOpen}
              onOpenChange={setCustomizerOpen}
              disabled={busy}
              hasScan={hasScan}
              projects={scanContext?.projects ?? []}
              editingPreset={editingPreset}
              onChange={handleFormChange}
              onSubmit={(input) => runWithInput(form, input, editingPreset?.name ?? null)}
              onSavePreset={handleSavePreset}
              onStopEditingPreset={() => setEditingPresetId(null)}
            />
          </div>
        </div>
      ) : null}

      <FileOpsJob controller={controller} returnFocusRef={reviewAction} onStartOver={handleStartOver} />
      <PreviewReview controller={controller} actionRef={reviewAction} />
    </section>
  )
}
