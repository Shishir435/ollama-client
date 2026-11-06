import { Check, Loader2, Save, Undo2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import type { ProviderSaveStatus } from "@/features/model/hooks/provider-draft-reducer"

interface ProviderSaveBarProps {
  dirty: boolean
  status: ProviderSaveStatus
  onSave: () => void
  onDiscard: () => void
}

/**
 * The one commit point for a provider's connection settings. It stays
 * pinned to the bottom of the scrolling page while the draft differs from what
 * is stored, and shows the outcome of the last save inline afterwards.
 */
export const ProviderSaveBar = ({
  dirty,
  status,
  onSave,
  onDiscard
}: ProviderSaveBarProps) => {
  const { t } = useTranslation()
  const saving = status === "saving"

  if (!dirty && status !== "saved" && status !== "failed") return null

  return (
    <div
      data-testid="provider-save-bar"
      className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 border-t bg-surface-chat px-4 py-3">
      <output
        aria-live="polite"
        className="flex items-center gap-2 text-sm text-muted-foreground">
        {dirty ? (
          <>
            <span
              aria-hidden="true"
              className="icon-xs shrink-0 rounded-full bg-status-warning-text"
            />
            {t("settings.providers.unsaved")}
          </>
        ) : status === "failed" ? (
          <span className="text-status-danger-text">
            {t("settings.providers.save_status.failed")}
          </span>
        ) : (
          <>
            <Check className="icon-md text-status-success-text" />
            {t("settings.providers.save_status.saved")}
          </>
        )}
      </output>
      {dirty && (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={onDiscard}>
            <Undo2 className="icon-md mr-2" />
            {t("settings.providers.discard")}
          </Button>
          <Button size="sm" disabled={saving} onClick={onSave}>
            {saving ? (
              <Loader2 className="icon-md mr-2 animate-spin" />
            ) : (
              <Save className="icon-md mr-2" />
            )}
            {t("settings.providers.save")}
          </Button>
        </div>
      )}
    </div>
  )
}
