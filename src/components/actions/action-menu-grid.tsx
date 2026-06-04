import type React from "react"
import { useTranslation } from "react-i18next"

import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export interface ActionMenuItemConfig {
  key: React.Key
  label?: React.ReactNode
  labelKey?: string
  tooltip?: React.ReactNode
  tooltipKey?: string
  ariaLabel?: string
  icon: React.ReactNode
  destructive?: boolean
  disabled?: boolean
  hidden?: boolean
  className?: string
  onClick: () => void
}

interface ActionMenuGridProps extends React.ComponentProps<"div"> {
  actions: ActionMenuItemConfig[]
  tooltipSide?: React.ComponentProps<typeof TooltipContent>["side"]
  tooltipSideOffset?: React.ComponentProps<typeof TooltipContent>["sideOffset"]
}

export function ActionMenuGrid({
  actions,
  className,
  tooltipSide = "top",
  tooltipSideOffset = 10,
  ...props
}: ActionMenuGridProps) {
  const { t } = useTranslation()
  const visibleActions = actions.filter((action) => !action.hidden)

  if (visibleActions.length === 0) return null

  return (
    <div
      className={cn(
        "grid grid-cols-5 justify-items-center gap-0.5 px-1 py-1",
        className
      )}
      {...props}>
      {visibleActions.map((action) => {
        const label =
          action.label ?? (action.labelKey ? t(action.labelKey) : "")
        const tooltip =
          action.tooltip ?? (action.tooltipKey ? t(action.tooltipKey) : label)
        const ariaLabel =
          action.ariaLabel ??
          (typeof label === "string"
            ? label
            : typeof tooltip === "string"
              ? tooltip
              : undefined)

        return (
          <Tooltip key={action.key}>
            <TooltipTrigger
              render={
                <DropdownMenuItem
                  onClick={action.onClick}
                  aria-label={ariaLabel}
                  disabled={action.disabled}
                  className={cn(
                    "size-8 justify-center rounded-md",
                    action.destructive
                      ? "text-destructive hover:bg-destructive/10"
                      : "hover:bg-muted/60",
                    action.className
                  )}
                />
              }>
              {action.icon}
            </TooltipTrigger>
            <TooltipContent side={tooltipSide} sideOffset={tooltipSideOffset}>
              {tooltip}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
