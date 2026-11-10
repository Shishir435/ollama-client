import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
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
import { handleSelectionMessage } from "@/background/handlers/handle-selection-messages"
import {
  registerSelectionBridgePort,
  unregisterSelectionBridgePort
} from "@/background/lib/selection-bridge"
import { chatInputStore } from "@/features/chat/stores/chat-input-store"
import {
  DEFAULT_CONTEXT_MENU_ID,
  MESSAGE_KEYS,
  STORAGE_KEYS
} from "@/lib/constants"
import type { ChromePort } from "@/types"
import { ChatInputBox } from "../chat-input-box"

const boundary = vi.hoisted(() => {
  type Watch = Record<string, (change: { newValue?: string }) => void>
  const values = new Map<string, any>()
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
    }),
    clearImages: vi.fn(),
    clearFiles: vi.fn(),
    addSession: vi.fn(),
    deleteSessionRow: vi.fn(),
    toast: vi.fn(),
    sessions: {
      sessions: [] as any[],
      currentSessionId: "existing",
      refreshSessions: vi.fn(async () => {}),
      setCurrentSessionId: vi.fn()
    }
  }
})

/*
 * The context sheet holds the chat instruction, which reads the session store.
 * Without this, mounting the sheet reaches SQLite through the persistence
 * client and the test logs an unhandled rejection it never asked for.
 */
vi.mock("@/features/sessions/stores/chat-session-store", () => ({
  chatSessionStore: { getState: () => boundary.sessions },
  useChatSessions: () => ({
    currentSessionId: undefined,
    sessions: [],
    setSessionSystemPrompt: vi.fn()
  })
}))

vi.mock("@/lib/browser-api", () => ({
  isChromiumBased: () => true,
  browser: {
    windows: { getCurrent: vi.fn(async () => ({ id: 7 })) },
    contextMenus: {
      create: vi.fn(),
      remove: vi.fn(async () => {}),
      onClicked: { addListener: boundary.addClickListener }
    },
    runtime: {
      sendMessage: boundary.sendMessage,
      connect: boundary.connect,
      onMessage: {
        addListener: (listener: (message: unknown) => void) =>
          boundary.messages.add(listener),
        removeListener: (listener: (message: unknown) => void) =>
          boundary.messages.delete(listener)
      }
    },
    sidePanel: { open: boundary.open }
  }
}))

