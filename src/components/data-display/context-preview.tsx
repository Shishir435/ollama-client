import type React from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface ContextPreviewProps
  extends Omit<React.ComponentProps<typeof Card>, "content" | "title"> {
  title?: React.ReactNode
  content: React.ReactNode
  actions?: React.ReactNode
}

export const ContextPreview = ({
  title,
  content,
  actions,
  className,
  ...props
}: ContextPreviewProps) => (
  <Card className={cn("p-3", className)} {...props}>
    {(title || actions) && (
      <div className="mb-2 flex items-center justify-between gap-2">
        {title && <div className="truncate text-xs font-medium">{title}</div>}
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
    )}
    <div className="line-clamp-4 whitespace-pre-wrap text-xs text-muted-foreground">
      {content}
    </div>
  </Card>
)

export const ContextPreviewAction = Button
