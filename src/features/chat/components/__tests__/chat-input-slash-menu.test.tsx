import { act, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ChatInputBox } from "@/features/chat/components/chat-input-box"

const store = vi.hoisted(() => ({
  input: "",
  listeners: new Set<() => void>(),
  set(value: string) {
    store.input = value
    for (const listener of store.listeners) listener()
  },
  subscribe(listener: () => void) {
    store.listeners.add(listener)
    return () => store.listeners.delete(listener)
  },
  incrementUsageCount: vi.fn(),
  templatesLoading: false
}))

vi.mock("@/features/chat/hooks/use-selection-handoff", () => ({
  useSelectionHandoff: vi.fn()
}))
vi.mock("@/features/sessions/stores/chat-session-store", () => ({
  useChatSessions: () => ({
    currentSessionId: undefined,
    sessions: [],
    setSessionSystemPrompt: vi.fn()
  })
}))
vi.mock("@plasmohq/storage/hook", () => ({
  useStorage: () => [false, vi.fn()]
}))
vi.mock("react-i18next", () => {
  const t = (key: string) =>
    key === "chat.input.placeholder" ? "Ask anything" : key
  return { useTranslation: () => ({ t }) }
})
vi.mock("@/features/chat/components/chat-input/chat-input-toolbar", () => ({
  ChatInputToolbar: () => <div>toolbar</div>
}))
vi.mock("@/components/layout/composer-shell", () => ({
  ComposerShell: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  )
}))
vi.mock("@/features/chat/components/send-or-stop-button", () => ({
  SendOrStopButton: () => <button type="button">send</button>
}))
vi.mock("@/features/chat/hooks/use-session-metrics-preference", () => ({
  useSessionMetricsPreference: () => [false, vi.fn()]
}))
vi.mock("@/features/chat/stores/chat-input-store", async () => {
  const { useSyncExternalStore } = await import("react")
  return {
    chatInputStore: { getState: () => ({ input: store.input }) },
    useChatInput: () => ({
      input: useSyncExternalStore(store.subscribe, () => store.input),
      setInput: store.set,
      appendInput: vi.fn()
    }),
    useComposerUi: () => {
      const [promptLibraryOpen, setPromptLibraryOpen] = useState(false)
      const [focused, setFocused] = useState(false)
      return {
        promptLibraryOpen,
        focused,
        focusRequest: 0,
        setPromptLibraryOpen,
        setFocused
      }
    }
  }
})
vi.mock("@/features/chat/stores/load-stream-store", () => ({
  useLoadStream: () => ({ isLoading: false })
}))
vi.mock("@/features/file-upload/hooks/use-file-upload", () => ({
  useFileUpload: () => ({
    processFiles: vi.fn(),
    processingStates: [],
    clearProcessingState: vi.fn(),
    clearAllProcessingStates: vi.fn()
  })
}))
vi.mock("@/features/model/hooks/use-selected-model-capabilities", () => ({
  useSelectedModelCapabilities: () => ({
    capabilities: null,
    isResolving: false
  })
}))
vi.mock("@/features/chat/hooks/use-image-attachments", () => ({
  useImageAttachments: () => ({
    images: [],
    addFiles: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn()
  })
}))
vi.mock("@/features/prompt/components/prompt-selector-sheet", () => ({
  PromptSelectorSheet: () => <dialog open>Prompt sheet open</dialog>
}))
vi.mock("@/features/prompt/hooks/use-prompt-templates", () => ({
  usePromptTemplates: () => ({
    isLoading: store.templatesLoading,
    templates: store.templatesLoading
      ? []
      : [
          {
            id: "sum",
            title: "Summarize",
            userPrompt: "Summarize this:",
            usageCount: 5
          },
          {
            id: "tr",
            title: "Translate",
            userPrompt: "Translate to French:",
            usageCount: 1
          },
          {
            id: "sel",
            title: "Selection helper",
            userPrompt: "About {{selection}}",
            usageCount: 0
          }
        ],
    incrementUsageCount: store.incrementUsageCount
  })
}))
vi.mock("@/features/tabs/hooks/use-tab-contents", () => ({
  useTabContents: () => ({ loadingIds: {}, tabContents: {} })
}))
vi.mock("@/features/tabs/stores/selected-tabs-store", () => ({
  useSelectedTabs: () => ({ selectedTabIds: [] })
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

const field = () =>
  screen.getByPlaceholderText("Ask anything") as HTMLTextAreaElement

/** Types like a user: the DOM value and caret move together, then change fires. */
const type = (value: string, caret = value.length) => {
  const el = field()
  fireEvent.change(el, { target: { value } })
  el.setSelectionRange(caret, caret)
  fireEvent.select(el)
}

const optionTitles = () =>
  screen.queryAllByRole("option").map((option) => option.textContent ?? "")

describe("composer slash menu", () => {
  const onSend = vi.fn()

  beforeEach(() => {
    store.input = ""
    store.incrementUsageCount.mockReset()
    store.templatesLoading = false
    onSend.mockReset()
    vi.stubGlobal("chrome", {
      runtime: {
        connect: vi.fn(() => ({
          onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
          disconnect: vi.fn()
        })),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() }
      }
    })
    render(<ChatInputBox onSend={onSend} stopGeneration={vi.fn()} />)
  })

  afterEach(async () => {
    /** The caret is restored on the next frame; let it land inside act. */
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
  })

  it("opens at a slash typed at the start, most used first", () => {
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()

    type("/")

    expect(screen.getByRole("listbox")).toBeInTheDocument()
    expect(optionTitles()[0]).toContain("Summarize")
    expect(optionTitles()).toHaveLength(3)
    expect(field()).toHaveAttribute("aria-expanded", "true")
  })

  it("filters as the query grows and closes when nothing matches", () => {
    type("/tra")
    expect(optionTitles()).toHaveLength(1)
    expect(optionTitles()[0]).toContain("Translate")

    type("/zzz")
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })

  it("does not open for a slash in the middle of a word or line", () => {
    type("and/or")
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
    type("see https://example.com")
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
    type("one two /sum")
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })

  it("opens at the start of a later line", () => {
    type("first line\n/")
    expect(screen.getByRole("listbox")).toBeInTheDocument()
  })

  it("does not open inside a code block", () => {
    type("```\nconst a = 1\n/")
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })

  it("moves the highlight with the arrow keys and wraps around", () => {
    type("/")
    const selected = () =>
      screen
        .getAllByRole("option")
        .findIndex((option) => option.getAttribute("aria-selected") === "true")
    expect(selected()).toBe(0)

    fireEvent.keyDown(field(), { key: "ArrowDown" })
    expect(selected()).toBe(1)
    fireEvent.keyDown(field(), { key: "ArrowUp" })
    fireEvent.keyDown(field(), { key: "ArrowUp" })
    expect(selected()).toBe(2)
    fireEvent.keyDown(field(), { key: "ArrowDown" })
    expect(selected()).toBe(0)
    expect(field().getAttribute("aria-activedescendant")).toBe(
      screen.getAllByRole("option")[0].id
    )
  })

  it("inserts the highlighted template on Enter and does not send", async () => {
    type("/")
    fireEvent.keyDown(field(), { key: "ArrowDown" })

    await act(async () => {
      fireEvent.keyDown(field(), { key: "Enter" })
    })

    expect(store.input).toBe("Translate to French:")
    expect(onSend).not.toHaveBeenCalled()
    expect(store.incrementUsageCount).toHaveBeenCalledWith("tr")
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })

  it("keeps Shift+Enter a newline while the menu is open", () => {
    type("/")
    fireEvent.keyDown(field(), { key: "Enter", shiftKey: true })

    expect(store.input).toBe("/")
    expect(store.incrementUsageCount).not.toHaveBeenCalled()
  })

  it("does not send a slash token while templates are still loading", async () => {
    store.templatesLoading = true
    type("/sum")
    await act(async () => {
      fireEvent.keyDown(field(), { key: "Enter" })
    })

    expect(onSend).not.toHaveBeenCalled()
    expect(store.input).toBe("/sum")
  })

  it("leaves a token the user kept typing into while the template resolved", async () => {
    type("/Sel")
    fireEvent.keyDown(field(), { key: "Enter" })
    type("/Selx")

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    expect(store.input).toBe("/Selx")
    expect(store.incrementUsageCount).not.toHaveBeenCalled()
  })

  it("inserts on Tab as well, and on a click", async () => {
    type("/sum")
    await act(async () => {
      fireEvent.keyDown(field(), { key: "Tab" })
    })
    expect(store.input).toBe("Summarize this:")

    type("/")
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: /Translate/ }))
    })
    expect(store.input).toBe("Translate to French:")
  })

  it("keeps the lines around the token", async () => {
    type("intro\n/sum", 10)
    await act(async () => {
      fireEvent.keyDown(field(), { key: "Enter" })
    })
    expect(store.input).toBe("intro\nSummarize this:")
  })

  it("closes on Escape, leaves the text, and lets Enter send", () => {
    type("/sum")
    fireEvent.keyDown(field(), { key: "Escape" })

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
    expect(store.input).toBe("/sum")

    fireEvent.keyDown(field(), { key: "Enter" })
    expect(onSend).toHaveBeenCalledOnce()
  })

  it("stays closed while the same slash is edited, and reopens for a new one", () => {
    type("/s")
    fireEvent.keyDown(field(), { key: "Escape" })
    type("/su")
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()

    type("")
    type("/")
    expect(screen.getByRole("listbox")).toBeInTheDocument()
  })

  it("ignores Enter, Tab and arrows while an IME candidate is being composed", async () => {
    type("/")
    const before = optionTitles()

    await act(async () => {
      fireEvent.keyDown(field(), { key: "Enter", isComposing: true })
      fireEvent.keyDown(field(), { key: "Enter", keyCode: 229 })
      fireEvent.keyDown(field(), { key: "Tab", isComposing: true })
      fireEvent.keyDown(field(), { key: "ArrowDown", isComposing: true })
    })

    expect(store.input).toBe("/")
    expect(onSend).not.toHaveBeenCalled()
    expect(optionTitles()).toEqual(before)
    expect(screen.getAllByRole("option")[0]).toHaveAttribute(
      "aria-selected",
      "true"
    )
  })

  it("does nothing if the token was edited away while the template resolved", async () => {
    type("/sum")
    const pending = act(async () => {
      fireEvent.keyDown(field(), { key: "Enter" })
      store.set("something else entirely")
    })
    await pending

    expect(store.input).toBe("something else entirely")
  })
})
