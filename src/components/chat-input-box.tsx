import { useRef, useState } from "react"

import ModelMenu from "@/components/model-menu"
import PromptSelectorDialog from "@/components/prompt-selector-dialog"
import SendOrStopButton from "@/components/send-or-stop-button"
import TabsSelect from "@/components/tabs-select"
import TabsToggle from "@/components/tabs-toggle"
import { Textarea } from "@/components/ui/textarea"
import { useAutoResizeTextarea } from "@/hooks/use-auto-resize-textarea"
import { useChatInput } from "@/context/chat-input-context"
import { useLoadStream } from "@/context/load-stream-context"
import { cn } from "@/lib/utils"

export default function ChatInputBox({
  onSend,
  stopGeneration
}: {
  onSend: () => void
  stopGeneration: () => void
}) {
  const { input, setInput } = useChatInput()
  const { isLoading } = useLoadStream()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [showPromptOverlay, setShowPromptOverlay] = useState(false)
  const [isFocused, setIsFocused] = useState(false)

  useAutoResizeTextarea(textareaRef, input)

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.key === "/" && e.ctrlKey) || e.key === "/") {
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
    setInput(prompt)
    setShowPromptOverlay(false)
    textareaRef.current?.focus()
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
          placeholder="Type your message... Press '/' for prompts"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
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
