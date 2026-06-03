import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useChatKeyboardShortcuts } from "../use-chat-keyboard-shortcuts"

// Capture shortcut handlers so we can call them directly in tests
type ShortcutHandlers = Record<string, (e: Partial<KeyboardEvent>) => void>
let capturedHandlers: ShortcutHandlers = {}

// vi.hoisted ensures these are initialized before vi.mock factory runs
const mocks = vi.hoisted(() => ({
  toggleSpeech: vi.fn(),
  toast: vi.fn(),
  exportSessionAsJson: vi.fn(),
  exportSessionAsMarkdown: vi.fn(),
  exportSessionAsPdf: vi.fn(),
  exportSessionAsText: vi.fn(),
  openOptionsInTab: vi.fn(),
  openSearchDialog: vi.fn(),
  setTheme: vi.fn()
}))

vi.mock("@/hooks/use-keyboard-shortcuts", () => ({
  useKeyboardShortcuts: vi.fn((handlers: ShortcutHandlers) => {
    capturedHandlers = handlers
  })
}))

vi.mock("@/features/chat/hooks/use-speech-synthesis", () => ({
  useSpeechSynthesis: () => ({ toggle: mocks.toggleSpeech })
}))

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast })
}))

vi.mock("@/features/sessions/stores/chat-session-store", () => ({
  useChatSessions: () => ({
    sessions: [
      { id: "s1", title: "Session 1", messages: [] },
      { id: "s2", title: "Session 2", messages: [] }
    ]
  })
}))

vi.mock("@/features/sessions/hooks/use-export-chat", () => ({
  useChatExport: () => ({
    exportSessionAsJson: mocks.exportSessionAsJson,
    exportSessionAsMarkdown: mocks.exportSessionAsMarkdown,
    exportSessionAsPdf: mocks.exportSessionAsPdf,
    exportSessionAsText: mocks.exportSessionAsText
  })
}))

vi.mock("@/lib/browser-api", () => ({
  browser: {},
  openOptionsInTab: mocks.openOptionsInTab,
  isChromiumBased: vi.fn(() => true)
}))

vi.mock("@/stores/search-dialog-store", () => ({
  useSearchDialogStore: {
    getState: () => ({ openSearchDialog: mocks.openSearchDialog })
  }
}))

vi.mock("@/stores/theme", () => ({
  useThemeStore: {
    getState: () => ({ theme: "dark", setTheme: mocks.setTheme })
  }
}))

const fakeEvent = (): Partial<KeyboardEvent> => ({ preventDefault: vi.fn() })

const sessions = [
  { id: "s1", title: "Session 1", messages: [] },
  { id: "s2", title: "Session 2", messages: [] }
]

const messages = [
  { role: "user" as const, content: "Hello" },
  { role: "assistant" as const, content: "Hi there", done: true }
]

const mockCreateSession = vi.fn().mockResolvedValue("new-session-id")
const mockDeleteSession = vi.fn()

const renderShortcuts = (
  overrides: Partial<Parameters<typeof useChatKeyboardShortcuts>[0]> = {}
) =>
  renderHook(() =>
    useChatKeyboardShortcuts({
      messages,
      currentSessionId: "s1",
      createSession: mockCreateSession,
      deleteSession: mockDeleteSession,
      ...overrides
    })
  )

