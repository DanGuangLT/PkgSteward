"use client"

import { useEffect, useState, useSyncExternalStore } from "react"

import {
  createFileOpsSession, type FileOpsActions, type FileOpsEnvironment, type FileOpsSnapshot,
} from "@/lib/file-ops/file-ops-session"

export type FileOpsController = FileOpsActions & FileOpsSnapshot

const PREVIEW_KEY = "pkgsteward.fileOps.previewId"

const browserEnvironment: FileOpsEnvironment = {
  isVisible: () => document.visibilityState === "visible",
  onVisibilityChange(listener) {
    document.addEventListener("visibilitychange", listener)
    return () => document.removeEventListener("visibilitychange", listener)
  },
  recallPreview() {
    try {
      return sessionStorage.getItem(PREVIEW_KEY)
    } catch {
      return null
    }
  },
  rememberPreview(previewId) {
    try {
      if (previewId === null) sessionStorage.removeItem(PREVIEW_KEY)
      else sessionStorage.setItem(PREVIEW_KEY, previewId)
    } catch {
      // Trình duyệt chặn lưu trữ: chỉ mất khả năng nối lại preview sau khi tải trang.
    }
  },
}

export function useFileOps(): FileOpsController {
  const [session] = useState(() => createFileOpsSession(browserEnvironment))
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)
  useEffect(() => session.connect(), [session])
  return { ...session, ...snapshot }
}
