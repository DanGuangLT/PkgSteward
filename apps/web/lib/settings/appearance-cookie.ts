"use server"

import { cookies } from "next/headers"

import {
  sanitizeAppearance,
  serializeAppearanceCookie,
  UI_PREFS_COOKIE,
} from "@/lib/settings/appearance-prefs"
import type { AppearanceSettings } from "@/lib/settings/types"
import { THEME_PRESET_COOKIE } from "@/lib/theme/presets"

const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365

export async function setAppearanceCookie(prefs: AppearanceSettings): Promise<void> {
  const safe = sanitizeAppearance(prefs)
  const store = await cookies()
  store.set(UI_PREFS_COOKIE, serializeAppearanceCookie(safe), {
    path: "/",
    maxAge: ONE_YEAR_IN_SECONDS,
    sameSite: "lax",
  })
  store.set(THEME_PRESET_COOKIE, safe.themePreset, {
    path: "/",
    maxAge: ONE_YEAR_IN_SECONDS,
    sameSite: "lax",
  })
}
