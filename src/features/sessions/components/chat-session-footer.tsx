import { BugReportIcon } from "@/components/bug-report-icon"
import { SettingsButton } from "@/components/settings-button"
import { ThemeToggle } from "@/components/theme-toggle"

export const ChatSessionFooter = () => {
  return (
    <div className="border-t border-sidebar-border p-2">
      <div className="flex items-center justify-center gap-2">
        <SettingsButton />
        <BugReportIcon />
        <ThemeToggle />
      </div>
    </div>
  )
}
