import type React from "react"

import { PageStack } from "@/components/layout"
import { cn } from "@/lib/utils"

export const SettingsTabPanel = ({
  className,
  ...props
}: React.ComponentProps<"div">) => (
  <PageStack className={cn(className)} {...props} />
)
