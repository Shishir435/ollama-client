import { MessageSquare, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { Button } from "@/components/ui/button"
import { SheetClose, SheetHeader, SheetTitle } from "@/components/ui/sheet"

/**
 * The sheet's title row. New chat is the full-width button beneath it, and the
 * count that used to sit here said nothing the list does not.
 */
export const ChatSessionSidebarHeader = () => {
  const { t } = useTranslation()

  return (
    <SheetHeader className="flex-row items-center justify-between border-b border-sidebar-border px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex size-7 items-center justify-center rounded-control bg-app-primary-soft text-app-agent">
          <MessageSquare className="icon-sm" />
        </div>
        <SheetTitle className="truncate text-xs font-semibold text-sidebar-foreground">
          {t("sessions.selector.title")}
        </SheetTitle>
      </div>

      <div className="flex items-center gap-1">
        <TooltipActionButton
          label={t("common.close")}
          trigger={
            <SheetClose
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7 rounded-control bg-transparent text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  aria-label={t("common.close")}
                />
              }>
              <X className="icon-sm" />
            </SheetClose>
          }
        />
      </div>
    </SheetHeader>
  )
}
