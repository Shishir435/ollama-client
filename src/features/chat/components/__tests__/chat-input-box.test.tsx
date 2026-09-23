import { fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ChatInputBox } from "@/features/chat/components/chat-input-box"
import {
  type ChatComposerAlternateMode,
  ChatComposerModeContext
} from "@/features/chat/lib/composer-mode"

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
  PromptSelectorSheet: () => <div role="dialog">Prompt sheet open</div>
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

  describe("with an alternate mode lent by the shell", () => {
    const mode = (
      patch: Partial<ChatComposerAlternateMode> = {}
    ): ChatComposerAlternateMode => ({
      active: true,
      inputLabel: "What should Agent do?",
      placeholder: "Describe one browser task…",
      submitLabel: "Start Agent",
      preflight: <p>preflight</p>,
      canSubmit: (text) => text.length > 0,
      submit: vi.fn(),
      ...patch
    })
    const box = (value?: ChatComposerAlternateMode, onSend = vi.fn()) => (
      <ChatComposerModeContext.Provider value={value}>
        <ChatInputBox onSend={onSend} stopGeneration={vi.fn()} />
      </ChatComposerModeContext.Provider>
    )

    beforeEach(() => {
      composer.input = ""
      composer.setInput.mockClear()
    })

    it("sends the task, not a message, and clears the box", () => {
      composer.input = "  Close this issue "
      const alternate = mode()
      const onSend = vi.fn()
      render(box(alternate, onSend))

      fireEvent.keyDown(screen.getByLabelText("What should Agent do?"), {
        key: "Enter"
      })

      expect(alternate.submit).toHaveBeenCalledWith("Close this issue")
      expect(onSend).not.toHaveBeenCalled()
      expect(composer.setInput).toHaveBeenCalledWith("")
    })

    it("names the field, the placeholder and the send control for the mode", () => {
      composer.input = "Close this issue"
      render(box(mode()))

      expect(
        screen.getByPlaceholderText("Describe one browser task…")
      ).toBeInTheDocument()
      expect(screen.getByText("preflight")).toBeInTheDocument()
      fireEvent.click(screen.getByRole("button", { name: "Start Agent" }))
    })

    it("holds a submission the mode refuses", () => {
      composer.input = "Close this issue"
      const alternate = mode({ canSubmit: () => false })
      render(box(alternate))

      fireEvent.keyDown(screen.getByLabelText("What should Agent do?"), {
        key: "Enter"
      })

      expect(alternate.submit).not.toHaveBeenCalled()
      expect(screen.getByRole("button", { name: "Start Agent" })).toBeDisabled()
    })

    it("takes a prefill once per token", () => {
      const { rerender } = render(
        box(mode({ prefill: { text: "Try again", token: 1 } }))
      )
      expect(composer.setInput).toHaveBeenLastCalledWith("Try again")

      composer.setInput.mockClear()
      rerender(box(mode({ prefill: { text: "Try again", token: 1 } })))
      expect(composer.setInput).not.toHaveBeenCalled()
    })

    /**
     * A prefill is Act's. One requested while the box shows a chat draft
     * waits for Act instead of overwriting the message.
     */
    it("keeps a prefill out of the chat draft until Act is showing", () => {
      composer.input = "half a message"
      const prefill = { text: "Try again", token: 1 }
      const { rerender } = render(box(mode({ active: false, prefill })))
      expect(composer.setInput).not.toHaveBeenCalled()

      rerender(box(mode({ active: true, prefill })))
      expect(composer.setInput).toHaveBeenLastCalledWith("Try again")
    })

    /**
     * One draft per mode: the half-written message is still there on the
     * way back, and a goal never becomes a message by pressing the switch.
     */
    it("keeps the chat draft and the task draft apart", () => {
      composer.input = "half a message"
      const { rerender } = render(box(mode({ active: false })))

      rerender(box(mode({ active: true })))
      expect(composer.setInput).toHaveBeenLastCalledWith("")

      composer.input = "a goal"
      rerender(box(mode({ active: true })))
      rerender(box(mode({ active: false })))
      expect(composer.setInput).toHaveBeenLastCalledWith("half a message")

      rerender(box(mode({ active: true })))
      expect(composer.setInput).toHaveBeenLastCalledWith("a goal")
    })

    /**
     * A task is words: an attachment staged in Act would be dropped from the
     * goal without a word, then sent with the next chat message.
     */
    it("offers no attachments or context while sending a task", () => {
      render(box(mode()))

      expect(screen.getByText("toolbar")).toBeInTheDocument()
      expect(screen.queryByText(/context-menu/)).not.toBeInTheDocument()
      const field = screen.getByLabelText("What should Agent do?")
      const image = new File(["x"], "shot.png", { type: "image/png" })
      const pasted = fireEvent.paste(field, {
        clipboardData: { files: [image] }
      })
      expect(pasted).toBe(true)
    })

    /** Inactive is chat, exactly: the message path is the one that runs. */
    it("is the chat composer when the mode is inactive", () => {
      render(box(mode({ active: false })))

      expect(
        screen.getByPlaceholderText("Type a message or ctrl + /")
      ).toBeInTheDocument()
      expect(screen.queryByText("preflight")).not.toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: "Start Agent" })
      ).not.toBeInTheDocument()
    })
  })
})
