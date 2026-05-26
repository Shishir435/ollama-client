import type React from "react"

import { SectionStack } from "@/components/layout"
import { cn } from "@/lib/utils"

export const SettingsTabPanel = ({
  className,
  ...props
}: React.ComponentProps<"div">) => (
  <SectionStack className={cn(className)} {...props} />
)
