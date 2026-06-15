import { useState } from "react"
import { useTranslation } from "react-i18next"

import { ConfirmActionDialog } from "@/components/settings/confirm-action-dialog"
import { SettingsCard } from "@/components/settings/settings-card"
import { SettingsChangePreview } from "@/components/settings/settings-change-preview"
import { applyStorageWrites } from "@/features/settings/apply-settings"
import {
  SETTINGS_PRESETS,
  type SettingsPreset
} from "@/features/settings/presets"
import { useConfirmAction } from "@/hooks/use-confirm-action"
import { useToast } from "@/hooks/use-toast"
import { Sparkles } from "@/lib/lucide-icon"

/**
 * One-click settings presets. Applying a preset is a batch write across
 * `@plasmohq/storage` (`applyStorageWrites`); a confirm dialog previews the
 * exact keys/values that will change first. Per-setting controls stay editable
 * afterward — a preset is a starting point, not a lock.
 */
export const PresetPicker = () => {
  const { t } = useTranslation()
  const { toast } = useToast()
  const confirm = useConfirmAction()
  const [pending, setPending] = useState<SettingsPreset | null>(null)
  const [busy, setBusy] = useState(false)

  const choose = (preset: SettingsPreset) => {
    setPending(preset)
    confirm.openDialog()
  }

  const close = () => {
    confirm.closeDialog()
    setPending(null)
  }

  const apply = async () => {
    if (!pending) return
    setBusy(true)
    try {
      await applyStorageWrites(pending.writes)
      toast({
        title: t("settings.presets.applied", { name: t(pending.labelKey) })
      })
      close()
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsCard
      icon={Sparkles}
      title={t("settings.presets.title")}
      description={t("settings.presets.description")}>
      <div className="grid gap-2 sm:grid-cols-2">
        {SETTINGS_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => choose(preset)}
            className="flex flex-col items-start gap-0.5 rounded-control border border-border bg-accent/20 p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40">
            <span className="text-sm font-medium">{t(preset.labelKey)}</span>
            <span className="text-xs text-muted-foreground">
              {t(preset.descriptionKey)}
            </span>
          </button>
        ))}
      </div>

      <ConfirmActionDialog
        open={confirm.open}
        onOpenChange={(next) => {
          if (!next) close()
        }}
        busy={busy}
        title={t("settings.presets.preview_title", {
          name: pending ? t(pending.labelKey) : ""
        })}
        confirmLabel={t("settings.presets.apply")}
        description={
          <span className="block">
            <span className="block">{t("settings.presets.preview_hint")}</span>
            {pending && <SettingsChangePreview writes={pending.writes} />}
          </span>
        }
        onConfirm={apply}
      />
    </SettingsCard>
  )
}
