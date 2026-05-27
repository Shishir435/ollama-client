import type React from "react"

import { Loader2 } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

interface LoadingStateProps extends React.ComponentProps<"div"> {
  label?: React.ReactNode
}

export const LoadingState = ({
  label,
  className,
  ...props
}: LoadingStateProps) => (
  <div
    className={cn(
      "flex min-h-32 flex-col items-center justify-center text-muted-foreground",
      className
    )}
    {...props}>
    <Loader2 className="mb-3 size-7 animate-spin text-primary/50" />
    {label && <p className="text-xs">{label}</p>}
  </div>
)
