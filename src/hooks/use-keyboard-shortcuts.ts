import { useEffect } from "react"

import { type ShortcutAction, useShortcutStore } from "@/stores/shortcut-store"

export const useKeyboardShortcuts = (
  handlers: Partial<Record<ShortcutAction, (e: KeyboardEvent) => void>>
) => {
  const { shortcuts } = useShortcutStore()

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if user is typing in an input, textarea, or contenteditable
      // UNLESS the shortcut is specifically for focusing input (like '/')
      // or if it uses a modifier key (like Cmd+Enter)
      const target = event.target as HTMLElement
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable

      // Platform detection
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0

      // Helper to check if key matches
      const matches = (action: ShortcutAction) => {
        const shortcut = shortcuts[action]
        if (!shortcut) return false

        const keys = shortcut.key.split("+")
        const mainKey = keys[keys.length - 1].toLowerCase()
        const modifiers = keys.slice(0, -1)

        const eventKey = event.key.toLowerCase()

        // Check main key
        if (
          eventKey !== mainKey &&
          event.code.toLowerCase() !== `key${mainKey}`
        ) {
          // Special case for '/' which might be 'Slash' or '?'
          if (mainKey === "/" && eventKey !== "/") return false
          // Special case for 'escape'
          if (mainKey === "escape" && eventKey !== "escape") return false
          if (mainKey === "esc" && eventKey !== "escape") return false
          // Special case for 'delete'
          if (
            mainKey === "delete" &&
            eventKey !== "delete" &&
            eventKey !== "backspace"
          )
            return false
          // If not special cases, and key doesn't match, return false
          if (
            mainKey !== "/" &&
            mainKey !== "esc" &&
            mainKey !== "escape" &&
            mainKey !== "delete" &&
            eventKey !== mainKey
          )
            return false
        }

        // Mod key means Meta on Mac, Ctrl on Windows/Linux
        const requiredMod = modifiers.includes("Mod")
        const requiredShift = modifiers.includes("Shift")
        const requiredAlt = modifiers.includes("Alt")
        const requiredCtrl = modifiers.includes("Ctrl")

        // What Mod key means for this platform
        const pressedMod = isMac ? event.metaKey : event.ctrlKey

        // Check all required modifiers are pressed
        if (requiredMod && !pressedMod) return false
        if (requiredShift && !event.shiftKey) return false
        if (requiredAlt && !event.altKey) return false
        if (requiredCtrl && !event.ctrlKey) return false

        // Ensure no EXTRA modifiers are pressed (for precision)
        // If Mod is required, Mod is pressed (checked above). If not required, should not be pressed.
        if (!requiredMod && pressedMod) return false
        if (!requiredShift && event.shiftKey) return false
        if (!requiredAlt && event.altKey) return false
        // For explicit Ctrl (not Mod), check separately
        if (!requiredCtrl && !requiredMod && event.ctrlKey && !isMac)
          return false

        return true
      }

      for (const [action, handler] of Object.entries(handlers)) {
        if (handler && matches(action as ShortcutAction)) {
          // Allow default for some actions if needed, but usually prevent default
          // especially for browser shortcuts
          if (action !== "focusInput" || !isInput) {
            event.preventDefault()
            handler(event)
            return
          }
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handlers, shortcuts])
}
