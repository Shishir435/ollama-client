import { fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ChatInputBox } from "@/features/chat/components/chat-input-box"
import { AgentComposerNoticeContext } from "@/features/chat/lib/agent-composer-notice"

const composer = vi.hoisted(() => ({
  focusRequest: 0,
  input: "",
  setInput: vi.fn()
}))

/*
 * The context sheet holds the chat instruction, which reads the session store.
 * Without this, mounting the sheet reaches SQLite through the persistence
 * client and the test logs an unhandled rejection it never asked for.
 */
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

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "chat.input.placeholder": "Type a message or ctrl + /"
      })[key] ?? key
  })
}))

vi.mock("@/features/chat/components/chat-input/chat-input-toolbar", () => ({
  ChatInputToolbar: ({ contextControls = true }) => (
    <div>toolbar{contextControls ? " context-menu" : ""}</div>
  )
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

vi.mock("@/features/chat/stores/chat-input-store", () => ({
  useChatInput: () => ({
    input: composer.input,
    setInput: composer.setInput,
    appendInput: vi.fn()
  }),
  useComposerUi: () => {
    const [promptLibraryOpen, setPromptLibraryOpen] = useState(false)
    const [attachmentSheetOpen, setAttachmentSheetOpen] = useState(false)
    const [focused, setFocused] = useState(false)
    return {
      promptLibraryOpen,
      attachmentSheetOpen,
      focused,
      focusRequest: composer.focusRequest,
      setPromptLibraryOpen,
      setAttachmentSheetOpen,
      setFocused
    }
  }
}))

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

vi.mock("@/features/tabs/hooks/use-tab-contents", () => ({
  useTabContents: () => ({ loadingIds: {} })
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

describe("ChatInputBox", () => {
  beforeEach(() => {
    vi.stubGlobal("chrome", {
      runtime: {
        connect: vi.fn(() => ({
          onMessage: {
            addListener: vi.fn(),
            removeListener: vi.fn()
          },
          disconnect: vi.fn()
        })),
        onMessage: {
          addListener: vi.fn(),
          removeListener: vi.fn()
        }
      }
    })
  })

  it("draws the agent line the shell supplies, and none without one", () => {
    const Notice = () => <p>agent readiness</p>
    const { unmount } = render(
      <AgentComposerNoticeContext.Provider value={Notice}>
        <ChatInputBox onSend={vi.fn()} stopGeneration={vi.fn()} />
      </AgentComposerNoticeContext.Provider>
    )
    expect(screen.getByText("agent readiness")).toBeInTheDocument()
    unmount()
    render(<ChatInputBox onSend={vi.fn()} stopGeneration={vi.fn()} />)
    expect(screen.queryByText("agent readiness")).not.toBeInTheDocument()
  })

  it("opens prompt sheet on ctrl slash", () => {
    render(<ChatInputBox onSend={vi.fn()} stopGeneration={vi.fn()} />)

    fireEvent.keyDown(
      screen.getByPlaceholderText("Type a message or ctrl + /"),
      {
        key: "/",
        ctrlKey: true
      }
    )

    expect(screen.getByText("Prompt sheet open")).toBeInTheDocument()
  })

  /**
   * Something outside the input — a run's card offering to ask about it —
   * has no ref to focus through, so it asks the store and the box answers.
   */
  it("takes the caret when something asks for it", () => {
    composer.focusRequest = 0
    const { rerender } = render(
      <ChatInputBox onSend={vi.fn()} stopGeneration={vi.fn()} />
    )
    const field = screen.getByPlaceholderText("Type a message or ctrl + /")
    field.blur()
    expect(document.activeElement).not.toBe(field)

    composer.focusRequest = 1
    rerender(<ChatInputBox onSend={vi.fn()} stopGeneration={vi.fn()} />)

    expect(document.activeElement).toBe(field)
  })
})
