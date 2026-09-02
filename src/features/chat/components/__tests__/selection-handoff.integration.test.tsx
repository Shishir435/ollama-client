import { act, cleanup, render, screen } from "@testing-library/react"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest"
import { initializeContextMenu } from "@/background/handlers/handle-context-menu"
import {
  registerSelectionBridgePort,
  unregisterSelectionBridgePort
} from "@/background/lib/selection-bridge"
import { chatInputStore } from "@/features/chat/stores/chat-input-store"
import { DEFAULT_CONTEXT_MENU_ID, STORAGE_KEYS } from "@/lib/constants"
import type { ChromePort } from "@/types"
import { ChatInputBox } from "../chat-input-box"

const boundary = vi.hoisted(() => {
  type Watch = Record<string, (change: { newValue?: string }) => void>
  const values = new Map<string, string>()
  const watches = new Set<Watch>()
  const messages = new Set<(message: unknown) => void>()
  const storage = {
    get: vi.fn(async (key: string) => values.get(key)),
    set: vi.fn(async (key: string, value: string) => {
      values.set(key, value)
      for (const watch of watches) watch[key]?.({ newValue: value })
    }),
    remove: vi.fn(async (key: string) => {
      values.delete(key)
      for (const watch of watches) watch[key]?.({})
    }),
    watch: vi.fn((watch: Watch) => watches.add(watch)),
    unwatch: vi.fn((watch: Watch) => watches.delete(watch))
  }
  return {
    values,
    watches,
    messages,
    storage,
    addClickListener: vi.fn(),
    open: vi.fn(async () => {}),
    connect: vi.fn(),
    sendMessage: vi.fn(async (message: unknown) => {
      for (const listener of messages) listener(message)
    })
  }
})

vi.mock("@/lib/browser-api", () => ({
  browser: {
    contextMenus: {
      create: vi.fn(),
      remove: vi.fn(async () => {}),
      onClicked: { addListener: boundary.addClickListener }
    },
    runtime: { sendMessage: boundary.sendMessage },
    sidePanel: { open: boundary.open }
  }
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStorageForKey: () => boundary.storage,
  setPlasmoStoredValue: (key: string, value: string) =>
    boundary.storage.set(key, value)
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock("@/hooks/use-setting", () => ({
  useSetting: () => [false, vi.fn()]
}))
vi.mock("@/hooks/use-auto-resize-textarea", () => ({
  useAutoResizeTextarea: vi.fn()
}))
vi.mock("@/hooks/use-keyboard-shortcuts", () => ({
  useKeyboardShortcuts: vi.fn()
}))
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() })
}))
vi.mock("@/features/chat/hooks/use-session-metrics-preference", () => ({
  useSessionMetricsPreference: () => [false, vi.fn()]
}))
vi.mock("@/features/chat/hooks/use-chat-input-attachments", () => ({
  useChatInputAttachments: () => ({
    processingStates: [],
    successfulFiles: [],
    images: [],
    visionUnsupported: true
  })
}))
vi.mock("@/features/chat/stores/load-stream-store", () => ({
  useLoadStream: () => ({ isLoading: false })
}))
vi.mock("@/features/tabs/hooks/use-tab-contents", () => ({
  useTabContents: () => ({ loadingIds: {} })
}))
vi.mock("@/features/tabs/stores/selected-tabs-store", () => ({
  useSelectedTabs: () => ({ selectedTabIds: [] })
}))
vi.mock("@/features/chat/components/chat-input/chat-input-toolbar", () => ({
  ChatInputToolbar: () => null
}))
vi.mock("@/features/chat/components/chat-input/composer-shell", () => ({
  ComposerShell: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  )
}))
vi.mock("@/features/chat/components/send-or-stop-button", () => ({
  SendOrStopButton: () => null
}))
vi.mock("@/features/prompt/components/prompt-selector-sheet", () => ({
  PromptSelectorSheet: () => null
}))

