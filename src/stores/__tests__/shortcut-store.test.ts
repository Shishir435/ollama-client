import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined)
  }
}))

globalThis.chrome = {
  storage: { onChanged: { addListener: vi.fn() } }
} as unknown as typeof chrome

import { DEFAULT_SHORTCUTS, useShortcutStore } from "../shortcut-store"

beforeEach(() => {
  useShortcutStore.setState({ shortcuts: { ...DEFAULT_SHORTCUTS } })
  vi.clearAllMocks()
})

describe("useShortcutStore — initial state", () => {
  it("initializes with default shortcuts", () => {
    const { shortcuts } = useShortcutStore.getState()
    expect(shortcuts.newChat).toBeDefined()
    expect(shortcuts.newChat.key).toBe(DEFAULT_SHORTCUTS.newChat.defaultKey)
  })

  it("all default shortcuts have key equal to defaultKey", () => {
    const { shortcuts } = useShortcutStore.getState()
    for (const shortcut of Object.values(shortcuts)) {
      expect(shortcut.key).toBe(shortcut.defaultKey)
    }
  })
})

describe("useShortcutStore — updateShortcut", () => {
  it("updates key for an action", () => {
    useShortcutStore.getState().updateShortcut("newChat", "Ctrl+N")
    expect(useShortcutStore.getState().shortcuts.newChat.key).toBe("Ctrl+N")
  })

  it("preserves other shortcuts when updating one", () => {
    useShortcutStore.getState().updateShortcut("newChat", "Ctrl+N")
    expect(useShortcutStore.getState().shortcuts.focusInput.key).toBe(
      DEFAULT_SHORTCUTS.focusInput.defaultKey
    )
  })

  it("preserves defaultKey after update", () => {
    useShortcutStore.getState().updateShortcut("newChat", "Ctrl+N")
    expect(useShortcutStore.getState().shortcuts.newChat.defaultKey).toBe(
      DEFAULT_SHORTCUTS.newChat.defaultKey
    )
  })
})

describe("useShortcutStore — resetShortcut", () => {
  it("resets single shortcut to defaultKey", () => {
    useShortcutStore.getState().updateShortcut("newChat", "Ctrl+N")
    useShortcutStore.getState().resetShortcut("newChat")
    expect(useShortcutStore.getState().shortcuts.newChat.key).toBe(
      DEFAULT_SHORTCUTS.newChat.defaultKey
    )
  })

  it("does not affect other shortcuts", () => {
    useShortcutStore.getState().updateShortcut("newChat", "Ctrl+N")
    useShortcutStore.getState().updateShortcut("focusInput", "Ctrl+F")
    useShortcutStore.getState().resetShortcut("newChat")
    expect(useShortcutStore.getState().shortcuts.focusInput.key).toBe("Ctrl+F")
  })
})

describe("useShortcutStore — resetShortcuts", () => {
  it("resets all shortcuts to defaults", () => {
    useShortcutStore.getState().updateShortcut("newChat", "Ctrl+N")
    useShortcutStore.getState().updateShortcut("focusInput", "Ctrl+F")
    useShortcutStore.getState().resetShortcuts()

    const { shortcuts } = useShortcutStore.getState()
    for (const [action, shortcut] of Object.entries(shortcuts)) {
      expect(shortcut.key).toBe(
        DEFAULT_SHORTCUTS[action as keyof typeof DEFAULT_SHORTCUTS].defaultKey
      )
    }
  })
})

describe("useShortcutStore — hasConflict", () => {
  it("returns null when key is unique", () => {
    const result = useShortcutStore.getState().hasConflict("Ctrl+Shift+Z")
    expect(result).toBeNull()
  })

  it("detects conflict with existing shortcut", () => {
    const existingKey = DEFAULT_SHORTCUTS.newChat.defaultKey
    const conflict = useShortcutStore.getState().hasConflict(existingKey)
    expect(conflict).toBe("newChat")
  })

  it("excludeAction skips the excluded action when checking", () => {
    const existingKey = DEFAULT_SHORTCUTS.newChat.defaultKey
    const conflict = useShortcutStore
      .getState()
      .hasConflict(existingKey, "newChat")
    expect(conflict).toBeNull()
  })

  it("finds conflict after a shortcut is updated", () => {
    useShortcutStore.getState().updateShortcut("focusInput", "Alt+N")
    const conflict = useShortcutStore.getState().hasConflict("Alt+N")
    expect(conflict).toBe("focusInput")
  })
})
