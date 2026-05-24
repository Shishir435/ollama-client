import type React from "react"

import { cn } from "@/lib/utils"

export const SettingsInlineControl = ({
  className,
  ...props
}: React.ComponentProps<"div">) => (
  <div className={cn("flex items-center gap-2", className)} {...props} />
)
