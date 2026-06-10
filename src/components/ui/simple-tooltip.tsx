import type React from "react"
import type { ReactNode } from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"

interface SimpleTooltipProps {
  children: ReactNode
  content: ReactNode
  side?: React.ComponentProps<typeof TooltipContent>["side"]
  triggerRender?: React.ReactElement
}

export function SimpleTooltip({
  children,
  content,
  side,
  triggerRender = <span />
}: SimpleTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger render={triggerRender}>{children}</TooltipTrigger>
      <TooltipContent side={side}>{content}</TooltipContent>
    </Tooltip>
  )
}
