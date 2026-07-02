import type React from "react"

import {
  TooltipActionButton,
  type TooltipActionButtonProps
} from "@/components/actions/tooltip-action-button"
import { cn } from "@/lib/utils"

export interface ActionConfig extends Omit<TooltipActionButtonProps, "key"> {
  key: React.Key
  hidden?: boolean
}

interface ActionGroupProps extends React.ComponentProps<"div"> {
  actions: ActionConfig[]
  defaultVariant?: TooltipActionButtonProps["variant"]
  defaultSize?: TooltipActionButtonProps["size"]
  tooltipContainer?: HTMLElement | ShadowRoot | null
  wrap?: boolean
}

export function ActionGroup({
  actions,
  defaultVariant = "ghost",
  defaultSize = "icon",
  tooltipContainer,
  wrap = true,
  className,
  ...props
}: ActionGroupProps) {
  const visibleActions = actions.filter((action) => !action.hidden)

  if (visibleActions.length === 0) return null

  const buttons = (
    <>
      {visibleActions.map(({ key, hidden: _hidden, ...action }) => (
        <TooltipActionButton
          type={action.type ?? "button"}
          variant={action.variant ?? defaultVariant}
          size={action.size ?? defaultSize}
          tooltipContainer={action.tooltipContainer ?? tooltipContainer}
          {...action}
          key={key}
        />
      ))}
    </>
  )

  if (!wrap) return buttons

  return (
    <div className={cn("flex items-center gap-1", className)} {...props}>
      {buttons}
    </div>
  )
}
