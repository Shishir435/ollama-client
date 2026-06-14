import type React from "react"
import { forwardRef } from "react"

import { cn } from "@/lib/utils"

interface MiniBadgeProps extends React.ComponentProps<"span"> {
  text: React.ReactNode
}

export const MiniBadge = forwardRef<HTMLSpanElement, MiniBadgeProps>(
  ({ text, className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "text-[10px] font-medium text-muted-foreground/80 border border-border rounded px-1 py-0.5 leading-none",
        className
      )}
      {...props}>
      {text}
    </span>
  )
)

MiniBadge.displayName = "MiniBadge"
