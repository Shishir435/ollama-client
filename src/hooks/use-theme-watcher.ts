import { useEffect } from "react"
import { useThemeStore } from "@/stores/theme"

/**
 * localStorage mirror of the stored preference. `public/assets/theme-init.js`
 * reads this exact key before first paint, because chrome.storage cannot be
 * read synchronously.
 */
export const THEME_MIRROR_KEY = "ollama-client-theme-mirror"

const DARK_QUERY = "(prefers-color-scheme: dark)"

export const useThemeWatcher = () => {
  const theme = useThemeStore((s) => s.theme)

  useEffect(() => {
    const root = window.document.documentElement
    const apply = (resolved: "light" | "dark") => {
      root.classList.remove("light", "dark")
      root.classList.add(resolved)
    }

    try {
      window.localStorage.setItem(THEME_MIRROR_KEY, theme)
    } catch {
      // Storage can be blocked; the pre-paint script then follows the OS.
    }

    if (theme !== "system") {
      apply(theme)
      return
    }

    const query = window.matchMedia(DARK_QUERY)
    apply(query.matches ? "dark" : "light")
    const onChange = (event: MediaQueryListEvent) =>
      apply(event.matches ? "dark" : "light")
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [theme])
}
