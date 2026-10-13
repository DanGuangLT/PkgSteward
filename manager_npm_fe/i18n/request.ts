import { getRequestConfig } from "next-intl/server"

import { type AppLocale, defaultLocale } from "@/i18n/config"
import { getUserLocale } from "@/i18n/locale"

type MessageTree = { [key: string]: string | MessageTree }

async function loadMessages(locale: AppLocale): Promise<MessageTree> {
  return (await import(`../messages/${locale}.json`)).default
}

/**
 * Ghép bản dịch của ngôn ngữ đang chọn đè lên ngôn ngữ mặc định: key nào
 * chưa dịch sẽ hiện bằng ngôn ngữ mặc định thay vì lỗi — nhờ vậy thêm ngôn
 * ngữ mới có thể dịch dần.
 */
function mergeMessages(base: MessageTree, override: MessageTree): MessageTree {
  const result: MessageTree = { ...base }
  for (const [key, value] of Object.entries(override)) {
    const baseValue = base[key]
    result[key] =
      typeof value === "object" && typeof baseValue === "object"
        ? mergeMessages(baseValue, value)
        : value
  }
  return result
}

export default getRequestConfig(async () => {
  const locale = await getUserLocale()
  const defaultMessages = await loadMessages(defaultLocale)
  const messages =
    locale === defaultLocale
      ? defaultMessages
      : mergeMessages(defaultMessages, await loadMessages(locale))

  return { locale, messages }
})
