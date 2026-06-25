import { MessageSquare, SquarePen, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { Button } from "@/components/ui/button"
import { SheetClose, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"

export interface ChatSessionSidebarHeaderProps {
  onCreateSession: () => void
  sessionCount: number
}

export const ChatSessionSidebarHeader = ({
  onCreateSession,
  sessionCount
}: ChatSessionSidebarHeaderProps) => {
  const { t } = useTranslation()

  return (
    <SheetHeader className="flex-row items-center justify-between border-b border-sidebar-border px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex size-7 items-center justify-center rounded-control bg-app-primary-soft text-app-agent">
          <MessageSquare className="icon-sm" />
        </div>
        <SheetTitle className="truncate text-[13px] font-semibold text-sidebar-foreground">
          {t("sessions.selector.title")}
        </SheetTitle>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-sidebar-accent px-1.5 text-[11px] font-medium tabular-nums text-sidebar-foreground/80" />
            }>
            {sessionCount}
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {sessionCount === 1
              ? t("sessions.selector.session_count", { count: sessionCount })
              : t("sessions.selector.session_count_plural", {
                  count: sessionCount
                })}
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="flex items-center gap-1">
        <TooltipActionButton
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 rounded-control text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          onClick={onCreateSession}
          icon={SquarePen}
          iconClassName="icon-sm"
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
          <X className="icon-sm" />
        </SheetClose>
      </div>
    </SheetHeader>
  )
}
