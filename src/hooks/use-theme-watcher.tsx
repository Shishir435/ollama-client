import { useEffect } from "react"

import { useThemeStore } from "@/store/theme"

export function useThemeWatcher() {
  const theme = useThemeStore((s) => s.theme)

  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove("light", "dark")

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light"
      root.classList.add(systemTheme)
    } else {
      root.classList.add(theme)
    }
  }, [theme])
}