/** Exercise the real handler, bridge, composer and store across browser API doubles. */
describe("context-menu selection handoff", () => {
  let click: (
    info: { menuItemId: string; selectionText?: string },
    tab: { id: number; windowId: number }
  ) => Promise<void> | undefined
  const tab = { id: 42, windowId: 7 }
  const pendingKey = STORAGE_KEYS.BROWSER.PENDING_SELECTION_TEXT
  const onSend = vi.fn()

  beforeAll(() => {
    initializeContextMenu()
    click = boundary.addClickListener.mock.calls[0][0]
  })

  beforeEach(() => {
    vi.useFakeTimers()
    boundary.values.clear()
    boundary.watches.clear()
    boundary.messages.clear()
    chatInputStore.setState({ input: "", focused: false })
    boundary.connect.mockImplementation(({ name }: { name: string }) => {
      type Message = Parameters<ChromePort["postMessage"]>[0]
      const listeners = new Set<(message: Message) => void>()
      const port: ChromePort = {
        name,
        postMessage: (message) => {
          for (const listener of listeners) listener(message)
        },
        onMessage: {
          addListener: (listener) => {
            listeners.add(listener)
          },
          removeListener: (listener) => {
            listeners.delete(listener)
          },
          hasListener: (listener) => listeners.has(listener)
        },
        onDisconnect: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
          hasListener: vi.fn()
        },
        disconnect: () => unregisterSelectionBridgePort(port)
      }
      registerSelectionBridgePort(port)
      return port
    })
    vi.stubGlobal("chrome", {
      sidePanel: { open: boundary.open },
      runtime: {
        connect: boundary.connect,
        onMessage: {
          addListener: (listener: (message: unknown) => void) =>
            boundary.messages.add(listener),
          removeListener: (listener: (message: unknown) => void) =>
            boundary.messages.delete(listener)
        }
      }
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const openComposer = async () => {
    await act(async () => {
      render(<ChatInputBox onSend={onSend} stopGeneration={vi.fn()} />)
    })
    return screen.getByRole("textbox")
  }

  it("opens synchronously, then consumes a selection when the sidebar mounts", async () => {
    const delivery = click(
      {
        menuItemId: DEFAULT_CONTEXT_MENU_ID,
        selectionText: "First line\nSecond line"
      },
      tab
    )

    // Assert before awaiting: opening must retain the context-menu user gesture.
    expect(boundary.open).toHaveBeenCalledWith({ windowId: 7, tabId: 42 })
    expect(boundary.open.mock.invocationCallOrder[0]).toBeLessThan(
      boundary.storage.set.mock.invocationCallOrder[0]
    )
    await delivery
    expect(boundary.values.get(pendingKey)).toBe("First line\nSecond line")

    const composer = await openComposer()
    expect(composer).toHaveValue("> First line\n> Second line\n")
    expect(composer).toHaveFocus()
    expect(boundary.values.has(pendingKey)).toBe(false)

    // The delayed bridge retry must not insert the quote a second time.
    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(composer).toHaveValue("> First line\n> Second line\n")
    expect(onSend).not.toHaveBeenCalled()

    cleanup()
    chatInputStore.setState({ input: "" })
    expect(await openComposer()).toHaveValue("")
  })

  it("appends once to an open composer despite storage, port and runtime delivery", async () => {
    chatInputStore.setState({ input: "Explain this:\n" })
    const composer = await openComposer()

    await act(async () => {
      await click(
        {
          menuItemId: DEFAULT_CONTEXT_MENU_ID,
          selectionText: "  Highlighted text  "
        },
        tab
      )
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(composer).toHaveValue("Explain this:\n> Highlighted text\n")
    expect(boundary.values.has(pendingKey)).toBe(false)
    expect(onSend).not.toHaveBeenCalled()
  })

  it("does not stage text for an unrelated menu action or an empty selection", async () => {
    await click(
      { menuItemId: "another-menu", selectionText: "Private text" },
      tab
    )
    await click({ menuItemId: DEFAULT_CONTEXT_MENU_ID, selectionText: "" }, tab)

    expect(boundary.open).not.toHaveBeenCalled()
    expect(boundary.storage.set).not.toHaveBeenCalled()
    expect(boundary.sendMessage).not.toHaveBeenCalled()
    expect(await openComposer()).toHaveValue("")
  })
})
