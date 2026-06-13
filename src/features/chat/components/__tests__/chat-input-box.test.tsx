import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ChatInputBox } from "@/features/chat/components/chat-input-box"

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
  ChatInputToolbar: () => <div>toolbar</div>
}))

vi.mock("@/features/chat/components/chat-input/composer-shell", () => ({
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
    input: "",
    setInput: vi.fn(),
    appendInput: vi.fn()
  })
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
})
