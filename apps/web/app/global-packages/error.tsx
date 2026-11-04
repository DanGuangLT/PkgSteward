"use client"

import { useTranslations } from "next-intl"
import { Container } from "@/components/layout/container"
import { Button } from "@/components/ui/button"

export default function GlobalPackagesError({ retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations("globalPackages")
  return <Container className="min-w-0 space-y-4 py-8 md:py-12 lg:py-16">
    <h1 className="text-heading-xl">{t("title")}</h1>
    <p role="alert" className="text-body-sm">{t("pageError")}</p>
    <Button type="button" variant="secondary" onClick={retry}>{t("retry")}</Button>
  </Container>
}
