import { Keyboard, RotateCcw, Search, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import {
  DEFAULT_SHORTCUTS,
  type Shortcut,
  type ShortcutAction,
  useShortcutStore
} from "@/stores/shortcut-store"

const CATEGORY_LABELS = {
  navigation: "Navigation",
  actions: "Actions",
  toggles: "Toggles"
} as const

export const ShortcutsSettings = () => {
  const { t } = useTranslation()
  const {
    shortcuts,
    updateShortcut,
    resetShortcut,
    resetShortcuts,
    hasConflict
  } = useShortcutStore()
  const [recordingAction, setRecordingAction] = useState<ShortcutAction | null>(
    null
  )
  const [searchQuery, setSearchQuery] = useState("")
  const [conflictWarning, setConflictWarning] = useState<string | null>(null)

  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0

  // Filter shortcuts based on search query
  const filteredShortcuts = useMemo(() => {
    if (!searchQuery.trim()) return shortcuts
    const query = searchQuery.toLowerCase()
    const filtered: Partial<Record<ShortcutAction, Shortcut>> = {}
    for (const [action, shortcut] of Object.entries(shortcuts)) {
      const label = t(shortcut.label).toLowerCase()
      const desc = t(shortcut.description, { defaultValue: "" }).toLowerCase()
      if (
        label.includes(query) ||
        desc.includes(query) ||
        shortcut.key.toLowerCase().includes(query)
      ) {
        filtered[action as ShortcutAction] = shortcut
      }
    }
    return filtered as Record<ShortcutAction, Shortcut>
  }, [shortcuts, searchQuery, t])

  // Group shortcuts by category
  const groupedShortcuts = useMemo(() => {
    const groups: Record<string, Shortcut[]> = {
      navigation: [],
      actions: [],
      toggles: []
    }
    for (const shortcut of Object.values(filteredShortcuts)) {
      if (groups[shortcut.category]) {
        groups[shortcut.category].push(shortcut)
      }
    }
    return groups
  }, [filteredShortcuts])

  useEffect(() => {
    if (!recordingAction) return

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (["Control", "Alt", "Meta", "Shift"].includes(e.key)) {
        return
      }

      // Cancel on Escape
      if (
        e.key === "Escape" &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey
      ) {
        setRecordingAction(null)
        return
      }

      const modifiers = []
      if (e.metaKey && isMac) modifiers.push("Mod")
      if (e.ctrlKey && !isMac) modifiers.push("Mod")
      if (e.ctrlKey && isMac) modifiers.push("Ctrl")
      if (e.altKey) modifiers.push("Alt")
      if (e.shiftKey) modifiers.push("Shift")

      // On Mac, Option+key produces special characters (e.g., Option+G = ©)
      // Use e.code to get the actual physical key pressed
      let key = e.key

      // Extract letter from KeyX codes when Alt is pressed (Mac produces special chars)
      if (e.altKey && e.code.startsWith("Key")) {
        key = e.code.replace("Key", "")
      } else if (e.altKey && e.code.startsWith("Digit")) {
        key = e.code.replace("Digit", "")
      } else if (key === " ") {
        key = "Space"
      } else if (key === "Escape") {
        key = "Escape"
      } else if (key === "Delete") {
        key = "Delete"
      } else if (key === "Backspace") {
        key = "Backspace"
      } else if (key.length === 1) {
        key = key.toUpperCase()
      }

      const newShortcut = [...modifiers, key].join("+")

      const conflictAction = hasConflict(newShortcut, recordingAction)
      if (conflictAction) {
        setConflictWarning(
          `Already used by "${t(shortcuts[conflictAction].label)}"`
        )
        setTimeout(() => setConflictWarning(null), 2000)
        setRecordingAction(null)
        return
      }

      updateShortcut(recordingAction, newShortcut)
      setRecordingAction(null)
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [recordingAction, updateShortcut, isMac, hasConflict, shortcuts, t])

  const formatKey = (key: string) => {
    if (key === "Mod") return isMac ? "⌘" : "Ctrl"
    if (key === "Shift") return "⇧"
    if (key === "Alt") return isMac ? "⌥" : "Alt"
    if (key === "Ctrl") return "⌃"
    if (key === "Enter") return "↵"
    if (key === "Space") return "Space"
    if (key === "Escape") return "Esc"
    if (key === "Delete") return "Del"
    if (key === "Backspace") return "⌫"
    return key
  }

  const renderShortcutKeys = (shortcutStr: string) => {
    const keys = shortcutStr.split("+")
    return (
      <div className="flex items-center gap-1">
        {keys.map((key) => (
          <Kbd key={`${shortcutStr}-${key}`}>{formatKey(key)}</Kbd>
        ))}
      </div>
    )
  }

  const hasAnyModifications = Object.values(shortcuts).some(
    (s) => s.key !== DEFAULT_SHORTCUTS[s.id].defaultKey
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Keyboard className="size-5" />
          {t("settings.shortcuts.title")}
        </CardTitle>
        <CardDescription>{t("settings.shortcuts.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search shortcuts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Conflict warning */}
        {conflictWarning && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {conflictWarning}
          </div>
        )}

        {/* Shortcuts list */}
        <div className="space-y-6">
          {(["navigation", "actions", "toggles"] as const).map((category) => {
            const categoryShortcuts = groupedShortcuts[category]
            if (categoryShortcuts.length === 0) return null

            return (
              <div key={category}>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {CATEGORY_LABELS[category]}
                </h4>
                <div className="space-y-1">
                  {categoryShortcuts.map((shortcut) => {
                    const isRecording = recordingAction === shortcut.id
                    const isModified =
                      shortcut.key !== DEFAULT_SHORTCUTS[shortcut.id].defaultKey

                    return (
                      <button
                        type="button"
                        key={shortcut.id}
                        className={`group flex w-full cursor-pointer items-center justify-between rounded-md px-3 py-2 text-left transition-colors hover:bg-accent/50 ${
                          isRecording ? "bg-accent ring-2 ring-primary" : ""
                        }`}
                        onClick={() => {
                          if (!isRecording) {
                            setRecordingAction(shortcut.id)
                          }
                        }}>
                        <div className="flex-1">
                          <div className="text-sm font-medium">
                            {t(shortcut.label)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {t(shortcut.description, { defaultValue: "" })}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {isRecording ? (
                            <span className="animate-pulse text-sm text-primary">
                              {t("settings.shortcuts.recording")}
                            </span>
                          ) : (
                            renderShortcutKeys(shortcut.key)
                          )}
                          {isModified && !isRecording && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-6 opacity-0 transition-opacity group-hover:opacity-100"
                              onClick={(e) => {
                                e.stopPropagation()
                                resetShortcut(shortcut.id)
                              }}>
                              <X className="size-3" />
                            </Button>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Reset all */}
        {hasAnyModifications && (
          <div className="flex justify-end border-t pt-4">
            <Button variant="outline" size="sm" onClick={resetShortcuts}>
              <RotateCcw className="mr-2 size-3" />
              {t("settings.shortcuts.reset_all")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
