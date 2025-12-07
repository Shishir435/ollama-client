import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { Textarea } from "@/components/ui/textarea"
import { ChatInputAttachmentList } from "@/features/chat/components/chat-input/chat-input-attachment-list"
import { ChatInputDragOverlay } from "@/features/chat/components/chat-input/chat-input-drag-overlay"
import { ChatInputToolbar } from "@/features/chat/components/chat-input/chat-input-toolbar"
import { SendOrStopButton } from "@/features/chat/components/send-or-stop-button"
import { SessionMetricsBar } from "@/features/chat/components/session-metrics-bar"
import { useSessionMetricsPreference } from "@/features/chat/hooks/use-session-metrics-preference"
import { useChatInput } from "@/features/chat/stores/chat-input-store"
import { useLoadStream } from "@/features/chat/stores/load-stream-store"
import { useFileUpload } from "@/features/file-upload/hooks/use-file-upload"

import { PromptSelectorDialog } from "@/features/prompt/components/prompt-selector-dialog"
import { TabsSelect } from "@/features/tabs/components/tabs-select"

import { useAutoResizeTextarea } from "@/hooks/use-auto-resize-textarea"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"
import type { ProcessedFile } from "@/lib/file-processors/types"

import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { cn } from "@/lib/utils"
import type { ChatMessage, ChromeMessage } from "@/types"

