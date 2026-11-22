"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import { toast } from "sonner"
import { useTranslations } from "next-intl"

import { setUserLocale } from "@/i18n/locale"
import { isLocale } from "@/i18n/config"
import { getBrowserSettings, updateBrowserPreferences } from "@/lib/api/settings/settings-browser"
import { setAppearanceCookie } from "@/lib/settings/appearance-cookie"
import {
  appearanceEquals,
  applyAppearanceToDocument,
  DEFAULT_BEHAVIOR,
  sanitizeAppearance,
} from "@/lib/settings/appearance-prefs"
import type {
  AppearanceSettings,
  BehaviorSettings,
  PreferencesPatch,
  ServerSettings,
  SettingsSnapshot,
} from "@/lib/settings/types"

interface SettingsContextValue {
  appearance: AppearanceSettings
  behavior: BehaviorSettings
  snapshot: SettingsSnapshot | null
  restartRequiredFields: (keyof ServerSettings)[]
  loading: boolean
  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
  openSettings: () => void
  closeSettings: () => void
  updatePreferences: (patch: PreferencesPatch) => Promise<SettingsSnapshot | null>
  applySnapshot: (next: SettingsSnapshot) => void
  refreshSettings: () => Promise<SettingsSnapshot | null>
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({
  initialAppearance,
  initialLocale,
  children,
}: {
  initialAppearance: AppearanceSettings
  initialLocale: string
  children: React.ReactNode
}) {
  const t = useTranslations("settings.messages")
  const router = useRouter()
  const { setTheme } = useTheme()

  const [appearance, setAppearance] = useState<AppearanceSettings>(() =>
    sanitizeAppearance(initialAppearance)
  )
  const [behavior, setBehavior] = useState<BehaviorSettings>(() => ({
    ...DEFAULT_BEHAVIOR,
    locale: isLocale(initialLocale) ? initialLocale : DEFAULT_BEHAVIOR.locale,
  }))
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null)
  const [restartRequiredFields, setRestartRequiredFields] = useState<(keyof ServerSettings)[]>([])
  const [loading, setLoading] = useState(true)
  const [settingsOpen, setSettingsOpenState] = useState(false)

  const appearanceRef = useRef(appearance)
  const behaviorRef = useRef(behavior)
  const snapshotRef = useRef(snapshot)

  useEffect(() => {
    appearanceRef.current = appearance
    behaviorRef.current = behavior
    snapshotRef.current = snapshot
  }, [appearance, behavior, snapshot])

  const applySnapshot = useCallback(
    (next: SettingsSnapshot) => {
      const sanitized = sanitizeAppearance(next.document.appearance)
      setSnapshot(next)
      setAppearance(sanitized)
      setBehavior(next.document.behavior)
      setRestartRequiredFields(next.restartRequiredFields)

      if (typeof document !== "undefined") {
        applyAppearanceToDocument(document, sanitized)
      }
      setTheme(sanitized.themeMode)
      void setAppearanceCookie(sanitized)
    },
    [setTheme]
  )

  const refreshSettings = useCallback(async (): Promise<SettingsSnapshot | null> => {
    try {
      const next = await getBrowserSettings()
      applySnapshot(next)
      return next
    } catch {
      return null
    } finally {
      setLoading(false)
    }
  }, [applySnapshot])

  useEffect(() => {
    const controller = new AbortController()
    getBrowserSettings(controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return
        setSnapshot(next)
        setBehavior(next.document.behavior)
        setRestartRequiredFields(next.restartRequiredFields)

        const serverAppearance = sanitizeAppearance(next.document.appearance)
        if (!appearanceEquals(appearanceRef.current, serverAppearance)) {
          setAppearance(serverAppearance)
          if (typeof document !== "undefined") {
            applyAppearanceToDocument(document, serverAppearance)
          }
          setTheme(serverAppearance.themeMode)
          void setAppearanceCookie(serverAppearance)
        }
      })
      .catch(() => {
        // Khi API tắt hoặc offline, giữ giao diện sạch từ cookie.
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [setTheme])

  const updatePreferences = useCallback(
    async (patch: PreferencesPatch): Promise<SettingsSnapshot | null> => {
      const prevAppearance = appearanceRef.current
      const prevBehavior = behaviorRef.current

      const nextAppearance = patch.appearance
        ? sanitizeAppearance({ ...prevAppearance, ...patch.appearance })
        : prevAppearance
      const nextBehavior = patch.behavior ? { ...prevBehavior, ...patch.behavior } : prevBehavior

      if (patch.appearance) {
        setAppearance(nextAppearance)
        if (typeof document !== "undefined") {
          applyAppearanceToDocument(document, nextAppearance)
        }
        setTheme(nextAppearance.themeMode)
        void setAppearanceCookie(nextAppearance)
      }
      if (patch.behavior) {
        setBehavior(nextBehavior)
        if (patch.behavior.locale && isLocale(patch.behavior.locale) && patch.behavior.locale !== prevBehavior.locale) {
          await setUserLocale(patch.behavior.locale)
          router.refresh()
        }
      }

      try {
        const updated = await updateBrowserPreferences(patch)
        applySnapshot(updated)
        return updated
      } catch (error) {
        if (patch.appearance) {
          setAppearance(prevAppearance)
          if (typeof document !== "undefined") {
            applyAppearanceToDocument(document, prevAppearance)
          }
          setTheme(prevAppearance.themeMode)
          void setAppearanceCookie(prevAppearance)
        }
        if (patch.behavior) {
          setBehavior(prevBehavior)
        }
        toast.error(error instanceof Error ? error.message : t("saveFailed"))
        return null
      }
    },
    [applySnapshot, router, setTheme, t]
  )

  const setSettingsOpen = useCallback(
    (open: boolean) => {
      setSettingsOpenState(open)
      if (open && !snapshotRef.current) {
        void refreshSettings()
      }
    },
    [refreshSettings]
  )

  const openSettings = useCallback(() => {
    setSettingsOpen(true)
  }, [setSettingsOpen])

  const closeSettings = useCallback(() => {
    setSettingsOpenState(false)
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key === ",") {
        if (typeof window !== "undefined" && window.location.pathname === "/settings") {
          return
        }
        event.preventDefault()
        setSettingsOpenState((prev) => {
          const next = !prev
          if (next && !snapshotRef.current) {
            void refreshSettings()
          }
          return next
        })
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [refreshSettings])

  return (
    <SettingsContext.Provider
      value={{
        appearance,
        behavior,
        snapshot,
        restartRequiredFields,
        loading,
        settingsOpen,
        setSettingsOpen,
        openSettings,
        closeSettings,
        updatePreferences,
        applySnapshot,
        refreshSettings,
      }}
    >
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettingsOptional(): SettingsContextValue | null {
  return useContext(SettingsContext)
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider")
  return ctx
}
