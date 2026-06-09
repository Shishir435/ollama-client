import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Textarea } from "@/components/ui/textarea"
import { ChatInputAttachmentSheet } from "@/features/chat/components/chat-input/chat-input-attachment-sheet"
import { ChatInputDragOverlay } from "@/features/chat/components/chat-input/chat-input-drag-overlay"
import { ChatInputToolbar } from "@/features/chat/components/chat-input/chat-input-toolbar"
import { ComposerShell } from "@/features/chat/components/chat-input/composer-shell"
import { SendOrStopButton } from "@/features/chat/components/send-or-stop-button"
import { useSessionMetricsPreference } from "@/features/chat/hooks/use-session-metrics-preference"
import { useChatInput } from "@/features/chat/stores/chat-input-store"
import { useLoadStream } from "@/features/chat/stores/load-stream-store"
import { useFileUpload } from "@/features/file-upload/hooks/use-file-upload"
import { PromptSelectorSheet } from "@/features/prompt/components/prompt-selector-sheet"
import { useTabContents } from "@/features/tabs/hooks/use-tab-contents"
import { useSelectedTabs } from "@/features/tabs/stores/selected-tabs-store"
import { useAutoResizeTextarea } from "@/hooks/use-auto-resize-textarea"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { useToast } from "@/hooks/use-toast"
import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"
import type { ProcessedFile } from "@/lib/file-processors/types"
import { logger } from "@/lib/logger"
import {
  getPlasmoStorageForKey,
  plasmoGlobalStorage
} from "@/lib/plasmo-global-storage"
import { cn } from "@/lib/utils"
import type { ChromeMessage } from "@/types"

const pendingSelectionStorage = getPlasmoStorageForKey(
  STORAGE_KEYS.BROWSER.PENDING_SELECTION_TEXT
)