export const ChatInputBox = ({
  messages,
  onSend,
  stopGeneration
}: {
  messages: ChatMessage[]
  onSend: (
    customInput?: string,
    customModel?: string,
    files?: ProcessedFile[]
  ) => void
  stopGeneration: () => void
}) => {
  const { t } = useTranslation()
  const { input, setInput, appendInput } = useChatInput()
  const { isLoading } = useLoadStream()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const selectionStartRef = useRef<number | null>(null)
  const selectionEndRef = useRef<number | null>(null)
  const [showPromptOverlay, setShowPromptOverlay] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [showSessionMetrics, setShowSessionMetrics] =
    useSessionMetricsPreference()

  const {
    processFiles,
    processingStates,
    clearProcessingState,
    clearAllProcessingStates
  } = useFileUpload({
    onError: (error) => {
      console.error("File processing error:", error)
    }
  })

  const [useRAG, setUseRAG] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.EMBEDDINGS.USE_RAG,
      instance: plasmoGlobalStorage
    },
    true
  )

  const [tabAccess, setTabAccess] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.BROWSER.TABS_ACCESS,
      instance: plasmoGlobalStorage
    },
    false
  )

  useKeyboardShortcuts({
    focusInput: (e) => {
      e.preventDefault()
      textareaRef.current?.focus()
    },
    stopGeneration: (e) => {
      e.preventDefault()
      stopGeneration()
    },
    toggleRAG: (e) => {
      e.preventDefault()
      setUseRAG(!useRAG)
    },
    toggleTabs: (e) => {
      e.preventDefault()
      setTabAccess(!tabAccess)
    },
    toggleSessionMetrics: (e) => {
      e.preventDefault()
      setShowSessionMetrics(!showSessionMetrics)
    }
  })

  useAutoResizeTextarea(textareaRef, input)

  const updateSelection = () => {
    if (textareaRef.current) {
      selectionStartRef.current = textareaRef.current.selectionStart
      selectionEndRef.current = textareaRef.current.selectionEnd
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "/" && e.ctrlKey) {
      e.preventDefault()
      updateSelection()
      setShowPromptOverlay(true)
    }

    if (e.key === "Escape") {
      setShowPromptOverlay(false)
    }

    if (e.key === "Enter" && !e.shiftKey && !isLoading) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSend = () => {
    const successfulFiles = processingStates
      .filter(
        (s): s is typeof s & { status: "success"; result: ProcessedFile } =>
          s.status === "success" && s.result !== undefined
      )
      .map((s) => s.result)

    onSend(
      undefined,
      undefined,
      successfulFiles.length > 0 ? successfulFiles : undefined
    )
    clearAllProcessingStates()
  }

  const handleSelectPrompt = (prompt: string) => {
    const start = selectionStartRef.current
    const end = selectionEndRef.current

    const addSpaceIfNeeded = (before: string, after: string) => {
      let result = prompt
      if (before && !/\s$/.test(before)) result = ` ${result}`
      if (after && !/^\s/.test(after)) result = `${result} `
      return result
    }

    if (start !== null && end !== null) {
      if (start !== end) {
        const before = input.slice(0, start)
        const after = input.slice(end)
        const newPrompt = addSpaceIfNeeded(before, after)
        setInput(before + newPrompt + after)
      } else {
        const before = input.slice(0, start)
        const after = input.slice(start)
        const newPrompt = addSpaceIfNeeded(before, after)
        setInput(before + newPrompt + after)
      }
    } else {
      const before = ""
      const after = input
      const newPrompt = addSpaceIfNeeded(before, after)
      setInput(newPrompt + input)
    }
    setShowPromptOverlay(false)
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        const pos = (start ?? 0) + prompt.length
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(pos, pos)
      }
    })
  }

  const handleFilesSelected = useCallback(
    (files: FileList) => {
      processFiles(files)
    },
    [processFiles]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()

    // Check if any dragged item is an image
    const hasImage = Array.from(e.dataTransfer.items).some((item) =>
      item.type.startsWith("image/")
    )

    if (!hasImage) {
      setIsDragging(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const files = Array.from(e.dataTransfer.files)
        const validFiles = files.filter(
          (file) => !file.type.startsWith("image/")
        )

        if (validFiles.length < files.length) {
          // TODO: Show toast notification that images are not supported
          console.warn("Images are currently not supported")
        }

        if (validFiles.length > 0) {
          // Create a new DataTransfer to convert array back to FileList
          const dt = new DataTransfer()
          validFiles.forEach((file) => {
            dt.items.add(file)
          })
          processFiles(dt.files)
        }
      }
    },
    [processFiles]
  )

  useEffect(() => {
    const handleMessage = (message: unknown) => {
      const msg = message as ChromeMessage
      if (
        msg.type === MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT &&
        msg.payload &&
        msg.fromBackground
      ) {
        const selectionText = `> ${(msg.payload as string).split("\n").join("\n> ")}\n`
        appendInput(selectionText)
        textareaRef.current?.focus()
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage)
    return () => chrome.runtime.onMessage.removeListener(handleMessage)
  }, [appendInput])

  const _successCount = processingStates.filter(
    (s) => s.status === "success"
  ).length

  return (
    <div className="relative">
      <div className="mb-2">
        <TabsSelect />
      </div>

      {showSessionMetrics && <SessionMetricsBar messages={messages} />}

      <ChatInputAttachmentList
        processingStates={processingStates}
        onRemove={(file) => clearProcessingState(file)}
      />

      {showPromptOverlay && (
        <PromptSelectorDialog
          open={showPromptOverlay}
          onSelect={handleSelectPrompt}
          onClose={() => setShowPromptOverlay(false)}
        />
      )}

      {/* biome-ignore lint/a11y/noStaticElementInteractions: Drag and drop zone wrapper */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "relative rounded-xl border-2 bg-card/50 backdrop-blur-sm transition-all duration-200",
          isFocused
            ? "border-primary/50 shadow-lg shadow-primary/10"
            : "border-border/50 hover:border-border",
          isDragging && "border-primary border-dashed bg-primary/5"
        )}>
        <ChatInputDragOverlay isDragging={isDragging} />

        <Textarea
          id="chat-input-textarea"
          ref={textareaRef}
          placeholder={t("chat.input.placeholder")}
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            updateSelection()
          }}
          onKeyDown={handleKeyDown}
          onSelect={updateSelection}
          onKeyUp={updateSelection}
          onFocus={() => {
            setIsFocused(true)
            updateSelection()
          }}
          onBlur={() => setIsFocused(false)}
          className={cn(
            "max-h-[300px] min-h-[100px] w-full resize-none border-0 bg-transparent",
            "pb-12 pl-4 pr-16 pt-4 text-sm leading-relaxed scrollbar-none",
            "focus-visible:ring-0 focus-visible:ring-offset-0",
            "placeholder:text-muted-foreground/70"
          )}
          autoFocus
        />

        <ChatInputToolbar
          inputLength={input.length}
          isLoading={isLoading}
          onFilesSelected={handleFilesSelected}
        />

        <div className="absolute right-3 top-3">
          <SendOrStopButton
            onSend={handleSend}
            stopGeneration={stopGeneration}
          />
        </div>
      </div>
    </div>
  )
}
