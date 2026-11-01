"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { DeleteConfirmDialog } from "@/components/features/file-ops/delete-confirm-dialog"
import { RiskBadge } from "@/components/features/file-ops/risk-badge"
import { Button } from "@/components/ui/button"
import type { FileOpsSummary, FileOpsTarget, Risk, RiskLevel } from "@/lib/api/types"

const LEVELS = ["low", "medium", "high"] as const
const SIZE = { status: "done", apparentBytes: 432_013_312, sizeBytes: 432_013_312, reclaimableBytes: 2_097_152, sharedBytes: 429_916_160, fileCount: 18_204 } as const

// Dữ liệu mẫu cho style guide: không gọi API, không có đường dẫn thật.
const SAMPLES: Record<RiskLevel, { path: string; risk: Risk; confirmText: string | null; target: Partial<FileOpsTarget> }> = {
  low: {
    path: "~/projects/old-demo/node_modules",
    risk: { level: "low", reasons: [{ code: "ORPHAN_NODE_MODULES", level: "low", message: "" }] },
    confirmText: null,
    target: { kind: "orphan_node_modules", method: "permanent" },
  },
  medium: {
    path: "~/projects/demo-app/node_modules",
    risk: {
      level: "medium",
      reasons: [
        { code: "NO_LOCKFILE", level: "medium", message: "" },
        { code: "RECENTLY_ACTIVE", level: "medium", message: "" },
      ],
    },
    confirmText: null,
    target: { kind: "node_modules", method: "permanent" },
  },
  high: {
    path: "~/projects/demo-app",
    risk: {
      level: "high",
      reasons: [
        { code: "DELETE_WHOLE_PROJECT", level: "high", message: "" },
        { code: "UNCOMMITTED_GIT_CHANGES", level: "medium", message: "" },
      ],
    },
    confirmText: "demo-app",
    target: { kind: "project", method: "recycle" },
  },
}

function sampleSummary(level: RiskLevel): FileOpsSummary {
  const { path, risk, confirmText, target } = SAMPLES[level]
  return {
    paths: [path],
    risk,
    confirmText,
    totals: {
      targetCount: 1,
      reclaimableBytes: target.method === "permanent" ? SIZE.reclaimableBytes : 0,
      recycleBytes: target.method === "recycle" ? SIZE.reclaimableBytes : 0,
    },
  }
}

function sampleTarget(level: RiskLevel): FileOpsTarget {
  const { path, risk, target } = SAMPLES[level]
  return {
    path, kind: null, method: null, valid: true, failureCode: null, owner: null, nestedProjects: [], hasLockfile: null,
    lastActivityAt: null, size: SIZE, risk, defaultSelected: false, ...target,
  }
}

/** Demo xác nhận theo từng mức rủi ro: dùng đúng dialog thật, bản demo chỉ hiện toast. */
export function RiskConfirmDemo() {
  const t = useTranslations("designSystem.dangerous.riskDemo")
  const [level, setLevel] = useState<RiskLevel | null>(null)

  return (
    <div className="flex flex-wrap items-center gap-4">
      {LEVELS.map((sample) => (
        <div key={sample} className="flex flex-col items-start gap-2">
          <RiskBadge level={sample} />
          <Button type="button" variant="secondary" onClick={() => setLevel(sample)}>{t(`triggers.${sample}`)}</Button>
        </div>
      ))}
      {level ? (
        <DeleteConfirmDialog previewId={`demo-${level}`} summary={sampleSummary(level)} targets={[sampleTarget(level)]}
          pending={false} errorMessage={null} onCancel={() => setLevel(null)}
          onConfirm={() => {
            toast.success(t("toast"))
            setLevel(null)
          }} />
      ) : null}
    </div>
  )
}