export const ChatInputBox = ({
  onSend,
  stopGeneration
}: {
  onSend: (
    customInput?: string,
    customModel?: string,
    files?: ProcessedFile[]
  ) => void
  stopGeneration: () => void
}) => {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { input, setInput, appendInput } = useChatInput()
  const { isLoading } = useLoadStream()
  const { selectedTabIds } = useSelectedTabs()
  const { loadingIds } = useTabContents()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const selectionStartRef = useRef<number | null>(null)
  const selectionEndRef = useRef<number | null>(null)
  const lastSelectionAppendRef = useRef<{ text: string; at: number } | null>(
    null
  )
  const [showPromptOverlay, setShowPromptOverlay] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [showSessionMetrics, setShowSessionMetrics] =
    useSessionMetricsPreference()
  const [showAttachmentSheet, setShowAttachmentSheet] = useState(false)

  const {
    processFiles,
    processingStates,
    clearProcessingState,
    clearAllProcessingStates
  } = useFileUpload({
    onError: (error) => {
      logger.error("File processing error", "ChatInputBox", { error })
      toast({
        variant: "destructive",
        title: "File Upload Failed",
        description: error.message || "Failed to process file"
      })
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

  const successfulFiles = processingStates
    .filter(
      (s): s is typeof s & { status: "success"; result: ProcessedFile } =>
        s.status === "success" && s.result !== undefined
    )
    .map((s) => s.result)

  const handleSend = () => {
    const selectedTabNums = selectedTabIds.map((id) => parseInt(id, 10))
    const pendingTabCount = selectedTabNums.filter(
      (tabId) => loadingIds?.[tabId]
    ).length
    if (tabAccess && pendingTabCount > 0) {
      toast({
        title: "Preparing tab context",
        description: `Still extracting ${pendingTabCount} selected tab${pendingTabCount > 1 ? "s" : ""}. Please wait a moment.`
      })
      return
    }

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
          toast({
            variant: "destructive",
            description: "Images are currently not supported"
          })
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
    [processFiles, toast]
  )

  const appendSelectionToInput = useCallback(
    async (rawText: string) => {
      const pendingText = rawText.trim()
      if (!pendingText) return

      const now = Date.now()
      const lastAppend = lastSelectionAppendRef.current

      if (lastAppend?.text === pendingText && now - lastAppend.at < 2000) {
        await pendingSelectionStorage.remove(
          STORAGE_KEYS.BROWSER.PENDING_SELECTION_TEXT
        )
        return
      }

      lastSelectionAppendRef.current = { text: pendingText, at: now }

      const firstLineBreak = pendingText.indexOf("\n\n")
      const selectionText =
        firstLineBreak === -1
          ? `> ${pendingText.split("\n").join("\n> ")}\n`
          : `> ${pendingText.slice(0, firstLineBreak).split("\n").join("\n> ")}\n\n${pendingText.slice(firstLineBreak + 2).trim()}`
      appendInput(selectionText)
      textareaRef.current?.focus()

      await pendingSelectionStorage.remove(
        STORAGE_KEYS.BROWSER.PENDING_SELECTION_TEXT
      )
    },
    [appendInput]
  )

  useEffect(() => {
    // Check for pending selection (from context menu or selection button when sidebar was closed)
    const checkPendingSelection = async () => {
      const pendingText = await pendingSelectionStorage.get<string>(
        STORAGE_KEYS.BROWSER.PENDING_SELECTION_TEXT
      )

      if (pendingText) await appendSelectionToInput(pendingText)
    }

    checkPendingSelection()

    const pendingSelectionWatch = {
      [STORAGE_KEYS.BROWSER.PENDING_SELECTION_TEXT]: (change: {
        newValue?: string
      }) => {
        if (change.newValue) void appendSelectionToInput(change.newValue)
      }
    }

    pendingSelectionStorage.watch(pendingSelectionWatch)

    const selectionBridgePort = chrome.runtime.connect({
      name: MESSAGE_KEYS.BROWSER.SELECTION_BRIDGE_PORT
    })

    const handlePortMessage = (message: unknown) => {
      const msg = message as ChromeMessage
      if (
        msg.type === MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT &&
        msg.payload &&
        msg.fromBackground
      ) {
        void appendSelectionToInput(msg.payload as string)
      }
    }

    selectionBridgePort.onMessage.addListener(handlePortMessage)

    const handleMessage = (message: unknown) => {
      const msg = message as ChromeMessage
      if (
        msg.type === MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT &&
        msg.payload &&
        msg.fromBackground
      ) {
        void appendSelectionToInput(msg.payload as string)
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage)
    return () => {
      pendingSelectionStorage.unwatch(pendingSelectionWatch)
      selectionBridgePort.onMessage.removeListener(handlePortMessage)
      selectionBridgePort.disconnect()
      chrome.runtime.onMessage.removeListener(handleMessage)
    }
  }, [appendSelectionToInput])

  const selectedTabNums = selectedTabIds.map((id) => parseInt(id, 10))
  const pendingTabCount = selectedTabNums.filter(
    (tabId) => loadingIds?.[tabId]
  ).length
  const isPreparingTabContext = tabAccess && pendingTabCount > 0

  return (
    <div className="relative">
      {showPromptOverlay && (
        <PromptSelectorSheet
          open={showPromptOverlay}
          onSelect={handleSelectPrompt}
          onClose={() => setShowPromptOverlay(false)}
        />
      )}

      <ComposerShell
        isFocused={isFocused}
        isDragging={isDragging}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}>
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
            "max-h-75 min-h-11 w-full resize-none border-0 bg-transparent",
            "pb-14 pl-4 pr-14 pt-3 text-sm leading-relaxed scrollbar-none",
            "focus-visible:ring-0 focus-visible:ring-offset-0",
            "placeholder:text-muted-foreground/70"
          )}
          autoFocus
        />

        <ChatInputToolbar
          inputLength={input.length}
          isLoading={isLoading}
          onFilesSelected={handleFilesSelected}
          processingStates={processingStates}
          onAttachmentClick={() => setShowAttachmentSheet(true)}
        />

        <div className="absolute right-3 top-3">
          <SendOrStopButton
            onSend={handleSend}
            stopGeneration={stopGeneration}
            disabledSend={isPreparingTabContext}
            sendLabel={
              isPreparingTabContext ? "Preparing tab context..." : undefined
            }
          />
        </div>
      </ComposerShell>
      <ChatInputAttachmentSheet
        open={showAttachmentSheet}
        onOpenChange={setShowAttachmentSheet}
        processingStates={processingStates}
        onRemove={clearProcessingState}
      />
    </div>
  )
}
