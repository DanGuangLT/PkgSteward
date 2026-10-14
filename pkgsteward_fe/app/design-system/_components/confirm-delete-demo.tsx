"use client"

import { Trash2Icon, TriangleAlertIcon } from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

// Giả lập kết quả API `preview` — màn hình thật hiện đúng danh sách backend trả về.
const PREVIEW_ITEMS = [
  { path: "~/projects/demo-app/node_modules", megabytes: 412.6 },
  { path: "~/projects/demo-app/.next", megabytes: 96.4 },
  { path: "~/projects/demo-app/coverage", megabytes: 2.3 },
] as const

const TOTAL_MEGABYTES = PREVIEW_ITEMS.reduce((sum, item) => sum + item.megabytes, 0)

/**
 * Demo luồng Preview → Confirm: hộp xác nhận liệt kê từng mục sẽ bị ảnh hưởng,
 * Huỷ (secondary, được focus sẵn) và nút xác nhận destructive nêu rõ hành động.
 * Bản demo: không gọi API, chỉ hiện toast.
 */
export function ConfirmDeleteDemo() {
  const t = useTranslations("designSystem.dangerous.demo")
  const tCommon = useTranslations("common")
  const format = useFormatter()
  const count = PREVIEW_ITEMS.length

  function formatSize(megabytes: number) {
    return format.number(megabytes, {
      style: "unit",
      unit: "megabyte",
      maximumFractionDigits: 1,
    })
  }

  function handleConfirm() {
    toast.success(t("toastTitle", { count }), {
      description: t("toastDescription"),
    })
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive">
          <Trash2Icon data-icon="inline-start" />
          {t("trigger")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="text-destructive">
            <TriangleAlertIcon />
          </AlertDialogMedia>
          <AlertDialogTitle>{t("dialogTitle", { count })}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("dialogDescription", { size: formatSize(TOTAL_MEGABYTES) })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul
          aria-label={t("listLabel")}
          className="flex flex-col gap-2 rounded-md bg-muted p-4"
        >
          {PREVIEW_ITEMS.map((item) => (
            <li
              key={item.path}
              className="flex items-baseline justify-between gap-4 text-body-sm"
            >
              <span className="min-w-0 font-mono break-all text-foreground">
                {item.path}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {formatSize(item.megabytes)}
              </span>
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={handleConfirm}>
            {t("confirm", { count })}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
