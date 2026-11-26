import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react"
import { useTranslation } from "react-i18next"
import { ComposerShell } from "@/components/layout/composer-shell"
import { Textarea } from "@/components/ui/textarea"
import { StorageFullNotice } from "@/features/chat/components/storage-full-notice"
import { useChatInputAttachments } from "@/features/chat/hooks/use-chat-input-attachments"
import { useSelectionHandoff } from "@/features/chat/hooks/use-selection-handoff"
import { useSessionMetricsPreference } from "@/features/chat/hooks/use-session-metrics-preference"
import { useAgentComposerNotice } from "@/features/chat/lib/agent-composer-notice"
import {
  chatInputStore,
  useChatInput,
  useComposerUi
} from "@/features/chat/stores/chat-input-store"
import { useLoadStream } from "@/features/chat/stores/load-stream-store"
import { useSelectionContext } from "@/features/chat/stores/selection-context-store"
import { PromptSelectorSheet } from "@/features/prompt/components/prompt-selector-sheet"
import {
  SLASH_MENU_ID,
  SlashPromptMenu,
  slashOptionId
} from "@/features/prompt/components/slash-prompt-menu"
import { usePromptTemplateResolution } from "@/features/prompt/hooks/use-prompt-template-resolution"
import { usePromptTemplates } from "@/features/prompt/hooks/use-prompt-templates"
import { buildPromptTemplateVariableContext } from "@/features/prompt/lib/prompt-template-context"
import {
  filterSlashTemplates,
  findSlashQuery,
  insertSlashTemplate
} from "@/features/prompt/lib/slash-command"
import { useTabContents } from "@/features/tabs/hooks/use-tab-contents"
import { useSelectedTabs } from "@/features/tabs/stores/selected-tabs-store"
import { useAutoResizeTextarea } from "@/hooks/use-auto-resize-textarea"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { useSetting } from "@/hooks/use-setting"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/class-names"
import type { ProcessedFile } from "@/lib/file-processors/types"
import { SETTINGS } from "@/lib/storage/settings"
import type { ImageAttachment, PromptTemplate } from "@/types"
import { ChatInputDragOverlay } from "./chat-input/chat-input-drag-overlay"
import { ChatInputToolbar } from "./chat-input/chat-input-toolbar"
import {
  fileListFromFiles,
  splitDropFiles
} from "./chat-input/drop-file-policy"
import { SelectionContextChips } from "./selection-context-chips"
import { SendOrStopButton } from "./send-or-stop-button"

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
  const AgentNotice = useAgentComposerNotice()
  const { input, setInput } = useChatInput()
  const {
    promptLibraryOpen,
    focused,
    focusRequest,
    setPromptLibraryOpen,
    setFocused
  } = useComposerUi()
  const { isLoading } = useLoadStream()
  const { selectedTabIds } = useSelectedTabs()
  const { items: selectionContext } = useSelectionContext()
  const { loadingIds, tabContents } = useTabContents()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const field = textareaRef.current
    /** A remount keeps the draft, so the caret goes after it, where typing left it. */
    field?.setSelectionRange(field.value.length, field.value.length)
    field?.focus()
  }, [])
  useEffect(() => {
    if (focusRequest > 0) textareaRef.current?.focus()
  }, [focusRequest])
  const [selectionRange, setSelectionRange] = useState<{
    start: number | null
    end: number | null
  }>({ start: null, end: null })
  const sendingRef = useRef(false)
  const [isDragging, setIsDragging] = useState(false)
  const [showSessionMetrics, setShowSessionMetrics] =
    useSessionMetricsPreference()

  const {
    processFiles,
    processingStates,
    successfulFiles,
    clearProcessingState,
    clearAllProcessingStates,
    images,
    handleImageFiles,
    captureScreenshot,
    captureScreenshotAttachment,
    visionUnsupported,
    removeImage,
    clearImages
  } = useChatInputAttachments()

  const [autoScreenshotOnVision] = useSetting(
    SETTINGS.AUTO_SCREENSHOT_ON_VISION
  )

  const [useRAG, setUseRAG] = useSetting(SETTINGS.USE_RAG)

  const [tabAccess, setTabAccess] = useSetting(SETTINGS.TABS_ACCESS)

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
      const start = textareaRef.current.selectionStart
      const end = textareaRef.current.selectionEnd
      setSelectionRange((current) =>
        current.start === start && current.end === end
          ? current
          : { start, end }
      )
    }
  }

  const variableContext = useMemo(
    () =>
      buildPromptTemplateVariableContext({
        input,
        selectionStart: selectionRange.start,
        selectionEnd: selectionRange.end,
        selectedTabIds,
        tabContents
      }),
    [input, selectionRange, selectedTabIds, tabContents]
  )
  const { resolveTemplatePrompt } = usePromptTemplateResolution(variableContext)
  const slash = findSlashQuery(input, selectionRange.start)
  const [slashDismissedAt, setSlashDismissedAt] = useState<number | null>(null)
  const [slashCursor, setSlashCursor] = useState({ key: "", index: 0 })
  const slashQuery = slash?.query ?? null
  /** Read templates only once `/` is typed: opening the panel must not touch the template store. */
  const { templates, incrementUsageCount } = usePromptTemplates({
    enabled: slashQuery !== null
  })
  const slashMatches = useMemo(
    () =>
      slashQuery === null ? [] : filterSlashTemplates(templates, slashQuery),
    [templates, slashQuery]
  )
  const slashOpen =
    slash !== null &&
    slash.start !== slashDismissedAt &&
    slashMatches.length > 0 &&
    !promptLibraryOpen
  /** The highlighted row restarts at the top whenever the typed filter changes. */
  const slashKey = slash ? `${slash.start}:${slash.query}` : ""
  const activeSlashIndex = Math.min(
    slashCursor.key === slashKey ? slashCursor.index : 0,
    Math.max(slashMatches.length - 1, 0)
  )
  const setSlashActive = (index: number) =>
    setSlashCursor({ key: slashKey, index })

  const applySlashTemplate = async (template: PromptTemplate | undefined) => {
    if (!template || !slash) return
    const token = slash
    const prompt = await resolveTemplatePrompt(template)
    /** The clipboard read can outlast keystrokes; replace only the token as it was chosen. */
    const latest = chatInputStore.getState().input
    const end = token.start + 1 + token.query.length
    if (
      latest.slice(token.start, end) !== `/${token.query}` ||
      /\S/.test(latest.charAt(end)) ||
      findSlashQuery(latest, end)?.start !== token.start
    )
      return
    const next = insertSlashTemplate(latest, token, end, prompt)
    setInput(next.value)
    incrementUsageCount(template.id)
    requestAnimationFrame(() => {
      const field = textareaRef.current
      if (!field) return
      field.focus()
      field.setSelectionRange(next.caret, next.caret)
      updateSelection()
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    /** Ctrl+/ everywhere, and Cmd+/ where the platform's command key is Meta. */
    if (e.key === "/" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      updateSelection()
      setPromptLibraryOpen(true)
    }

    /** Neither a menu key nor Enter may act on text an IME has not committed. */
    const composing = e.nativeEvent.isComposing || e.keyCode === 229

    if (slashOpen && !composing) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault()
        const step = e.key === "ArrowDown" ? 1 : -1
        setSlashActive(
          (activeSlashIndex + step + slashMatches.length) % slashMatches.length
        )
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        void applySlashTemplate(slashMatches[activeSlashIndex])
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        setSlashDismissedAt(slash?.start ?? null)
        return
      }
    }

    if (e.key === "Escape") {
      setPromptLibraryOpen(false)
    }

    /** An Enter that commits an IME candidate must not send the message. */
    if (composing) return

    if (e.key === "Enter" && !e.shiftKey && !isLoading) {
      e.preventDefault()
      void handleSend()
    }
  }

  const handleSend = async () => {
    /**
     * Don't start a new turn while one is in flight (the action button is a
     * Stop button then; this guards programmatic/edge callers too). `isLoading`
     * only flips after onSend, so a synchronous ref guards the async gap below
     * (capturing a screenshot) against a second Enter triggering a double send.
     */
    if (isLoading || sendingRef.current) return
    sendingRef.current = true

    try {
      const selectedTabNums = selectedTabIds.map((id) => parseInt(id, 10))
      const pendingTabCount = selectedTabNums.filter(
        (tabId) => loadingIds?.[tabId]
      ).length
      if (tabAccess && pendingTabCount > 0) {
        toast({
          title: t("chat.input.reading_tabs_title"),
          description: t("chat.input.reading_tabs_body", {
            count: pendingTabCount
          })
        })
        return
      }

      /**
       * Auto-attach a fresh screenshot when enabled for a vision model — but
       * never override an image the user staged manually.
       */
      let outgoingImages = images
      if (autoScreenshotOnVision && !visionUnsupported && images.length === 0) {
        const shot = await captureScreenshotAttachment()
        if (shot) outgoingImages = [shot]
      }

      onSend(
        undefined,
        undefined,
        successfulFiles.length > 0 ? successfulFiles : undefined,
        outgoingImages.length > 0 ? outgoingImages : undefined
      )
      clearAllProcessingStates()
      clearImages()
    } finally {
      sendingRef.current = false
    }
  }

  const handleSelectPrompt = async (prompt: string) => {
    const { start, end } = selectionRange

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
    setPromptLibraryOpen(false)
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

  const resetSelectionAttachments = useCallback(() => {
    clearImages()
    clearAllProcessingStates()
  }, [clearImages, clearAllProcessingStates])
  const reportSelectionError = useCallback(() => {
    toast({ description: t("selection_button.panel.open_chat_failed") })
  }, [toast, t])
  useSelectionHandoff({
    textareaRef,
    onNewChat: resetSelectionAttachments,
    onError: reportSelectionError
  })

  const selectedTabNums = selectedTabIds.map((id) => parseInt(id, 10))
  const pendingTabCount = selectedTabNums.filter(
    (tabId) => loadingIds?.[tabId]
  ).length
  const isPreparingTabContext = tabAccess && pendingTabCount > 0
  return (
    <div className="relative">
      {promptLibraryOpen && (
        <PromptSelectorSheet
          open={promptLibraryOpen}
          onSelect={handleSelectPrompt}
          onClose={() => setPromptLibraryOpen(false)}
          variableContext={variableContext}
        />
      )}

      {slashOpen && (
        <SlashPromptMenu
          templates={slashMatches}
          activeIndex={activeSlashIndex}
          onSelect={(template) => void applySlashTemplate(template)}
          onActiveChange={setSlashActive}
        />
      )}

      <StorageFullNotice />

      {AgentNotice && createElement(AgentNotice)}

      <ComposerShell
        isFocused={focused}
        isDragging={isDragging}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}>
        <ChatInputDragOverlay isDragging={isDragging} />
        <SelectionContextChips />
        <Textarea
          id="chat-input-textarea"
          ref={textareaRef}
          placeholder={t("chat.input.placeholder")}
          aria-keyshortcuts="Control+/ Meta+/"
          {...(slashOpen
            ? {
                role: "combobox",
                "aria-expanded": true,
                "aria-controls": SLASH_MENU_ID,
                "aria-activedescendant": slashOptionId(
                  slashMatches[activeSlashIndex].id
                )
              }
            : {})}
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            updateSelection()
            /** A dismissed menu stays dismissed only while the same slash is being typed. */
            if (!findSlashQuery(e.target.value, e.target.selectionStart)) {
              setSlashDismissedAt(null)
            }
          }}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          onSelect={updateSelection}
          onKeyUp={updateSelection}
          onFocus={() => {
            setFocused(true)
            updateSelection()
          }}
          onBlur={() => setFocused(false)}
          className={cn(
            "max-h-75 min-h-11 w-full resize-none border-0 bg-transparent",
            "pb-14 pl-4 pr-14 pt-3 text-sm leading-relaxed scrollbar-none",
            "focus-visible:ring-0 focus-visible:ring-offset-0",
            "placeholder:text-foreground-tertiary"
          )}
        />

        <ChatInputToolbar
          inputLength={input.length}
          isLoading={isLoading}
          onFilesSelected={handleFilesSelected}
          processingStates={processingStates}
          onRemoveFile={clearProcessingState}
          acceptImages={!visionUnsupported}
          images={images}
          onRemoveImage={removeImage}
          onCaptureScreenshot={captureScreenshot}
          showScreenshot={!visionUnsupported}
        />

        <div className="absolute right-3 top-3">
          <SendOrStopButton
            onSend={handleSend}
            stopGeneration={stopGeneration}
            disabledSend={isPreparingTabContext}
            hasContent={
              input.trim().length > 0 ||
              selectionContext.length > 0 ||
              images.length > 0 ||
              successfulFiles.length > 0
            }
            sendLabel={
              isPreparingTabContext
                ? t("chat.input.reading_tabs_button")
                : undefined
            }
          />
        </div>
      </ComposerShell>
    </div>
  )
}
