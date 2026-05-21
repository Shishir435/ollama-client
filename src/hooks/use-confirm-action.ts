import { useCallback, useState } from "react"

export interface UseConfirmActionResult {
  /** Pass to ConfirmActionDialog's `open` prop. */
  open: boolean
  /** Pass to ConfirmActionDialog's `onOpenChange` prop. */
  onOpenChange: (open: boolean) => void
  /** Open the dialog (e.g. from a button onClick). */
  openDialog: () => void
  /** Close the dialog programmatically. */
  closeDialog: () => void
}

/**
 * Tiny helper for boilerplate-free wiring of `ConfirmActionDialog`.
 * Returns props shaped to spread into the dialog plus an `openDialog`
 * for the trigger button.
 *
 * For dialogs that toggle between multiple actions (one dialog
 * instance, swapping title + onConfirm), pair with your own state
 * for the action selection; this hook just owns the open/closed flag.
 */
export const useConfirmAction = (): UseConfirmActionResult => {
  const [open, setOpen] = useState(false)
  const openDialog = useCallback(() => setOpen(true), [])
  const closeDialog = useCallback(() => setOpen(false), [])

  return { open, onOpenChange: setOpen, openDialog, closeDialog }
}
