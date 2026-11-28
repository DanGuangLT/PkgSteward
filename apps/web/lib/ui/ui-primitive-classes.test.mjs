import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { cn } from "../utils.ts"
import {
  selectTriggerBaseClasses,
  sheetContentBaseClasses,
  tabsTriggerBaseClasses,
} from "./ui-primitive-classes.ts"

const WEB_ROOT = new URL("../../", import.meta.url)

function readWebSource(relativePath) {
  return readFileSync(new URL(relativePath, WEB_ROOT), "utf8")
}

// TEST cases for UI primitive class helpers and layout/navigation contracts; không phải yêu cầu nghiệp vụ.
test("SelectTrigger resolves size directly in JS without data-[size=*] specificity trap and truncates SelectValue cleanly", () => {
  const defaultTokens = selectTriggerBaseClasses("default").split(/\s+/)
  assert.equal(defaultTokens.includes("h-11"), true)
  assert.equal(defaultTokens.some((token) => token.startsWith("data-[size=")), false)
  assert.equal(defaultTokens.includes("*:data-[slot=select-value]:min-w-0"), true)
  assert.equal(defaultTokens.includes("*:data-[slot=select-value]:truncate"), true)
  assert.equal(defaultTokens.includes("*:data-[slot=select-value]:flex"), false)

  const smTokens = selectTriggerBaseClasses("sm").split(/\s+/)
  assert.equal(smTokens.includes("h-9"), true)
  assert.equal(smTokens.some((token) => token.startsWith("data-[size=")), false)

  const overridden = cn(selectTriggerBaseClasses("sm"), "h-8").split(/\s+/)
  assert.equal(overridden.includes("h-8"), true)
  assert.equal(overridden.includes("h-9"), false)
})

test("SheetContent emits unprefixed width/max-width tokens per side so caller utilities override cleanly", () => {
  for (const side of ["left", "right"]) {
    const tokens = sheetContentBaseClasses(side).split(/\s+/)
    assert.equal(tokens.includes("w-3/4"), true)
    assert.equal(tokens.includes("sm:max-w-sm"), true)
    assert.equal(tokens.some((token) => token.startsWith("data-[side=") && token.includes("w-")), false)
    assert.equal(tokens.some((token) => token.startsWith("data-[side=") && token.includes("max-w-")), false)
  }

  for (const side of ["top", "bottom"]) {
    const tokens = sheetContentBaseClasses(side).split(/\s+/)
    assert.equal(tokens.includes("h-auto"), true)
    assert.equal(tokens.includes("w-3/4"), false)
    assert.equal(tokens.includes("sm:max-w-sm"), false)
  }

  const overridden = cn(sheetContentBaseClasses("left"), "w-80 sm:max-w-md").split(/\s+/)
  assert.equal(overridden.includes("w-80"), true)
  assert.equal(overridden.includes("sm:max-w-md"), true)
  assert.equal(overridden.includes("w-3/4"), false)
  assert.equal(overridden.includes("sm:max-w-sm"), false)
})

test("TabsTrigger allows caller px overrides and keeps active line indicator inside TabsList bounds", () => {
  const tokens = tabsTriggerBaseClasses().split(/\s+/)
  assert.equal(tokens.includes("px-3"), true)
  assert.equal(tokens.includes("group-data-[variant=line]/tabs-list:px-1"), false)
  assert.equal(tokens.includes("group-data-horizontal/tabs:after:bottom-0"), true)
  assert.equal(tokens.includes("group-data-vertical/tabs:after:right-0"), true)
  assert.equal(tokens.some((token) => token.includes("bottom-[-5px]")), false)

  const overridden = cn(tabsTriggerBaseClasses(), "px-4").split(/\s+/)
  assert.equal(overridden.includes("px-4"), true)
  assert.equal(overridden.includes("px-3"), false)
})

