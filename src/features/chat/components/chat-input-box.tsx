import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { SettingsButton } from "@/components/settings-button"
import { Textarea } from "@/components/ui/textarea"
import { SendOrStopButton } from "@/features/chat/components/send-or-stop-button"
import { SessionMetricsBar } from "@/features/chat/components/session-metrics-bar"
import { useSessionMetricsPreference } from "@/features/chat/hooks/use-session-metrics-preference"
import { useChatInput } from "@/features/chat/stores/chat-input-store"
import { useLoadStream } from "@/features/chat/stores/load-stream-store"
import { FilePreview } from "@/features/file-upload/components/file-preview"
import { FileUploadButton } from "@/features/file-upload/components/file-upload-button"
import { useFileUpload } from "@/features/file-upload/hooks/use-file-upload"
import { ModelMenu } from "@/features/model/components/model-menu"
import { PromptSelectorDialog } from "@/features/prompt/components/prompt-selector-dialog"
import { TabsSelect } from "@/features/tabs/components/tabs-select"
import { TabsToggle } from "@/features/tabs/components/tabs-toggle"
import { useAutoResizeTextarea } from "@/hooks/use-auto-resize-textarea"
import { MESSAGE_KEYS } from "@/lib/constants"
import type { ProcessedFile } from "@/lib/file-processors/types"
import { Upload } from "@/lib/lucide-icon"
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
  const [showSessionMetrics] = useSessionMetricsPreference()

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

  const hasFiles = processingStates.length > 0
  const _successCount = processingStates.filter(
    (s) => s.status === "success"
  ).length

  return (
    <div className="relative">
      <div className="mb-2">
        <TabsSelect />
      </div>

      {showSessionMetrics && <SessionMetricsBar messages={messages} />}

      {hasFiles && (
        <div className="mb-2 space-y-1">
          {processingStates.map((state) => (
            <FilePreview
              key={state.file.name}
              processingState={state}
              onRemove={() => clearProcessingState(state.file)}
            />
          ))}
        </div>
      )}

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
        {isDragging && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center rounded-xl bg-background/80 backdrop-blur-sm">
            <Upload className="mb-2 size-8 animate-bounce text-primary" />
            <p className="text-sm font-medium text-primary">
              {t("chat.input.drop_files_here", {
                defaultValue: "Drop files here"
              })}
            </p>
          </div>
        )}

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

        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between rounded-b-xl border-t border-border/30 bg-muted/30 p-2">
          <div className="flex items-center gap-4">
            <ModelMenu
              showStatusPopup={false}
              tooltipTextContent={t("chat.input.switch_model")}
            />
            <TabsToggle />
            <SettingsButton showText={false} />
            <div className="flex items-center gap-2">
              <FileUploadButton
                onFilesSelected={handleFilesSelected}
                disabled={isLoading}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="font-mono text-xs text-muted-foreground">
              {input.length > 0 &&
                t("chat.input.chars", { count: input.length })}
            </div>
            <div className="hidden text-xs text-muted-foreground sm:block">
              <kbd className="rounded bg-muted px-1.5 py-0.5 text-xs">
                {t("chat.input.enter_key")}
              </kbd>{" "}
              {t("chat.input.enter_to_send")}
            </div>
          </div>
        </div>

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
