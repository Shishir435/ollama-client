import { Textarea } from "@/components/ui/textarea"
import { useAutoResizeTextarea } from "@/hooks/use-auto-resize-textarea"
import { useRef } from "react"

import BugReportIcon from "./bug-report-icon"
import ModelMenu from "./model-menu"
import SendOrStopButton from "./send-or-stop-button"
import SettingsButton from "./settings-button"
import TabsSelect from "./tabs-select"
import TabsToggle from "./tabs-toggle"
import ThemeToggle from "./theme-toggle"

export default function ChatInputBox({
  input,
  setInput,
  isLoading,
  onSend,
  stopGeneration,
  tokenSize
}: {
  input: string
  setInput: (val: string) => void
  isLoading: boolean
  onSend: () => void
  stopGeneration: () => void
  tokenSize: number
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useAutoResizeTextarea(textareaRef, input)

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !isLoading) {
      e.preventDefault()
      onSend()
    }
  }
  console.log()
  return (
    <div className="relative h-auto">
      <TabsSelect />
      <div>token size{tokenSize}</div>
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
        <TabsToggle />
      </div>
      <SendOrStopButton
        isLoading={isLoading}
        onSend={onSend}
        stopGeneration={stopGeneration}
      />
    </div>
  )
}
