import { useEffect, useRef } from "react"

import { type ShortcutAction, useShortcutStore } from "@/stores/shortcut-store"

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  )
}

const isMainKeyMatch = (event: KeyboardEvent, mainKey: string): boolean => {
  const eventKey = event.key.toLowerCase()
  if (eventKey === mainKey) return true
  if (event.code.toLowerCase() === `key${mainKey}`) return true

  switch (mainKey) {
    case "/":
      return eventKey === "/"
    case "escape":
    case "esc":
      return eventKey === "escape"
    case "delete":
      return eventKey === "delete" || eventKey === "backspace"
    default:
      return false
  }
}

const hasExpectedModifiers = (
  event: KeyboardEvent,
  modifiers: string[],
  isMac: boolean
): boolean => {
  const requiredMod = modifiers.includes("Mod")
  const requiredShift = modifiers.includes("Shift")
  const requiredAlt = modifiers.includes("Alt")
  const requiredCtrl = modifiers.includes("Ctrl")
  const pressedMod = isMac ? event.metaKey : event.ctrlKey

  if (requiredMod !== pressedMod) return false
  if (requiredShift !== event.shiftKey) return false
  if (requiredAlt !== event.altKey) return false
  if (requiredCtrl && !event.ctrlKey) return false
  if (!requiredCtrl && !requiredMod && event.ctrlKey && !isMac) return false
  return true
}

const matchesShortcut = (
  event: KeyboardEvent,
  shortcutKey: string,
  isMac: boolean
): boolean => {
  const keys = shortcutKey.split("+")
  const mainKey = keys.at(-1)?.toLowerCase()
  if (!mainKey || !isMainKeyMatch(event, mainKey)) return false
  return hasExpectedModifiers(event, keys.slice(0, -1), isMac)
}

export const useKeyboardShortcuts = (
  handlers: Partial<Record<ShortcutAction, (e: KeyboardEvent) => void>>
) => {
  const { shortcuts } = useShortcutStore()
  const handlersRef = useRef(handlers)

  useEffect(() => {
    handlersRef.current = handlers
  }, [handlers])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isInput = isTypingTarget(event.target)
      const isMac = navigator.platform.toUpperCase().includes("MAC")

      for (const [action, handler] of Object.entries(handlersRef.current)) {
        if (!handler) continue
        const shortcut = shortcuts[action as ShortcutAction]
        if (!shortcut || !matchesShortcut(event, shortcut.key, isMac)) continue
        if (action === "focusInput" && isInput) continue

        event.preventDefault()
        handler(event)
        return
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [shortcuts])
}
