import { buttonVariants } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { SOCIAL_LINKS } from "@/lib/constant"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

export default function BugReportIcon() {
  const bugLink = SOCIAL_LINKS.find((link) =>
    link.label.toLowerCase().includes("bug")
  )

  if (!bugLink) return null

  const Icon: LucideIcon = bugLink.icon

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={bugLink.href}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "hover:text-red-500",
              buttonVariants({ variant: "link" })
            )}
            aria-label="Report a bug or request a feature">
            <Icon size="16" />
          </a>
        </TooltipTrigger>
        <TooltipContent>Report a bug or request a feature</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
