import { useRef, useState } from "react"

import { SettingsButton } from "@/components/settings-button"
import { Textarea } from "@/components/ui/textarea"
import { useAutoResizeTextarea } from "@/hooks/use-auto-resize-textarea"
import { cn } from "@/lib/utils"
import { SendOrStopButton } from "@/features/chat/components/send-or-stop-button"
import { useChatInput } from "@/features/chat/stores/chat-input-store"
import { useLoadStream } from "@/features/chat/stores/load-stream-store"
import { ModelMenu } from "@/features/model/components/model-menu"
import { PromptSelectorDialog } from "@/features/prompt/components/prompt-selector-dialog"
import { TabsSelect } from "@/features/tabs/components/tabs-select"
import { TabsToggle } from "@/features/tabs/components/tabs-toggle"

export const ChatInputBox = ({
  onSend,
  stopGeneration
}: {
  onSend: () => void
  stopGeneration: () => void
}) => {
  const { input, setInput } = useChatInput()
  const { isLoading } = useLoadStream()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const selectionStartRef = useRef<number | null>(null)
  const selectionEndRef = useRef<number | null>(null)
  const [showPromptOverlay, setShowPromptOverlay] = useState(false)
  const [isFocused, setIsFocused] = useState(false)

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
      onSend()
    }
  }

  const handleSelectPrompt = (prompt: string) => {
    const start = selectionStartRef.current
    const end = selectionEndRef.current

    const addSpaceIfNeeded = (before: string, after: string) => {
      let result = prompt
      if (before && !/\s$/.test(before)) result = " " + result
      if (after && !/^\s/.test(after)) result = result + " "
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

  return (
    <div className="relative">
      <div className="mb-2">
        <TabsSelect />
      </div>

      {showPromptOverlay && (
        <PromptSelectorDialog
          open={showPromptOverlay}
          onSelect={handleSelectPrompt}
          onClose={() => setShowPromptOverlay(false)}
        />
      )}

      <div
        className={cn(
          "relative rounded-xl border-2 bg-card/50 backdrop-blur-sm transition-all duration-200",
          isFocused
            ? "border-primary/50 shadow-lg shadow-primary/10"
            : "border-border/50 hover:border-border"
        )}>
        <Textarea
          id="chat-input-textarea"
          ref={textareaRef}
          placeholder="Type message... Ctrl + / for prompts"
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
              tooltipTextContent="Switch model"
            />
            <TabsToggle />
            <SettingsButton showText={false} />
          </div>

          <div className="flex items-center gap-3">
            <div className="font-mono text-xs text-muted-foreground">
              {input.length > 0 && `${input.length} chars`}
            </div>
            <div className="hidden text-xs text-muted-foreground sm:block">
              <kbd className="rounded bg-muted px-1.5 py-0.5 text-xs">
                Enter
              </kbd>{" "}
              to send
            </div>
          </div>
        </div>

        <div className="absolute right-3 top-3">
          <SendOrStopButton onSend={onSend} stopGeneration={stopGeneration} />
        </div>
      </div>
    </div>
  )
}
