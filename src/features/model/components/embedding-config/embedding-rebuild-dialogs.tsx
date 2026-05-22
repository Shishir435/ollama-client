import { useTranslation } from "react-i18next"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

export interface EmbeddingRebuildDialogsProps {
  /** Confirm-rebuild dialog (no model change, just "yes, wipe and rebuild"). */
  confirmRebuildOpen: boolean
  onConfirmRebuildOpenChange: (open: boolean) => void
  onConfirmRebuild: () => Promise<void> | void

  /** Model-change dialog (user picked a new embedding model). */
  modelChangeOpen: boolean
  onModelChangeOpenChange: (open: boolean) => void
  onSwitchOnly: () => void
  onSwitchAndRebuild: () => Promise<void> | void
}

/**
 * The two AlertDialog overlays for the embedding-settings page:
 *
 *   - Confirm a rebuild requested from the health-alert banner.
 *   - Confirm an embedding-model change, with two actions: switch
 *     without touching existing vectors, or switch and rebuild.
 *
 * Pure presentational; all state lives in the parent.
 */
export const EmbeddingRebuildDialogs = ({
  confirmRebuildOpen,
  onConfirmRebuildOpenChange,
  onConfirmRebuild,
  modelChangeOpen,
  onModelChangeOpenChange,
  onSwitchOnly,
  onSwitchAndRebuild
}: EmbeddingRebuildDialogsProps) => {
  const { t } = useTranslation()

  return (
    <>
      <AlertDialog
        open={confirmRebuildOpen}
        onOpenChange={onConfirmRebuildOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings.context.embedding_health.confirm")}
            </AlertDialogTitle>
            <AlertDialogDescription />
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                onConfirmRebuildOpenChange(false)
                await onConfirmRebuild()
              }}>
              {t("settings.context.embedding_health.action")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={modelChangeOpen}
        onOpenChange={onModelChangeOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings.embeddings.model_change_confirm.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.embeddings.model_change_confirm.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="grid gap-2 sm:grid-cols-2 sm:gap-3">
            <AlertDialogCancel className="text-center whitespace-normal sm:whitespace-nowrap">
              {t("common.cancel")}
            </AlertDialogCancel>
            <Button
              variant="secondary"
              onClick={onSwitchOnly}
              className="text-center whitespace-normal sm:whitespace-nowrap">
              {t("settings.embeddings.model_change_confirm.switch_only")}
            </Button>
            <AlertDialogAction
              onClick={onSwitchAndRebuild}
              className="text-center whitespace-normal sm:whitespace-nowrap sm:col-span-2 sm:justify-self-center">
              {t("settings.embeddings.model_change_confirm.switch_and_rebuild")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
