import { PackageSearchIcon } from "lucide-react"
import { getFormatter, getTranslations } from "next-intl/server"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { ShowcaseItem, ShowcaseRow, ShowcaseSection } from "./showcase"

type BadgeVariant = NonNullable<React.ComponentProps<typeof Badge>["variant"]>

// Dữ liệu mẫu — màn hình thật lấy từ API của ProjectsModule.
const DEPENDENCIES = [
  { name: "react", current: "19.2.8", latest: "19.2.8", status: "latest" },
  { name: "lodash", current: "4.17.20", latest: "4.17.21", status: "outdated" },
  { name: "minimist", current: "1.2.5", latest: "1.2.8", status: "vulnerable" },
] as const

const STATUS_BADGE = {
  latest: "success",
  outdated: "secondary",
  vulnerable: "destructive",
} as const satisfies Record<(typeof DEPENDENCIES)[number]["status"], BadgeVariant>

const MANAGERS = ["npm", "pnpm", "yarn"] as const
const TAB_VARIANTS = ["line", "default"] as const

const PROGRESS_DEMOS = [
  { id: "queued", value: 0 },
  { id: "scanning", value: 40 },
  { id: "done", value: 100 },
] as const

export async function DataSection() {
  const [t, tCommon, format] = await Promise.all([
    getTranslations("designSystem.data"),
    getTranslations("common"),
    getFormatter(),
  ])

  return (
    <ShowcaseSection id="data" title={t("title")} description={t("description")}>
      <div className="grid gap-8 lg:grid-cols-2">
        <ShowcaseItem
          title={t("card.title")}
          description={t("card.description")}
          className="flex-col items-stretch gap-6"
        >
          <ShowcaseRow label='size="default"'>
            <Card className="w-full">
              <CardHeader>
                <CardTitle>demo-app</CardTitle>
                <CardDescription className="font-mono">~/projects/demo-app</CardDescription>
                <CardAction>
                  <Badge variant="secondary">{t("card.outdated", { count: 3 })}</Badge>
                </CardAction>
              </CardHeader>
              <CardContent>
                <p className="text-body">{t("card.summary", { count: 12 })}</p>
              </CardContent>
              <CardFooter className="gap-2">
                <Button variant="secondary" size="sm">
                  {t("card.details")}
                </Button>
                <Button variant="ghost" size="sm">
                  {t("card.openFolder")}
                </Button>
              </CardFooter>
            </Card>
          </ShowcaseRow>
          <ShowcaseRow label='size="sm"'>
            <Card size="sm" className="w-full">
              <CardHeader>
                <CardTitle>Node.js</CardTitle>
                <CardDescription className="font-mono">v24.11.0</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-body">{t("card.activeVersion")}</p>
              </CardContent>
            </Card>
          </ShowcaseRow>
        </ShowcaseItem>

        <ShowcaseItem
          title={t("tabs.title")}
          description={t("tabs.description")}
          className="flex-col items-stretch gap-6"
        >
          {TAB_VARIANTS.map((variant) => (
            <ShowcaseRow key={variant} label={`variant="${variant}"`}>
              <Tabs defaultValue="pnpm" className="w-full">
                <TabsList variant={variant} aria-label={t("tabs.label")}>
                  {MANAGERS.map((manager) => (
                    <TabsTrigger key={manager} value={manager}>
                      {manager}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {MANAGERS.map((manager) => (
                  <TabsContent key={manager} value={manager} className="pt-2 text-body">
                    {t("tabs.content", { manager })}
                  </TabsContent>
                ))}
              </Tabs>
            </ShowcaseRow>
          ))}
        </ShowcaseItem>

        <div className="min-w-0 lg:col-span-2">
          <ShowcaseItem title={t("table.title")} description={t("table.description")} className="block">
            <Table>
              <TableCaption>{t("table.caption")}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("table.package")}</TableHead>
                  <TableHead>{t("table.current")}</TableHead>
                  <TableHead>{t("table.latest")}</TableHead>
                  <TableHead>{t("table.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {DEPENDENCIES.map((dependency) => (
                  <TableRow key={dependency.name}>
                    <TableCell className="font-mono text-foreground">{dependency.name}</TableCell>
                    <TableCell className="font-mono">{dependency.current}</TableCell>
                    <TableCell className="font-mono">{dependency.latest}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[dependency.status]}>
                        {t(`table.statuses.${dependency.status}`)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ShowcaseItem>
        </div>

        <ShowcaseItem
          title={t("progress.title")}
          description={t("progress.description")}
          className="flex-col items-stretch gap-6"
        >
          {PROGRESS_DEMOS.map((demo) => {
            const labelId = `ds-progress-${demo.id}`
            return (
              <div key={demo.id} className="flex flex-col gap-2">
                <div className="flex justify-between gap-4 text-body-sm">
                  <span id={labelId} className="text-foreground">
                    {t(`progress.${demo.id}`)}
                  </span>
                  <span className="text-muted-foreground">
                    {format.number(demo.value / 100, { style: "percent" })}
                  </span>
                </div>
                <Progress value={demo.value} aria-labelledby={labelId} />
              </div>
            )
          })}
        </ShowcaseItem>

        <ShowcaseItem
          title={t("skeleton.title")}
          description={t("skeleton.description")}
          className="flex-col items-stretch"
        >
          <div role="status" className="flex items-center gap-4">
            <Skeleton className="size-12 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
            <span className="sr-only">{tCommon("loading")}</span>
          </div>
        </ShowcaseItem>

        <div className="min-w-0 lg:col-span-2">
          <ShowcaseItem title={t("empty.title")} description={t("empty.description")} className="block">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <PackageSearchIcon />
                </EmptyMedia>
                <EmptyTitle>{t("empty.emptyTitle")}</EmptyTitle>
                <EmptyDescription>{t("empty.emptyDescription")}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="secondary">{t("empty.action")}</Button>
              </EmptyContent>
            </Empty>
          </ShowcaseItem>
        </div>
      </div>
    </ShowcaseSection>
  )
}
