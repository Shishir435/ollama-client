import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

export interface ChatMessageEditorProps {
  initialContent: string
  onSave: (newContent: string) => void
  onCancel: () => void
  submitLabel?: string
}

export const ChatMessageEditor = ({
  initialContent,
  onSave,
  onCancel,
  submitLabel
}: ChatMessageEditorProps) => {
  const { t } = useTranslation()
  const [content, setContent] = useState(initialContent)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
      textareaRef.current.focus()
    }
  }, [])

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    e.target.style.height = "auto"
    e.target.style.height = `${e.target.scrollHeight}px`
    setContent(e.target.value)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      onSave(content)
    } else if (e.key === "Escape") {
      onCancel()
    }
  }

  return (
    <div className="flex w-full flex-col gap-2 rounded-message border bg-background p-3 shadow-xs sm:max-w-2xl sm:p-4">
      <Textarea
        ref={textareaRef}
        value={content}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        className="min-h-15 resize-none border-0 p-0 shadow-none focus-visible:ring-0"
        placeholder={t("chat.editor.placeholder")}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" onClick={() => onSave(content)}>
          {submitLabel ?? t("common.save")}
        </Button>
      </div>
    </div>
  )
}
