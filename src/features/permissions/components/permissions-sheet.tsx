import { useTranslation } from "react-i18next"

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet"
import { PermissionsPanel } from "@/features/permissions/components/permissions-panel"

interface PermissionsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Side sheet hosting the compact {@link PermissionsPanel}. Controlled so it can be
 * opened from surfaces that unmount themselves (e.g. the context popover) — keep
 * its `open` state in a parent that outlives the trigger.
 */
export const PermissionsSheet = ({
  open,
  onOpenChange
}: PermissionsSheetProps) => {
  const { t } = useTranslation()
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[min(26rem,calc(100vw-1.25rem))] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t("settings.permissions.title")}</SheetTitle>
        </SheetHeader>
        <div className="mt-3">
          <PermissionsPanel compact />
        </div>
      </SheetContent>
    </Sheet>
  )
}
