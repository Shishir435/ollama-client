import { BookOpen, RotateCcw } from "lucide-react"
import type { ChangeEvent } from "react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import {
  SettingsActionRow,
  SettingsCard,
  SettingsFormField
} from "@/components/settings"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useSetting } from "@/hooks/use-setting"
import { writeSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"
import { assertSyncStorageQuota } from "@/lib/storage/sync-quota"

/**
 * Global standing instructions, prepended to every chat's leading system prompt.
 * Kept separate from the per-model system prompt (which lives in the RHF form)
 * because it is account-wide, not model-scoped.
 */
export const CustomInstructionsCard = () => {
  const { t } = useTranslation()
  const [skillsText, , { isLoading }] = useSetting(SETTINGS.SKILLS_TEXT)
  const [draft, setDraft] = useState("")
  // Last value synced to storage. `draft === baseline` means no unsaved edits.
  const [baseline, setBaseline] = useState<string>("")
  const loadedRef = useRef(false)

  // Syncs the draft with storage on first load and on external changes (only
  // when there are no unsaved edits). The value comes from an async setting,
  // so it cannot be derived during render.
  useEffect(() => {
    if (isLoading) return
    if (!loadedRef.current) {
      // First load: sync the textarea to whatever is stored.
      loadedRef.current = true
      setDraft(skillsText)
      setBaseline(skillsText)
      return
    }
    // External change while the card is open: adopt it only when there are no
    // unsaved local edits, so we never clobber what the user is typing.
    if (skillsText !== baseline && draft === baseline) {
      // oxlint-disable-next-line react/set-state-in-effect -- syncs local draft state with an externally loaded setting; not derivable at render time
      setDraft(skillsText)
      setBaseline(skillsText)
    }
  }, [isLoading, skillsText, baseline, draft])

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(e.target.value)
  }

  // Persist directly so we can report success only after the write lands.
  const persist = async (next: string): Promise<boolean> => {
    try {
      // Fast arithmetic check so oversized text never reaches the browser quota.
      await assertSyncStorageQuota(SETTINGS.SKILLS_TEXT.key, next)
      await writeSetting(SETTINGS.SKILLS_TEXT, next)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(message, { duration: 4000 })
      return false
    }
  }

  const handleSave = async () => {
    const next = draft.trim()
    if (next === baseline) return
    if (await persist(next)) {
      setBaseline(next)
      toast.success(t("settings.saved"), { duration: 2000 })
    }
  }

  const handleReset = async () => {
    setDraft("")
    if (await persist("")) {
      setBaseline("")
      toast.success(t("settings.model.system.custom_instructions_reset"), {
        duration: 2000
      })
    }
  }

  return (
    <SettingsCard
      icon={BookOpen}
      title={t("settings.model.system.custom_instructions_title")}
      description={t("settings.model.system.custom_instructions_description")}
      contentClassName="space-y-3">
      <SettingsFormField
        htmlFor="custom-instructions"
        focusId="custom-instructions"
        label={t("settings.model.system.custom_instructions_label")}>
        <Textarea
          id="custom-instructions"
          name="custom-instructions"
          placeholder={t(
            "settings.model.system.custom_instructions_placeholder"
          )}
          value={draft}
          onChange={handleChange}
          onBlur={handleSave}
          className="min-h-25 resize-none"
        />
        <SettingsActionRow>
          <Button type="button" variant="ghost" onClick={handleReset}>
            <RotateCcw className="mr-0.5 icon-xs" />
            {t("settings.prompts.reset")}
          </Button>
        </SettingsActionRow>
      </SettingsFormField>
    </SettingsCard>
  )
}
