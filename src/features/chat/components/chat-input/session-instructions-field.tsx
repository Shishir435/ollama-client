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
    <section className="space-y-1 px-2.5" aria-labelledby="chat-instructions">
      {/*
        The actions ride on the heading rather than under the field: two short
        words were spending a whole row of a dense sheet, and a heading line
        already reserves the space beside its own text.
      */}
      <div className="flex min-w-0 items-center gap-2">
        <h3
          id="chat-instructions"
          className="flex min-w-0 items-center gap-2 font-medium text-xs">
          <ScrollText className="icon-sm shrink-0 text-muted-foreground" />
          <span className="truncate">{t("chat.system_prompt.title")}</span>
        </h3>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-2xs"
            onClick={() => write("")}
            disabled={saving || (!hasPrompt && draft.trim().length === 0)}>
            {t("chat.system_prompt.clear")}
          </Button>
          <Button
            size="sm"
            className="h-6 px-2 text-2xs"
            disabled={saving || !dirty}
            onClick={() => write(draft)}>
            {t("chat.system_prompt.save")}
          </Button>
        </div>
      </div>
      <p className="text-2xs text-muted-foreground">
        {t("chat.system_prompt.description")}
      </p>
      <Textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={2}
        placeholder={t("chat.system_prompt.placeholder")}
      />
    </section>
  )
}
