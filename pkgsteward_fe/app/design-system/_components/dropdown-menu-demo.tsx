"use client"

import { useState } from "react"
import {
  ChevronDownIcon,
  CopyIcon,
  FileDownIcon,
  FolderOpenIcon,
  PlayIcon,
  Trash2Icon,
} from "lucide-react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const SCRIPTS = ["dev", "build", "test"] as const
const SORT_KEYS = ["name", "size"] as const

type SortKey = (typeof SORT_KEYS)[number]

function isSortKey(value: string): value is SortKey {
  return SORT_KEYS.includes(value as SortKey)
}

/**
 * Demo DropdownMenu đủ các loại mục. Checkbox / radio giữ state để thấy dấu
 * chọn đổi; các mục còn lại không làm gì (chỉ để xem giao diện).
 */
export function DropdownMenuDemo() {
  const t = useTranslations("designSystem.overlays.dropdown")
  const [showDev, setShowDev] = useState(true)
  const [showPeer, setShowPeer] = useState(false)
  const [sortBy, setSortBy] = useState<SortKey>("name")

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary">
          {t("trigger")}
          <ChevronDownIcon data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <DropdownMenuLabel className="font-mono">demo-app</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <FolderOpenIcon />
            {t("openFolder")}
            <DropdownMenuShortcut>Ctrl+O</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <CopyIcon />
            {t("copyPath")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <FileDownIcon />
            {t("exportReport")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={showDev} onCheckedChange={setShowDev}>
          {t("showDev")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={showPeer} onCheckedChange={setShowPeer}>
          {t("showPeer")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t("sortBy")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={sortBy}
          onValueChange={(value) => {
            if (isSortKey(value)) setSortBy(value)
          }}
        >
          {SORT_KEYS.map((key) => (
            <DropdownMenuRadioItem key={key} value={key}>
              {t(`sort.${key}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <PlayIcon />
            {t("runScript")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {SCRIPTS.map((script) => (
              <DropdownMenuItem key={script} className="font-mono">
                {script}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          <Trash2Icon />
          {t("deleteNodeModules")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
