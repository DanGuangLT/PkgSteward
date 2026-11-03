import { getTranslations } from "next-intl/server"

import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

import { ShowcaseItem, ShowcaseRow, ShowcaseSection } from "@/app/design-system/_components/showcase"

// Mục mẫu của cây chọn file (FileOps). Tên file là dữ liệu, không dịch.
const CHECKBOX_DEMOS = [
  { id: "ds-check-node-modules", name: "node_modules", checked: true, disabled: false },
  { id: "ds-check-dist", name: "dist", checked: false, disabled: false },
  { id: "ds-check-package-json", name: "package.json", checked: false, disabled: true },
  { id: "ds-check-lockfile", name: "pnpm-lock.yaml", checked: true, disabled: true },
] as const

const MANAGERS = ["npm", "pnpm", "yarn"] as const
const NODE_VERSIONS = ["v24", "v22", "v20"] as const
const FILTERS = ["all", "outdated", "vulnerable"] as const
const DEPENDENCY_TYPES = ["dependencies", "devDependencies", "peerDependencies"] as const

const TOGGLE_DEMOS = [
  { label: 'variant="default"', variant: "default", size: "default" },
  { label: 'variant="outline"', variant: "outline", size: "default" },
  { label: 'size="sm"', variant: "default", size: "sm" },
  { label: 'size="lg"', variant: "default", size: "lg" },
] as const

export async function FormsSection() {
  const t = await getTranslations("designSystem.forms")

  return (
    <ShowcaseSection id="forms" title={t("title")} description={t("description")}>
      <div className="grid gap-8 lg:grid-cols-2">
        <ShowcaseItem
          title={t("input.title")}
          description={t("input.description")}
          className="flex-col items-stretch gap-6"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="ds-input-default">{t("input.defaultLabel")}</Label>
            <Input id="ds-input-default" type="search" placeholder={t("input.placeholder")} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ds-input-disabled">{t("input.disabledLabel")}</Label>
            <Input
              id="ds-input-disabled"
              defaultValue="~/projects/demo-app"
              disabled
              className="font-mono"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ds-input-invalid">{t("input.invalidLabel")}</Label>
            <Input
              id="ds-input-invalid"
              defaultValue="19.x.y"
              aria-invalid
              aria-describedby="ds-input-invalid-error"
              className="font-mono"
            />
            <p id="ds-input-invalid-error" className="text-body-sm text-destructive">
              {t("input.invalidMessage")}
            </p>
          </div>
        </ShowcaseItem>

        <ShowcaseItem
          title={t("checkbox.title")}
          description={t("checkbox.description")}
          className="items-start"
        >
          <fieldset className="flex flex-col gap-4">
            <legend className="mb-4 text-body-sm font-semibold text-foreground">
              {t("checkbox.legend")}
            </legend>
            {CHECKBOX_DEMOS.map((item) => (
              <div key={item.id} className="flex items-center gap-3">
                <Checkbox id={item.id} defaultChecked={item.checked} disabled={item.disabled} />
                <Label htmlFor={item.id} className="font-mono text-body-sm font-normal">
                  {item.name}
                </Label>
              </div>
            ))}
            <div className="flex items-center gap-3">
              <Checkbox id="ds-check-src" checked="indeterminate" />
              <Label htmlFor="ds-check-src" className="font-mono text-body-sm font-normal">
                src
              </Label>
            </div>
          </fieldset>
        </ShowcaseItem>

        <ShowcaseItem
          title={t("select.title")}
          description={t("select.description")}
          className="flex-col items-start gap-6"
        >
          <ShowcaseRow label='size="default"'>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ds-select-manager">{t("select.managerLabel")}</Label>
              <Select defaultValue="pnpm">
                <SelectTrigger id="ds-select-manager" className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>{t("select.installed")}</SelectLabel>
                    {MANAGERS.map((manager) => (
                      <SelectItem key={manager} value={manager}>
                        {manager}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>{t("select.notInstalled")}</SelectLabel>
                    <SelectItem value="bun" disabled>
                      bun
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </ShowcaseRow>
          <ShowcaseRow label='size="sm"'>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ds-select-node">{t("select.nodeLabel")}</Label>
              <Select>
                <SelectTrigger id="ds-select-node" size="sm" className="w-56">
                  <SelectValue placeholder={t("select.nodePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {NODE_VERSIONS.map((version) => (
                    <SelectItem key={version} value={version} className="font-mono">
                      {version}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </ShowcaseRow>
          <ShowcaseRow label="disabled">
            <div className="flex flex-col gap-2">
              <Label htmlFor="ds-select-disabled">{t("select.projectManagerLabel")}</Label>
              <Select defaultValue="npm" disabled>
                <SelectTrigger id="ds-select-disabled" className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MANAGERS.map((manager) => (
                    <SelectItem key={manager} value={manager}>
                      {manager}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </ShowcaseRow>
        </ShowcaseItem>

        <ShowcaseItem
          title={t("toggleGroup.title")}
          description={t("toggleGroup.description")}
          className="flex-col items-start gap-6"
        >
          {TOGGLE_DEMOS.map((demo) => (
            <ShowcaseRow key={demo.label} label={demo.label}>
              <ToggleGroup
                type="single"
                variant={demo.variant}
                size={demo.size}
                defaultValue="all"
                className="flex-wrap"
                aria-label={t("toggleGroup.filterLabel")}
              >
                {FILTERS.map((filter) => (
                  <ToggleGroupItem key={filter} value={filter}>
                    {t(`toggleGroup.${filter}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </ShowcaseRow>
          ))}
          <ShowcaseRow label='type="multiple"'>
            <ToggleGroup
              type="multiple"
              defaultValue={["dependencies", "devDependencies"]}
              className="flex-wrap"
              aria-label={t("toggleGroup.typeLabel")}
            >
              {DEPENDENCY_TYPES.map((type) => (
                <ToggleGroupItem key={type} value={type}>
                  {type}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </ShowcaseRow>
          <ShowcaseRow label='variant="outline" spacing={0}'>
            <ToggleGroup
              type="single"
              variant="outline"
              spacing={0}
              defaultValue="pnpm"
              aria-label={t("toggleGroup.managerLabel")}
            >
              {MANAGERS.map((manager) => (
                <ToggleGroupItem key={manager} value={manager}>
                  {manager}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </ShowcaseRow>
        </ShowcaseItem>
      </div>
    </ShowcaseSection>
  )
}
