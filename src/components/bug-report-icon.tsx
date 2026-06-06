import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { buttonVariants } from "@/components/ui/button"
import { SOCIAL_LINKS } from "@/lib/constants-ui"
import type { LucideIcon } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

export const BugReportIcon = ({ showText = true }: { showText?: boolean }) => {
  const { t } = useTranslation()
  const bugLink = SOCIAL_LINKS.find((link) => link.id === "bug_report")

  if (!bugLink) return null

  const Icon: LucideIcon = bugLink.icon

  return (
    <TooltipActionButton
      trigger={
        // biome-ignore lint/a11y/useAnchorContent: children are forwarded by Base UI's render-prop merge at runtime
        <a
          href={bugLink.href}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "hover:text-status-danger",
            buttonVariants({ variant: "link" })
          )}
          aria-label={t("common.bug_report.aria_label")}
        />
      }
      icon={<Icon size="16" />}
      label={t("common.bug_report.label")}
      tooltip={t("common.bug_report.tooltip")}
      showLabel={showText}
    />
  )
}
