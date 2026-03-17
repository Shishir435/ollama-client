import { useTranslation } from "react-i18next"
import { BugReportIcon } from "@/components/bug-report-icon"
import { SettingsButton } from "@/components/settings-button"
import { ThemeToggle } from "@/components/theme-toggle"
import { ChatExportButton } from "./chat-export-button"
import { ChatImportButton } from "./chat-import-button"

interface ChatSessionFooterProps {
  sessionCount: number
}

export const ChatSessionFooter = ({ sessionCount }: ChatSessionFooterProps) => {
  const { t } = useTranslation()

  return (
    <>
      <div className="border-t border-border/50 p-2">
        <div className="flex items-center justify-center gap-2">
          <div className="flex flex-1 items-center rounded-lg bg-muted/20 p-1 transition-all duration-200 hover:bg-muted/40">
            <SettingsButton />
          </div>

          <div className="flex flex-1 items-center rounded-lg bg-muted/20 p-1 transition-all duration-200 hover:bg-muted/40">
            <BugReportIcon />
          </div>

          <div className="flex flex-1 items-center rounded-lg bg-muted/20 p-1 transition-all duration-200 hover:bg-muted/40">
            <ThemeToggle />
          </div>
        </div>
      </div>

      <div className="border-t border-border/50 bg-muted/20 p-3 pt-2">
        <div className="flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
          {sessionCount === 1
            ? t("sessions.selector.session_count", {
                count: sessionCount
              })
            : t("sessions.selector.session_count_plural", {
                count: sessionCount
              })}{" "}
          <ChatExportButton showAllSessions />
          <ChatImportButton />
        </div>
      </div>
    </>
  )
}
