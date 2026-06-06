import { MessageSquare, SquarePen, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { Button } from "@/components/ui/button"
import { SheetClose, SheetHeader, SheetTitle } from "@/components/ui/sheet"

export interface ChatSessionSidebarHeaderProps {
  onCreateSession: () => void
}

export const ChatSessionSidebarHeader = ({
  onCreateSession
}: ChatSessionSidebarHeaderProps) => {
  const { t } = useTranslation()

  return (
    <SheetHeader className="flex-row items-center justify-between border-b border-sidebar-border px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex size-7 items-center justify-center rounded-control bg-app-primary-soft text-app-agent">
          <MessageSquare className="size-3.5" />
        </div>
        <SheetTitle className="truncate text-[13px] font-semibold text-sidebar-foreground">
          {t("sessions.selector.title")}
        </SheetTitle>
      </div>

      <div className="flex items-center gap-1">
        <TooltipActionButton
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 rounded-control text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          onClick={onCreateSession}
          icon={SquarePen}
          iconClassName="size-3.5"
          label={t("sessions.selector.create_new")}
        />
        <SheetClose
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-7 rounded-control bg-transparent text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            />
          }>
          <X className="size-3.5" />
        </SheetClose>
      </div>
    </SheetHeader>
  )
}
