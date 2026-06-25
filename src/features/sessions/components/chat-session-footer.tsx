import { useTranslation } from "react-i18next"
import { BugReportIcon } from "@/components/bug-report-icon"
import { SettingsButton } from "@/components/settings-button"
import { ThemeToggle } from "@/components/theme-toggle"

export interface ChatSessionFooterProps {
  sessionCount: number
}

export const ChatSessionFooter = ({ sessionCount }: ChatSessionFooterProps) => {
  const { t } = useTranslation()

  return (
    <>
      <div className="border-t border-sidebar-border p-2">
        <div className="flex items-center justify-center gap-2">
          <SettingsButton />
          <BugReportIcon />
          <ThemeToggle />
        </div>
      </div>

      <div className="border-t border-sidebar-border bg-sidebar-accent/60 p-3 pt-2">
        <div className="flex items-center justify-center gap-2 text-center text-xs text-sidebar-foreground/70">
          {sessionCount === 1
            ? t("sessions.selector.session_count", {
                count: sessionCount
              })
            : t("sessions.selector.session_count_plural", {
                count: sessionCount
              })}
        </div>
      </div>
    </>
  )
}
