import { useTranslation } from "react-i18next"
import { buttonVariants } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { SOCIAL_LINKS } from "@/lib/constants-ui"
import type { LucideIcon } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

export const BugReportIcon = ({ showText = true }: { showText?: boolean }) => {
  const { t } = useTranslation()
  const bugLink = SOCIAL_LINKS.find((link) => link.id === "bug_report")

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
            aria-label={t("common.bug_report.aria_label")}>
            <Icon size="16" />
            {showText && <span>{t("common.bug_report.label")}</span>}
          </a>
        </TooltipTrigger>
        <TooltipContent>{t("common.bug_report.tooltip")}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
