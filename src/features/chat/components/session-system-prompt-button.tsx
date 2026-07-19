import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { TooltipActionButton } from "@/components/actions"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger
} from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { chatIconBtnCls } from "@/features/chat/lib/chat-styles"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { Bot } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

/**
 * Header control for the per-chat system prompt override. When set, a dot marks
 * the button; the popover edits or clears the override for the active session.
 */
export const SessionSystemPromptButton = () => {
  const { t } = useTranslation()
  const { currentSessionId, sessions, setSessionSystemPrompt } =
    useChatSessions()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)

  const current = sessions.find((s) => s.id === currentSessionId)
  const saved = current?.systemPrompt ?? ""

  // Re-sync the draft to the stored value whenever the popover opens or the
  // active session changes, so it never shows a stale edit.
  useEffect(() => {
    if (open) setDraft(saved)
  }, [open, saved])

  if (!currentSessionId) return null

  const label = t("chat.system_prompt.button")
  const hasPrompt = saved.trim().length > 0

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    try {
      await setSessionSystemPrompt(currentSessionId, draft)
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  const handleClear = async () => {
    if (saving) return
    setSaving(true)
    try {
      await setSessionSystemPrompt(currentSessionId, "")
      setDraft("")
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <TooltipActionButton
            size="icon"
            variant="ghost"
            className={cn(chatIconBtnCls, "relative")}
            label={label}
            tooltip={label}
            icon={
              <>
                <Bot className="icon-xs" />
                {hasPrompt && (
                  <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-app-primary" />
                )}
              </>
            }
          />
        }
      />
      <PopoverContent align="end" className="w-80 space-y-2">
        <PopoverHeader>
          <PopoverTitle>{t("chat.system_prompt.title")}</PopoverTitle>
          <PopoverDescription>
            {t("chat.system_prompt.description")}
          </PopoverDescription>
        </PopoverHeader>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={5}
          placeholder={t("chat.system_prompt.placeholder")}
        />
        <div className="flex justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            disabled={saving || (!hasPrompt && draft.trim().length === 0)}>
            {t("chat.system_prompt.clear")}
          </Button>
          <Button size="sm" disabled={saving} onClick={handleSave}>
            {t("chat.system_prompt.save")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
