import { BookOpen, RotateCcw } from "lucide-react"
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
import { SETTINGS } from "@/lib/storage/settings"

/**
 * Global standing instructions, prepended to every chat's leading system prompt.
 * Kept separate from the per-model system prompt (which lives in the RHF form)
 * because it is account-wide, not model-scoped.
 */
export const CustomInstructionsCard = () => {
  const { t } = useTranslation()
  const [skillsText, setSkillsText, { isLoading }] = useSetting(
    SETTINGS.SKILLS_TEXT
  )
  const [draft, setDraft] = useState("")
  const loadedRef = useRef(false)

  useEffect(() => {
    if (isLoading || loadedRef.current) return
    loadedRef.current = true
    setDraft(skillsText)
  }, [isLoading, skillsText])

  const handleSave = () => {
    const next = draft.trim()
    if (next === skillsText) return
    setSkillsText(next)
    toast.success("Saved", { duration: 2000 })
  }

  const handleReset = () => {
    setDraft("")
    setSkillsText("")
    toast.success("Cleared", { duration: 2000 })
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
          onChange={(e) => setDraft(e.target.value)}
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