describe("useChatKeyboardShortcuts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedHandlers = {}
  })

  it("registers all expected shortcut handlers", () => {
    renderShortcuts()
    expect(capturedHandlers).toHaveProperty("newChat")
    expect(capturedHandlers).toHaveProperty("settings")
    expect(capturedHandlers).toHaveProperty("toggleTheme")
    expect(capturedHandlers).toHaveProperty("toggleSpeech")
    expect(capturedHandlers).toHaveProperty("searchMessages")
    expect(capturedHandlers).toHaveProperty("clearChat")
    expect(capturedHandlers).toHaveProperty("copyLastResponse")
    expect(capturedHandlers).toHaveProperty("exportJson")
    expect(capturedHandlers).toHaveProperty("exportMarkdown")
    expect(capturedHandlers).toHaveProperty("exportPdf")
    expect(capturedHandlers).toHaveProperty("exportText")
  })

  it("newChat: calls createSession and shows toast", async () => {
    renderShortcuts()
    await capturedHandlers.newChat(fakeEvent())
    expect(mockCreateSession).toHaveBeenCalledOnce()
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining("new chat")
      })
    )
  })

  it("settings: calls openOptionsInTab", () => {
    renderShortcuts()
    capturedHandlers.settings(fakeEvent())
    expect(mocks.openOptionsInTab).toHaveBeenCalledOnce()
  })

  it("toggleTheme: switches from dark to light and shows toast", () => {
    renderShortcuts()
    capturedHandlers.toggleTheme(fakeEvent())
    expect(mocks.setTheme).toHaveBeenCalledWith("light")
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining("light") })
    )
  })

  it("toggleSpeech: passes last assistant message to toggle()", () => {
    renderShortcuts()
    capturedHandlers.toggleSpeech(fakeEvent())
    expect(mocks.toggleSpeech).toHaveBeenCalledWith("Hi there")
  })

  it("toggleSpeech: no-op when no assistant message exists", () => {
    renderShortcuts({
      messages: [{ role: "user", content: "question only" }]
    })
    capturedHandlers.toggleSpeech(fakeEvent())
    expect(mocks.toggleSpeech).not.toHaveBeenCalled()
  })

  it("searchMessages: opens search dialog", () => {
    renderShortcuts()
    capturedHandlers.searchMessages(fakeEvent())
    expect(mocks.openSearchDialog).toHaveBeenCalledOnce()
  })

  it("copyLastResponse: writes last assistant message to clipboard", async () => {
    const mockWriteText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: mockWriteText },
      configurable: true
    })

    renderShortcuts()
    await capturedHandlers.copyLastResponse(fakeEvent())

    expect(mockWriteText).toHaveBeenCalledWith("Hi there")
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining("Copied")
      })
    )
  })

  it("copyLastResponse: no-op when no assistant message", async () => {
    const mockWriteText = vi.fn()
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: mockWriteText },
      configurable: true
    })

    renderShortcuts({ messages: [{ role: "user", content: "question only" }] })
    await capturedHandlers.copyLastResponse(fakeEvent())

    expect(mockWriteText).not.toHaveBeenCalled()
  })

  it("exportJson: exports session and shows toast", () => {
    renderShortcuts()
    capturedHandlers.exportJson(fakeEvent())
    expect(mocks.exportSessionAsJson).toHaveBeenCalledWith(sessions[0])
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining("JSON") })
    )
  })

  it("exportMarkdown: exports session as markdown", () => {
    renderShortcuts()
    capturedHandlers.exportMarkdown(fakeEvent())
    expect(mocks.exportSessionAsMarkdown).toHaveBeenCalledWith(sessions[0])
  })

  it("exportPdf: exports session as PDF", () => {
    renderShortcuts()
    capturedHandlers.exportPdf(fakeEvent())
    expect(mocks.exportSessionAsPdf).toHaveBeenCalledWith(sessions[0])
  })

  it("exportText: exports session as plain text", () => {
    renderShortcuts()
    capturedHandlers.exportText(fakeEvent())
    expect(mocks.exportSessionAsText).toHaveBeenCalledWith(sessions[0])
  })

  it("export: no-op when currentSessionId matches no session", () => {
    renderShortcuts({ currentSessionId: "nonexistent" })
    capturedHandlers.exportJson(fakeEvent())
    expect(mocks.exportSessionAsJson).not.toHaveBeenCalled()
  })

  it("clearChat: deletes and recreates session after user confirms", async () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true)
    )

    renderShortcuts()
    await capturedHandlers.clearChat(fakeEvent())

    expect(mockDeleteSession).toHaveBeenCalledWith("s1")
    expect(mockCreateSession).toHaveBeenCalledOnce()
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining("cleared")
      })
    )

    vi.unstubAllGlobals()
  })

  it("clearChat: no-op when user dismisses confirm dialog", async () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => false)
    )

    renderShortcuts()
    await capturedHandlers.clearChat(fakeEvent())

    expect(mockDeleteSession).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })
})
