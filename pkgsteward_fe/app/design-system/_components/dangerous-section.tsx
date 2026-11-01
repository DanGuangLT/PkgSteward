import { getTranslations } from "next-intl/server"

import { ConfirmDeleteDemo } from "./confirm-delete-demo"
import { RiskConfirmDemo } from "./risk-confirm-demo"
import { ShowcaseItem, ShowcaseSection } from "./showcase"

const STEPS = ["preview", "dialog", "execute"] as const

export async function DangerousSection() {
  const t = await getTranslations("designSystem.dangerous")

  return (
    <ShowcaseSection id="dangerous" title={t("title")} description={t("description")}>
      <ol className="flex max-w-prose list-decimal flex-col gap-2 pl-6 text-body-md">
        {STEPS.map((step) => (
          <li key={step}>
            {t.rich(`steps.${step}`, {
              code: (chunks) => (
                <code className="font-mono text-body-sm text-foreground">{chunks}</code>
              ),
            })}
          </li>
        ))}
      </ol>
      <ShowcaseItem title={t("alertDialog.title")} description={t("alertDialog.description")}>
        <ConfirmDeleteDemo />
      </ShowcaseItem>
      <ShowcaseItem title={t("riskDemo.title")} description={t("riskDemo.description")}>
        <RiskConfirmDemo />
      </ShowcaseItem>
    </ShowcaseSection>
  )
}
