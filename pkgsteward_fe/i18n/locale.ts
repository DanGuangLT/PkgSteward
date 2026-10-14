"use server"

import { cookies } from "next/headers"

import {
  type AppLocale,
  defaultLocale,
  isLocale,
  LOCALE_COOKIE,
} from "@/i18n/config"

const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365

/** Ngôn ngữ hiện tại — lấy từ cookie, giá trị lạ / chưa có → ngôn ngữ mặc định. */
export async function getUserLocale(): Promise<AppLocale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value
  return isLocale(value) ? value : defaultLocale
}

/** Server Action đổi ngôn ngữ — client gọi rồi `router.refresh()`. */
export async function setUserLocale(locale: AppLocale): Promise<void> {
  if (!isLocale(locale)) return
  ;(await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: ONE_YEAR_IN_SECONDS,
    sameSite: "lax",
  })
}