vi.mock("@/lib/repositories/chat-history", () => ({
  addSession: boundary.addSession,
  deleteSessionRow: boundary.deleteSessionRow
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
  useToast: () => ({ toast: boundary.toast })
}))
vi.mock("@/features/chat/hooks/use-session-metrics-preference", () => ({
  useSessionMetricsPreference: () => [false, vi.fn()]
}))
vi.mock("@/features/chat/hooks/use-chat-input-attachments", () => ({
  useChatInputAttachments: () => ({
    processingStates: [],
    successfulFiles: [],
    images: [],
    visionUnsupported: true,
    clearImages: boundary.clearImages,
    clearAllProcessingStates: boundary.clearFiles
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
vi.mock("@/components/layout/composer-shell", () => ({
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
    vi.clearAllMocks()
    boundary.sessions.sessions = [
      {
        id: "existing",
        messages: [{ role: "user", content: "Existing conversation" }]
      }
    ]
    boundary.sessions.currentSessionId = "existing"
    boundary.sessions.setCurrentSessionId.mockImplementation((id: string) => {
      boundary.sessions.currentSessionId = id
    })
    boundary.addSession.mockImplementation(async (session: any) => {
      boundary.sessions.sessions.push(session)
    })
    boundary.deleteSessionRow.mockImplementation(async (id: string) => {
      boundary.sessions.sessions = boundary.sessions.sessions.filter(
        (session) => session.id !== id
      )
    })
    vi.useFakeTimers()
    boundary.values.clear()
    boundary.watches.clear()
    boundary.messages.clear()
    chatInputStore.setState({
      input: "",
      focused: false,
      selectionHandoffIds: []
    })
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

  it("opens a fresh chat once without sending or modifying the previous conversation", async () => {
    chatInputStore.setState({
      input: "Unrelated draft",
      pendingChatSend: "Old queued send"
    })
    const composer = await openComposer()
    const response = vi.fn()
    await act(async () => {
      handleSelectionMessage(
        {
          type: MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT,
          payload: {
            text: "Selected text\n\n---\n\nGenerated result",
            destination: "new-chat"
          }
        },
        tab,
        response
      )
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(response).toHaveBeenCalledWith({ success: true })
    expect(boundary.addSession).toHaveBeenCalledOnce()
    expect(boundary.sessions.setCurrentSessionId).toHaveBeenCalledOnce()
    expect(boundary.sessions.currentSessionId).not.toBe("existing")
    expect(boundary.sessions.sessions[0].messages).toEqual([
      { role: "user", content: "Existing conversation" }
    ])
    expect(composer).toHaveValue("> Selected text\n\n---\n\nGenerated result")
    expect(composer).toHaveFocus()
    expect(chatInputStore.getState().pendingChatSend).toBeUndefined()
    expect(boundary.clearImages).toHaveBeenCalledOnce()
    expect(boundary.values.has(pendingKey)).toBe(false)
    expect(onSend).not.toHaveBeenCalled()
  })

  it("keeps a new-chat handoff for a cold sidebar to consume", async () => {
    const response = vi.fn()
    handleSelectionMessage(
      {
        type: MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT,
        payload: { text: "Selected text", destination: "new-chat" }
      },
      tab,
      response
    )
    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(boundary.values.get(pendingKey)).toMatchObject({
      text: "Selected text",
      windowId: 7
    })
    expect(await openComposer()).toHaveValue("> Selected text\n")
    expect(boundary.sessions.setCurrentSessionId).toHaveBeenCalledOnce()
    expect(boundary.values.has(pendingKey)).toBe(false)
  })

  it("leaves another window's handoff untouched", async () => {
    const pending = {
      text: "Other window",
      sessionId: "11111111-1111-4111-8111-111111111111",
      windowId: 9
    }
    boundary.values.set(pendingKey, pending)
    chatInputStore.setState({ input: "Current draft" })
    expect(await openComposer()).toHaveValue("Current draft")
    expect(boundary.sessions.setCurrentSessionId).not.toHaveBeenCalled()
    expect(boundary.values.get(pendingKey)).toEqual(pending)
  })

  it("discards a handoff whose session was deleted, without repeating the error on remount", async () => {
    boundary.values.set(pendingKey, {
      text: "Deleted selection",
      sessionId: "11111111-1111-4111-8111-111111111111",
      windowId: 7
    })
    chatInputStore.setState({ input: "Current draft" })
    expect(await openComposer()).toHaveValue("Current draft")
    expect(boundary.values.has(pendingKey)).toBe(false)
    expect(boundary.toast).toHaveBeenCalledOnce()
    cleanup()
    expect(await openComposer()).toHaveValue("Current draft")
    expect(boundary.toast).toHaveBeenCalledOnce()
  })

  it("keeps a handoff after a transient session refresh failure", async () => {
    const pending = {
      text: "Retry selection",
      sessionId: "11111111-1111-4111-8111-111111111111",
      windowId: 7
    }
    boundary.values.set(pendingKey, pending)
    boundary.sessions.refreshSessions.mockRejectedValueOnce(
      new Error("Unavailable")
    )
    await openComposer()
    expect(boundary.values.get(pendingKey)).toEqual(pending)
    cleanup()
    boundary.sessions.sessions.push({ id: pending.sessionId })
    expect(await openComposer()).toHaveValue("> Retry selection\n")
    expect(boundary.values.has(pendingKey)).toBe(false)
  })

  it("reports session creation failure without staging or modifying chat", async () => {
    boundary.addSession.mockRejectedValueOnce(new Error("Unavailable"))
    const response = vi.fn()
    handleSelectionMessage(
      {
        type: MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT,
        payload: { text: "Selected text", destination: "new-chat" }
      },
      tab,
      response
    )
    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(response).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    )
    expect(boundary.values.has(pendingKey)).toBe(false)
    expect(boundary.sessions.currentSessionId).toBe("existing")
  })

  it("rolls back the new session when staging its handoff fails", async () => {
    boundary.storage.set.mockRejectedValueOnce(
      new Error("Storage quota exceeded")
    )
    const response = vi.fn()
    handleSelectionMessage(
      {
        type: MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT,
        payload: { text: "Selection", destination: "new-chat" }
      },
      tab,
      response
    )
    await act(async () => vi.advanceTimersByTimeAsync(0))
    const id = boundary.addSession.mock.calls[0][0].id
    expect(boundary.deleteSessionRow).toHaveBeenCalledWith(id)
    expect(boundary.sessions.sessions.map((session) => session.id)).toEqual([
      "existing"
    ])
    expect(response).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    )
    expect(boundary.values.has(pendingKey)).toBe(false)
    expect(boundary.sessions.setCurrentSessionId).not.toHaveBeenCalled()
  })

  it("does not overwrite a new draft when pending-handoff cleanup fails", async () => {
    const composer = await openComposer()
    boundary.storage.remove.mockRejectedValueOnce(
      new Error("Storage unavailable")
    )
    await act(async () => {
      handleSelectionMessage(
        {
          type: MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT,
          payload: { text: "Selection", destination: "new-chat" }
        },
        tab,
        vi.fn()
      )
      await vi.advanceTimersByTimeAsync(0)
    })
    fireEvent.change(composer, { target: { value: "User edited this draft" } })
    await act(async () =>
      boundary.sendMessage({
        type: MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT,
        payload: boundary.values.get(pendingKey),
        fromBackground: true
      })
    )
    expect(composer).toHaveValue("User edited this draft")
    expect(boundary.sessions.setCurrentSessionId).toHaveBeenCalledOnce()
    expect(boundary.toast).not.toHaveBeenCalled()
    cleanup()
    boundary.sessions.currentSessionId = "existing"
    expect(await openComposer()).toHaveValue("User edited this draft")
    expect(boundary.sessions.setCurrentSessionId).toHaveBeenCalledOnce()
    expect(boundary.toast).not.toHaveBeenCalled()
  })
})