test("floating overlay primitives render visible borders so Frosted/high-contrast rules remain defined", () => {
  const dialogSrc = readWebSource("components/ui/dialog.tsx")
  assert.match(dialogSrc, /data-slot="dialog-content"[\s\S]*?border border-border/)
  assert.match(dialogSrc, /data-slot="dialog-content"[\s\S]*?grid-cols-1/)
  assert.match(dialogSrc, /data-slot="dialog-content"[\s\S]*?min-w-0/)
  assert.match(dialogSrc, /data-slot="dialog-header"[\s\S]*?min-w-0/)

  const dropdownSrc = readWebSource("components/ui/dropdown-menu.tsx")
  assert.match(dropdownSrc, /data-slot="dropdown-menu-content"[\s\S]*?border border-border/)
  assert.match(dropdownSrc, /data-slot="dropdown-menu-sub-content"[\s\S]*?border border-border/)

  const selectSrc = readWebSource("components/ui/select.tsx")
  assert.match(selectSrc, /data-slot="select-content"[\s\S]*?border border-border/)

  const cardSrc = readWebSource("components/ui/card.tsx")
  assert.match(cardSrc, /data-slot="card-header"[\s\S]*?grid-cols-1/)
  assert.match(cardSrc, /data-slot="card-header"[\s\S]*?min-w-0/)
  assert.match(cardSrc, /has-data-\[slot=card-action\]:grid-cols-\[minmax\(0,1fr\)_auto\]/)
})

test("layout navigation enforces full-width vertical links, WCAG AA BrandWordmark size, and non-overlapping runner dock", () => {
  const navLinksSrc = readWebSource("components/layout/nav-links.tsx")
  assert.match(navLinksSrc, /vertical:\s*"[^"]*\bw-full\b/)

  for (const file of [
    "components/layout/sidebar-nav.tsx",
    "components/layout/app-shell.tsx",
    "components/layout/top-nav.tsx",
  ]) {
    const src = readWebSource(file)
    const brandIdx = src.indexOf("<BrandWordmark")
    assert.notEqual(brandIdx, -1, `Expected <BrandWordmark in ${file}`)
    const linkStart = src.lastIndexOf("<Link", brandIdx)
    const snippet = src.slice(linkStart, brandIdx + 120)
    assert.match(snippet, /\btext-heading-lg\b/, `Expected text-heading-lg on BrandWordmark Link in ${file}`)
    assert.doesNotMatch(snippet, /\btext-heading-md\b/, `Unexpected small text-heading-md on BrandWordmark Link in ${file}`)
  }

  const rootLayoutSrc = readWebSource("app/layout.tsx")
  assert.match(rootLayoutSrc, /<AppShell[\s\S]*?\bdock=\{<NativeSessionStatus \/>\}/)

  const appShellSrc = readWebSource("components/layout/app-shell.tsx")
  assert.match(appShellSrc, /\bdock\?:/)
  assert.match(appShellSrc, /<\/main>\s*\{dock\}/)

  const settingsWorkspaceSrc = readWebSource("components/features/settings/settings-workspace.tsx")
  assert.equal(settingsWorkspaceSrc.includes("bg-primary/10 font-semibold text-primary"), false)

  const serverTabSrc = readWebSource("components/features/settings/server-tab.tsx")
  assert.match(serverTabSrc, /\blg:grid-cols-2\b/)
  assert.doesNotMatch(serverTabSrc, /\bsm:grid-cols-2\b/)
  assert.equal(serverTabSrc.includes('<div className="flex items-center justify-between">'), false)

  const runtimeTabSrc = readWebSource("components/features/settings/runtime-tab.tsx")
  assert.equal(runtimeTabSrc.includes('<div className="flex items-center justify-between gap-2">'), false)

  const disabledTooltipSrc = readWebSource("components/shared/disabled-tooltip.tsx")
  assert.match(disabledTooltipSrc, /inline-grid min-w-0 max-w-full grid-cols-\[minmax\(0,1fr\)\]/)

  const cleanupItemsSrc = readWebSource("components/features/file-ops/cleanup-items.tsx")
  assert.match(cleanupItemsSrc, /\bxl:flex-row\b/)
  assert.doesNotMatch(cleanupItemsSrc, /\blg:flex-row\b/)
})
