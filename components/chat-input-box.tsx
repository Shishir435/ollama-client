import { Textarea } from "@/components/ui/textarea"
import { useChatInput } from "@/context/chat-input-context"
import { useLoadStream } from "@/context/load-stream-context"
import { useAutoResizeTextarea } from "@/hooks/use-auto-resize-textarea"
import { useRef, useState } from "react"

import BugReportIcon from "./bug-report-icon"
import ModelMenu from "./model-menu"
import PromptSelectorOverlay from "./prompt-selector-dialog"
import SendOrStopButton from "./send-or-stop-button"
import SettingsButton from "./settings-button"
import TabsSelect from "./tabs-select"
import TabsToggle from "./tabs-toggle"
import ThemeToggle from "./theme-toggle"

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
    <div className="relative h-auto">
      <TabsSelect />
      {showPromptOverlay && (
        <PromptSelectorOverlay
          open={showPromptOverlay}
          onSelect={handleSelectPrompt}
          onClose={() => setShowPromptOverlay(false)}
        />
      )}
      <Textarea
        id="chat-input-textarea"
        ref={textareaRef}
        placeholder="Type your message... or '/'"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        className="h-[100px] max-h-[300px] w-full resize-none overflow-hidden rounded-b-2xl pb-10 scrollbar-none"
        autoFocus
      />
      <div className="absolute bottom-0 left-2 flex items-center gap-1">
        <ModelMenu showStatusPopup={false} tooltipTextContent="Switch model" />
        <SettingsButton />
        <BugReportIcon />
        <ThemeToggle />
        <TabsToggle />
      </div>
      <SendOrStopButton onSend={onSend} stopGeneration={stopGeneration} />
    </div>
  )
}
