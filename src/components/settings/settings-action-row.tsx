import type React from "react"

import { cn } from "@/lib/class-names"

export const SettingsActionRow = ({
  className,
  ...props
}: React.ComponentProps<"div">) => (
  <div
    className={cn("flex flex-col gap-2 sm:flex-row sm:items-center", className)}
    {...props}
  />
)
