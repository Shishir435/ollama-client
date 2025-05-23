import { Textarea } from "@/components/ui/textarea"
import { useAutoResizeTextarea } from "@/hooks/use-auto-resize-textarea"
import { useEffect, useRef } from "react"

import BugReportIcon from "./bug-report-icon"
import ModelMenu from "./model-menu"
import SendOrStopButton from "./send-or-stop-button"
import SettingsButton from "./settings-button"
import ThemeToggle from "./theme-toggle"

export default function ChatInputBox({
  input,
  setInput,
  isLoading,
  onSend,
  stopGeneration
}: {
  input: string
  setInput: (val: string) => void
  isLoading: boolean
  onSend: () => void
  stopGeneration: () => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useAutoResizeTextarea(textareaRef, input)

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !isLoading) {
      e.preventDefault()
      onSend()
    }
  }

  return (
    <div className="relative h-auto">
      <Textarea
        id="chat-input-textarea"
        ref={textareaRef}
        placeholder="Type your message..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        className="max-h-[300px] min-h-[80px] w-full resize-none overflow-hidden rounded-b-2xl pb-10"
        autoFocus
      />
      <div className="absolute bottom-0 left-2 flex items-center gap-1">
        <ModelMenu tooltipTextContent="Switch model" />
        <SettingsButton />
        <BugReportIcon />
        <ThemeToggle />
      </div>
      <SendOrStopButton
        isLoading={isLoading}
        onSend={onSend}
        stopGeneration={stopGeneration}
      />
    </div>
  )
}
