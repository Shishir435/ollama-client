import type * as React from "react"
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

export interface ConfirmActionDialogProps {
  /** Controlled open state. */
  open: boolean
  /** Controlled open setter. */
  onOpenChange: (open: boolean) => void
  /** Title shown inside the dialog. */
  title: React.ReactNode
  /** Body copy. Optional. */
  description?: React.ReactNode
  /** Label of the confirm button. Defaults to `common.continue`. */
  confirmLabel?: React.ReactNode
  /** Label of the cancel button. Defaults to `common.cancel`. */
  cancelLabel?: React.ReactNode
  /** Style the confirm button with the destructive variant. */
  destructive?: boolean
  /** Disable both buttons while an outer flow is running. */
  busy?: boolean
  /** Called when the user clicks confirm. */
  onConfirm: () => void | Promise<void>
}

/**
 * Shared "are you sure?" dialog. Wraps `AlertDialog` with sensible
 * defaults so the duplicated confirm flows across settings collapse
 * to a single component.
 *
 * Always controlled — pair with `useConfirmAction` (or your own
 * `useState`) for the open state. Controlled-only keeps the component
 * predictable when the same dialog instance is reused for multiple
 * actions (the title/handler swap based on which action the caller
 * queued), which is how `context-settings.tsx` uses it.
 */
export const ConfirmActionDialog = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  busy = false,
  onConfirm
}: ConfirmActionDialogProps) => {
  const { t } = useTranslation()

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          ) : (
            <AlertDialogDescription />
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            {cancelLabel ?? t("common.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : undefined}
            disabled={busy}
            onClick={onConfirm}>
            {confirmLabel ?? t("common.continue")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
