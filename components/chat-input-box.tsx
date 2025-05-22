import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useAutoResizeTextarea } from "@/hooks/use-auto-resize-textarea"
import { Circle, Send } from "lucide-react"
import { useRef } from "react"

import BugReportIcon from "./bug-report-icon"
import ModelMenu from "./model-menu"
import SettingsButton from "./settings-button"

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
        ref={textareaRef}
        placeholder="Type your message..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        className="max-h-[300px] min-h-[80px] w-full resize-none overflow-hidden rounded-b-2xl pb-10"
        autoFocus
      />
      <div className="absolute bottom-0 left-2 flex items-center gap-2">
        <ModelMenu />
        <SettingsButton />
        <BugReportIcon />
      </div>
      {isLoading ? (
        <Button
          onClick={stopGeneration}
          className="absolute right-0 top-1/2 mr-2 -translate-y-1/2">
          <Circle size="16" />
        </Button>
      ) : (
        <Button
          onClick={onSend}
          className="absolute right-0 top-1/2 mr-2 -translate-y-1/2">
          <Send size="16" />
        </Button>
      )}
    </div>
  )
}
