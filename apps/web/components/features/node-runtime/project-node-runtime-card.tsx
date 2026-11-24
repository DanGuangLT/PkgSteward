"use client"

import { useEffect, useId, useState } from "react"
import Link from "next/link"
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CpuIcon,
  RefreshCwIcon,
} from "lucide-react"
import { useTranslations } from "next-intl"

import {
  ManagerCommandsList,
  NodeRuntimeStatusBadge,
} from "@/components/features/node-runtime/command-copy-list"
import { DisabledTooltip } from "@/components/shared/disabled-tooltip"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useNavigationContinuity } from "@/hooks/use-navigation-continuity"
import { getBrowserProjectNodeRuntime } from "@/lib/api/node-runtime/node-runtime-browser"
import { ApiError } from "@/lib/api/response"
import type { ProjectNodeRuntimeDetail } from "@/lib/node-runtime/node-runtime-types"
import { appendReturnContext } from "@/lib/ui/navigation-targets"

export function ProjectNodeRuntimeCard({ path }: { path: string }) {
  const t = useTranslations("nodeRuntime")
  const tDisabled = useTranslations("disabledReasons")
  const titleId = useId()
  const { hydrated, currentUrl, entryId } = useNavigationContinuity()
  const returnContext = {
    returnTo: hydrated ? currentUrl : undefined,
    originId: hydrated ? entryId : null,
  }

  const [detail, setDetail] = useState<ProjectNodeRuntimeDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    async function load() {
      setLoading(true)
      setErrorCode(null)
      try {
        const result = await getBrowserProjectNodeRuntime(
          path,
          controller.signal,
        )
        if (!active) return
        setDetail(result)
      } catch (error) {
        if (!active || controller.signal.aborted) return
        setErrorCode(
          error instanceof ApiError
            ? error.code ?? "INTERNAL_SERVER_ERROR"
            : "INTERNAL_SERVER_ERROR",
        )
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()
    return () => {
      active = false
      controller.abort()
    }
  }, [path, reloadToken])

  const project = detail?.project ?? null

  return (
    <section
      aria-labelledby={titleId}
      className="min-w-0 space-y-4 rounded-md border border-border bg-card p-4 text-card-foreground md:p-6"
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h2 id={titleId} className="text-heading-md [overflow-wrap:anywhere]">
            {t("projectCard.title")}
          </h2>
          <p className="text-caption text-muted-foreground">
            {t("projectCard.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DisabledTooltip reason={loading ? tDisabled("refreshing") : null}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading}
              aria-busy={loading}
              onClick={() => setReloadToken((n) => n + 1)}
            >
              <RefreshCwIcon
                data-icon="inline-start"
                aria-hidden="true"
                className={loading ? "animate-spin" : undefined}
              />
              {t(loading ? "refreshing" : "refresh")}
            </Button>
          </DisabledTooltip>
          <Button asChild variant="secondary" size="sm">
            <Link
              href={appendReturnContext("/node-runtime", returnContext)}
              prefetch={false}
            >
              {t("projectCard.openOverview")}
              <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>

      {errorCode ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-card px-3.5 py-2.5 text-body-sm font-medium text-destructive"
        >
          <AlertTriangleIcon
            aria-hidden="true"
            className="mr-1.5 inline size-4"
          />
          {t(
            errorCode === "BACKEND_UNAVAILABLE"
              ? "errors.backendUnavailable"
              : errorCode === "RATE_LIMITED"
                ? "errors.rateLimited"
                : "errors.generic",
          )}
        </p>
      ) : null}

      {!detail && loading ? (
        <p className="text-body-sm text-muted-foreground">
          {t("projectCard.loading")}
        </p>
      ) : null}

      {project && detail ? (
        <div className="space-y-4">
          <dl className="grid min-w-0 gap-3 rounded-md border border-border bg-background p-4 text-body-sm sm:grid-cols-2 [overflow-wrap:anywhere]">
            <div className="min-w-0 space-y-1.5">
              <dt className="text-caption text-muted-foreground">
                {t("projectCard.activeNode")}
              </dt>
              <dd className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono">
                  <CpuIcon aria-hidden="true" />v{detail.activeNodeVersion}
                </Badge>
                <NodeRuntimeStatusBadge status={project.status} />
              </dd>
            </div>

            <div className="min-w-0 space-y-1.5">
              <dt className="text-caption text-muted-foreground">
                {t("project.declaredLabel")}
              </dt>
              <dd className="flex flex-wrap gap-1.5">
                {project.requirements.length > 0 ? (
                  project.requirements.map((req) => (
                    <Badge
                      key={req.source}
                      variant={
                        project.effectiveRequirement?.source === req.source
                          ? "secondary"
                          : "outline"
                      }
                      className="font-mono"
                    >
                      {req.source}: {req.raw}
                    </Badge>
                  ))
                ) : (
                  <span className="text-body-sm text-muted-foreground">
                    {t("project.noDeclaration")}
                  </span>
                )}
              </dd>
            </div>
          </dl>

          {project.status === "mismatch" ? (
            <div className="space-y-3 rounded-md border border-warning/40 bg-warning-soft p-4">
              <p className="text-body-sm font-medium text-warning">
                <AlertTriangleIcon
                  aria-hidden="true"
                  className="mr-1.5 inline size-4"
                />
                {project.matchedInstalledVersion
                  ? t("project.mismatchInstalled", {
                      active: `v${project.activeNodeVersion}`,
                      target: `v${project.matchedInstalledVersion}`,
                    })
                  : project.suggestedVersion
                    ? t("project.mismatchMissing", {
                        active: `v${project.activeNodeVersion}`,
                        target: `v${project.suggestedVersion}`,
                      })
                    : t("project.mismatchGeneric", {
                        active: `v${project.activeNodeVersion}`,
                      })}
              </p>
              {project.commands.length > 0 ? (
                <ManagerCommandsList commands={project.commands} />
              ) : (
                <p className="text-caption text-muted-foreground">
                  {t(
                    detail.managers.some((m) => m.detected)
                      ? "commands.noCommandAvailable"
                      : "commands.noManagerDetected",
                  )}
                </p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
