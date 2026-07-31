import { useStorage } from "@plasmohq/storage/hook"
import type { LucideIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { buttonVariants } from "@/components/ui/button"
import { STORAGE_KEYS } from "@/lib/constants"
import { SOCIAL_LINKS } from "@/lib/constants-ui"
import { buildGenericIssueReportUrl } from "@/lib/error-report"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { cn } from "@/lib/utils"
import type { SelectedModelRef } from "@/types/model"

export const BugReportIcon = ({ showText = true }: { showText?: boolean }) => {
  const { t } = useTranslation()
  const bugLink = SOCIAL_LINKS.find((link) => link.id === "bug_report")
  const [selectedModelRef] = useStorage<SelectedModelRef | null>(
    {
      key: STORAGE_KEYS.PROVIDER.SELECTED_MODEL_REF,
      instance: plasmoGlobalStorage
    },
    null
  )
  const [selectedModel] = useStorage<string>(
    {
      key: STORAGE_KEYS.PROVIDER.SELECTED_MODEL,
      instance: plasmoGlobalStorage
    },
    ""
  )

  if (!bugLink) return null

  const Icon: LucideIcon = bugLink.icon
  const issueUrl = buildGenericIssueReportUrl({
    providerId: selectedModelRef?.providerId,
    model: selectedModelRef?.modelId || selectedModel
  })

  return (
    <TooltipActionButton
      trigger={
        // biome-ignore lint/a11y/useAnchorContent: children are forwarded by Base UI's render-prop merge at runtime
        <a
          href={issueUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "hover:text-status-danger",
            buttonVariants({ variant: "link" })
          )}
          aria-label={t("common.bug_report.aria_label")}
        />
      }
      icon={<Icon className="icon-xs" />}
      label={t("common.bug_report.label")}
      tooltip={t("common.bug_report.tooltip")}
      showLabel={showText}
    />
  )
}
