import { BugReportIcon } from "@/components/bug-report-icon"
import { SettingsButton } from "@/components/settings-button"
import { ThemeToggle } from "@/components/theme-toggle"

export const ChatSessionFooter = () => {
  return (
    <div className="border-t border-sidebar-border p-2">
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        <SettingsButton />
        <BugReportIcon />
        <ThemeToggle />
      </div>
    </div>
  )
}
