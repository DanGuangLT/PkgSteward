"use client"

import { CopyIcon, RefreshCwIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { validateServerDraft } from "@/lib/settings/settings-validation"
import type { PrivilegedSettingsPatch, SettingsSnapshot } from "@/lib/settings/types"

export function ServerTab({
  snapshot,
  busy,
  onPreviewUpdate,
}: {
  snapshot: SettingsSnapshot
  busy: boolean
  onPreviewUpdate: (patch: PrivilegedSettingsPatch) => Promise<void>
}) {
  const t = useTranslations("settings.server")
  const tSrc = useTranslations("settings.sources")
  const tVal = useTranslations("settings.validation")
  const srv = snapshot.document.server
  const paths = snapshot.systemPaths

  const [mode, setMode] = useState<"development" | "production">(srv.mode)
  const [host, setHost] = useState<"127.0.0.1" | "localhost" | "::1">(srv.host)
  const [port, setPort] = useState(String(srv.port))
  const [globalPrefix, setGlobalPrefix] = useState(srv.globalPrefix)
  const [version, setVersion] = useState(srv.version)
  const [listOriginCors, setListOriginCors] = useState(srv.listOriginCors)
  const [exportSwaggerApiJson, setExportSwaggerApiJson] = useState(srv.exportSwaggerApiJson)
  const [formError, setFormError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    const err = validateServerDraft({
      host,
      port,
      globalPrefix,
      version,
      listOriginCors,
    })
    if (err) {
      setFormError(tVal(err))
      return
    }
    await onPreviewUpdate({
      server: {
        mode,
        host,
        port: Number(port.trim()),
        globalPrefix: globalPrefix.trim(),
        version: version.trim(),
        listOriginCors: listOriginCors.trim(),
        exportSwaggerApiJson,
      },
    })
  }

  const copyPath = async (val: string) => {
    try {
      await navigator.clipboard.writeText(val)
      toast.success(t("copied"))
    } catch {
      toast.error(t("copyFailed"))
    }
  }

  const pathRows: [string, string][] = [
    [t("paths.settingsFilePath"), paths.settingsFilePath],
    [t("paths.dataDir"), paths.dataDir],
    [t("paths.pluginsDir"), paths.pluginsDir],
    [t("paths.auditLogFilePath"), paths.auditLogFilePath],
    [t("paths.cacheDir"), paths.cacheDir],
    [t("paths.appInstallDir"), paths.appInstallDir],
    ...(paths.sourceCheckoutDir ? [[t("paths.sourceCheckoutDir"), paths.sourceCheckoutDir] as [string, string]] : []),
    [t("paths.runtimeEnv"), `${paths.platform} · Node ${paths.nodeVersion}`],
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-2.5 rounded-md border border-warning/40 bg-warning-soft p-3.5 text-body-sm text-warning">
        <RefreshCwIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          {snapshot.restartRequiredFields.length > 0
            ? t("restartPendingBanner", {
                fields: snapshot.restartRequiredFields.join(", "),
              })
            : t("restartInfoBanner")}
        </span>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>{t("configTitle")}</CardTitle>
            <CardDescription>{t("configDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label>{t("modeLabel")}</Label>
                  <Badge variant={snapshot.sources.server.mode === "settings" ? "default" : "secondary"}>
                    {tSrc(snapshot.sources.server.mode)}
                  </Badge>
                </div>
                <ToggleGroup
                  type="single"
                  value={mode}
                  onValueChange={(val) => {
                    if (val === "development" || val === "production") setMode(val)
                  }}
                >
                  <ToggleGroupItem value="development">development</ToggleGroupItem>
                  <ToggleGroupItem value="production">production</ToggleGroupItem>
                </ToggleGroup>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label>{t("hostLabel")}</Label>
                  <Badge variant={snapshot.sources.server.host === "settings" ? "default" : "secondary"}>
                    {tSrc(snapshot.sources.server.host)}
                  </Badge>
                </div>
                <ToggleGroup
                  type="single"
                  value={host}
                  onValueChange={(val) => {
                    if (val === "127.0.0.1" || val === "localhost" || val === "::1") setHost(val)
                  }}
                >
                  <ToggleGroupItem value="127.0.0.1" className="font-mono">127.0.0.1</ToggleGroupItem>
                  <ToggleGroupItem value="localhost" className="font-mono">localhost</ToggleGroupItem>
                  <ToggleGroupItem value="::1" className="font-mono">::1</ToggleGroupItem>
                </ToggleGroup>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="srv-port">{t("portLabel")}</Label>
                  <Badge variant={snapshot.sources.server.port === "settings" ? "default" : "secondary"}>
                    {tSrc(snapshot.sources.server.port)}
                  </Badge>
                </div>
                <Input
                  id="srv-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  className="font-mono"
                />
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="srv-prefix">{t("prefixLabel")}</Label>
                  <Badge variant={snapshot.sources.server.globalPrefix === "settings" ? "default" : "secondary"}>
                    {tSrc(snapshot.sources.server.globalPrefix)}
                  </Badge>
                </div>
                <Input
                  id="srv-prefix"
                  value={globalPrefix}
                  onChange={(e) => setGlobalPrefix(e.target.value)}
                  className="font-mono"
                />
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="srv-version">{t("versionLabel")}</Label>
                  <Badge variant={snapshot.sources.server.version === "settings" ? "default" : "secondary"}>
                    {tSrc(snapshot.sources.server.version)}
                  </Badge>
                </div>
                <Input
                  id="srv-version"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  className="font-mono"
                />
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="srv-cors">{t("corsLabel")}</Label>
                  <Badge variant={snapshot.sources.server.listOriginCors === "settings" ? "default" : "secondary"}>
                    {tSrc(snapshot.sources.server.listOriginCors)}
                  </Badge>
                </div>
                <Input
                  id="srv-cors"
                  value={listOriginCors}
                  onChange={(e) => setListOriginCors(e.target.value)}
                  className="font-mono"
                />
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-background p-3 select-none">
              <Checkbox
                checked={exportSwaggerApiJson}
                onCheckedChange={(val) => setExportSwaggerApiJson(val === true)}
              />
              <span className="text-body-sm font-medium text-foreground">{t("swaggerLabel")}</span>
            </label>

            {formError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-body-sm text-destructive">
                {formError}
              </div>
            )}

            <div className="flex justify-end">
              <Button type="submit" disabled={busy}>
                {t("previewSaveCta")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>{t("systemPathsTitle")}</CardTitle>
          <CardDescription>{t("systemPathsDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border rounded-md border border-border bg-background">
            {pathRows.map(([label, val]) => (
              <div key={label} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <dt className="text-body-sm font-medium text-muted-foreground">{label}</dt>
                <dd className="flex items-center gap-2">
                  <code className="max-w-md truncate font-mono text-caption text-foreground">{val}</code>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t("copyValue", { label })}
                    onClick={() => void copyPath(val)}
                  >
                    <CopyIcon className="size-3.5" aria-hidden />
                  </Button>
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  )
}
