import { useTranslation } from "react-i18next"
import {
  ActionMenuGrid,
  type ActionMenuItemConfig,
  TooltipActionButton
} from "@/components/actions"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { MoreHorizontal } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

export interface ChatSessionActionsProps {
  actions: ActionMenuItemConfig[]
  trigger?: {
    ariaLabel?: string
    tooltip?: string
    icon?: React.ReactNode
    className?: string
    variant?: "ghost" | "outline" | "default"
    size?:
      | "icon"
      | "default"
      | "sm"
      | "lg"
      | "xs"
      | "icon-xs"
      | "icon-sm"
      | "icon-lg"
  }
}

export const ChatSessionActions = ({
  actions,
  trigger = {}
}: ChatSessionActionsProps) => {
  const { t } = useTranslation()
  const {
    ariaLabel = t("sessions.actions.more_default"),
    tooltip = t("sessions.actions.tooltip"),
    icon = <MoreHorizontal className="icon-md" />,
    className = "",
    variant = "ghost",
    size = "icon"
  } = trigger

  const triggerClassName = cn(
    "size-7 shrink-0 rounded-control transition-all duration-200",
    "hover:bg-muted hover:text-foreground",
    "focus:bg-muted focus:text-foreground focus:opacity-100",
    className
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <TooltipActionButton
            variant={variant}
            size={size}
            className={triggerClassName}
            ariaLabel={ariaLabel}
            tooltip={tooltip}
            icon={icon}
          />
        }
      />
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="w-auto rounded-panel border-muted/60 p-0.5 shadow-md data-open:animate-none data-closed:animate-none">
        <DropdownMenuGroup>
          <ActionMenuGrid actions={actions} />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
