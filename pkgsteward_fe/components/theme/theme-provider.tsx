"use client"

import { ThemeProvider as NextThemesProvider } from "next-themes"

/**
 * Chế độ sáng / tối / theo hệ thống. next-themes gắn class `.dark` lên <html>
 * bằng inline script trước khi trình duyệt vẽ trang, nên không bị nháy màu.
 * Màu cụ thể của từng chế độ nằm trong styles/themes/<preset>.css.
 */
export function ThemeProvider({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  )
}
