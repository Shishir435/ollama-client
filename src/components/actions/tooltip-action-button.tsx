import type React from "react"
import { createElement, type ElementType, isValidElement } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import type { LucideIcon } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

export interface TooltipActionButtonProps
  extends Omit<React.ComponentProps<typeof Button>, "children" | "aria-label"> {
  label?: React.ReactNode
  labelKey?: string
  tooltip?: React.ReactNode
  tooltipKey?: string
  ariaLabel?: string
  icon?: LucideIcon | React.ReactElement
  iconClassName?: string
  showLabel?: boolean
  labelClassName?: string
  trigger?: React.ReactElement
  tooltipContainer?: HTMLElement | ShadowRoot | null
  tooltipSide?: React.ComponentProps<typeof TooltipContent>["side"]
  tooltipSideOffset?: React.ComponentProps<typeof TooltipContent>["sideOffset"]
  tooltipClassName?: string
}

export function TooltipActionButton({
  label,
  labelKey,
  tooltip,
  tooltipKey,
  ariaLabel,
  icon,
  iconClassName,
  showLabel = false,
  labelClassName,
  trigger,
  tooltipContainer,
  tooltipSide = "top",
  tooltipSideOffset,
  tooltipClassName,
  className,
  ...props
}: TooltipActionButtonProps) {
  const { t } = useTranslation()
  const resolvedLabel =
    label ?? (labelKey ? t(labelKey) : (ariaLabel ?? tooltip ?? ""))
  const resolvedTooltip =
    tooltip ?? (tooltipKey ? t(tooltipKey) : resolvedLabel)
  const resolvedAriaLabel =
    ariaLabel ??
    (typeof resolvedLabel === "string"
      ? resolvedLabel
      : typeof resolvedTooltip === "string"
        ? resolvedTooltip
        : undefined)
  const renderedIcon = isValidElement(icon)
    ? icon
    : icon
      ? createElement(icon as ElementType, {
          "aria-hidden": true,
          className: iconClassName
        })
      : null

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          trigger ?? (
            <Button
              className={cn(className)}
              aria-label={resolvedAriaLabel}
              {...props}
            />
          )
        }>
        {renderedIcon}
        {showLabel && <span className={labelClassName}>{resolvedLabel}</span>}
      </TooltipTrigger>
      <TooltipContent
        container={tooltipContainer}
        side={tooltipSide}
        sideOffset={tooltipSideOffset}
        className={tooltipClassName}>
        {resolvedTooltip}
      </TooltipContent>
    </Tooltip>
  )
}
