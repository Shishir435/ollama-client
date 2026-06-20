import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Textarea } from "@/components/ui/textarea"
import { useChatInputAttachments } from "@/features/chat/hooks/use-chat-input-attachments"
import { useSessionMetricsPreference } from "@/features/chat/hooks/use-session-metrics-preference"
import { useChatInput } from "@/features/chat/stores/chat-input-store"
import { useLoadStream } from "@/features/chat/stores/load-stream-store"
import { PromptSelectorSheet } from "@/features/prompt/components/prompt-selector-sheet"
import { useTabContents } from "@/features/tabs/hooks/use-tab-contents"
import { useSelectedTabs } from "@/features/tabs/stores/selected-tabs-store"
import { useAutoResizeTextarea } from "@/hooks/use-auto-resize-textarea"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { useToast } from "@/hooks/use-toast"
import {
  DEFAULT_TABS_ACCESS,
  MESSAGE_KEYS,
  STORAGE_KEYS
} from "@/lib/constants"
import type { ProcessedFile } from "@/lib/file-processors/types"
import {
  getPlasmoStorageForKey,
  plasmoGlobalStorage
} from "@/lib/plasmo-global-storage"
import { cn } from "@/lib/utils"
import type { ChromeMessage, ImageAttachment } from "@/types"
import { ChatInputAttachmentSheet } from "./chat-input/chat-input-attachment-sheet"
import { ChatInputDragOverlay } from "./chat-input/chat-input-drag-overlay"
import { ChatInputToolbar } from "./chat-input/chat-input-toolbar"
import { ComposerShell } from "./chat-input/composer-shell"
import {
  fileListFromFiles,
  splitDropFiles
} from "./chat-input/drop-file-policy"
import { SendOrStopButton } from "./send-or-stop-button"

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
    files?: ProcessedFile[],
    images?: ImageAttachment[]
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
    successfulFiles,
    clearProcessingState,
    clearAllProcessingStates,
    images,
    handleImageFiles,
    visionUnsupported,
    removeImage,
    clearImages
  } = useChatInputAttachments()

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
    DEFAULT_TABS_ACCESS
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
    // Don't start a new turn while one is in flight (the action button is a
    // Stop button then; this guards programmatic/edge callers too).
    if (isLoading) return

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
      successfulFiles.length > 0 ? successfulFiles : undefined,
      images.length > 0 ? images : undefined
    )
    clearAllProcessingStates()
    clearImages()
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
      const { acceptedFiles, rejectedImages } = splitDropFiles(
        Array.from(files)
      )
      handleImageFiles(rejectedImages)
      if (acceptedFiles.length > 0) {
        processFiles(fileListFromFiles(acceptedFiles))
      }
    },
    [processFiles, handleImageFiles]
  )

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const pastedImages = Array.from(e.clipboardData.files).filter((f) =>
        f.type.startsWith("image/")
      )
      if (pastedImages.length > 0) {
        e.preventDefault()
        handleImageFiles(pastedImages)
      }
    },
    [handleImageFiles]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
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
        const { acceptedFiles, rejectedImages } = splitDropFiles(files)

        handleImageFiles(rejectedImages)

        if (acceptedFiles.length > 0) {
          processFiles(fileListFromFiles(acceptedFiles))
        }
      }
    },
    [processFiles, handleImageFiles]
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
          onPaste={handlePaste}
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
          acceptImages={!visionUnsupported}
          imageCount={images.length}
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
        images={images}
        onRemoveImage={removeImage}
      />
    </div>
  )
}
