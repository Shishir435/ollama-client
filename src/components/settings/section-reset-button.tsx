import { useState } from "react"
import { useTranslation } from "react-i18next"

import { SettingsChangeDialog } from "@/components/settings/settings-change-dialog"
import { Button } from "@/components/ui/button"
import { applyStorageWrites } from "@/features/settings/apply-settings"
import { useConfirmAction } from "@/hooks/use-confirm-action"
import { useToast } from "@/hooks/use-toast"
import { getSectionDefaults } from "@/lib/constants/section-defaults"
import { RotateCcw } from "@/lib/lucide-icon"

interface SectionResetButtonProps {
  /** A sectionId present in the F2 section-defaults manifest. */
  sectionId: string
  className?: string
}

/**
 * "Reset section" action for a settings card. Restores just this section's
 * controls to their defaults — sourced from the F2 manifest, so no per-card
 * default literals — behind a confirm dialog that previews exactly which
 * keys/values will change. Renders nothing if the section has no defaults.
 */
export const SectionResetButton = ({
  sectionId,
  className
}: SectionResetButtonProps) => {
  const { t } = useTranslation()
  const { toast } = useToast()
  const confirm = useConfirmAction()
  const [busy, setBusy] = useState(false)

  const defaults = getSectionDefaults(sectionId)
  if (defaults.length === 0) return null

  const handleConfirm = async () => {
    setBusy(true)
    try {
      await applyStorageWrites(defaults)
      toast({ title: t("settings.reset_section.done") })
      confirm.closeDialog()
    } catch (error) {
      toast({
        variant: "destructive",
        title: t(
          "settings.reset_section.error_title",
          "Failed to reset section"
        ),
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={className}
        onClick={confirm.openDialog}>
        <RotateCcw className="icon-sm mr-1.5" />
        {t("settings.reset_section.button")}
      </Button>
      <SettingsChangeDialog
        open={confirm.open}
        onOpenChange={(next) => {
          if (!next) confirm.closeDialog()
        }}
        busy={busy}
        icon={RotateCcw}
        title={t("settings.reset_section.title")}
        description={t("settings.reset_section.description")}
        writes={defaults}
        confirmLabel={t("settings.reset_section.button")}
        confirmIcon={RotateCcw}
        onConfirm={handleConfirm}
      />
    </>
  )
}
