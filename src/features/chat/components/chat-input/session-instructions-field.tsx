import { ScrollText } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"

/**
 * The per-chat system prompt, written where the rest of a message's context is
 * chosen.
 *
 * It was an icon button in the header opening a popover, and the icon was a
 * robot — which says "agent" on a surface where the Agent is a different thing
 * entirely, for a setting that is only ever about this chat. A prompt the user
 * has to find behind a glyph is a prompt they forget they set, so it is a
 * block here: the sheet has the height, and a field that shows its own value
 * needs no marker to say it has one.
 */
export const SessionInstructionsField = () => {
  const { t } = useTranslation()
  const { currentSessionId, sessions, setSessionSystemPrompt } =
    useChatSessions()
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)

  const saved =
    sessions.find((s) => s.id === currentSessionId)?.systemPrompt ?? ""

  /* Re-sync when the active chat changes, so it never shows a stale edit. */
  useEffect(() => setDraft(saved), [saved])

  if (!currentSessionId) return null

  const hasPrompt = saved.trim().length > 0
  const dirty = draft !== saved

  const write = async (value: string) => {
    if (saving) return
    setSaving(true)
    try {
      await setSessionSystemPrompt(currentSessionId, value)
      setDraft(value)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-1.5 px-2.5" aria-labelledby="chat-instructions">
      <h3
        id="chat-instructions"
        className="flex items-center gap-2 font-medium text-xs">
        <ScrollText className="icon-sm text-muted-foreground" />
        {t("chat.system_prompt.title")}
      </h3>
      <p className="text-2xs text-muted-foreground">
        {t("chat.system_prompt.description")}
      </p>
      <Textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={3}
        placeholder={t("chat.system_prompt.placeholder")}
      />
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => write("")}
          disabled={saving || (!hasPrompt && draft.trim().length === 0)}>
          {t("chat.system_prompt.clear")}
        </Button>
        <Button
          size="sm"
          disabled={saving || !dirty}
          onClick={() => write(draft)}>
          {t("chat.system_prompt.save")}
        </Button>
      </div>
    </section>
  )
}
