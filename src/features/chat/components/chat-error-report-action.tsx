import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { openExternalUrl } from "@/lib/browser-api"
import { buildChatMessageErrorReportUrl } from "@/lib/error-report"
import { Bug } from "@/lib/lucide-icon"
import type { ChatMessage } from "@/types"

export const ChatErrorReportAction = ({ msg }: { msg: ChatMessage }) => {
  const { t } = useTranslation()
  const reportUrl = buildChatMessageErrorReportUrl(msg)

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
      <Button
        variant="outline"
        size="sm"
        onClick={() => openExternalUrl(reportUrl)}>
        <Bug className="icon-xs" />
        {t("chat.errors.open_issue")}
      </Button>
      <span className="text-micro text-muted-foreground">
        {t("chat.errors.issue_draft_notice")}
      </span>
    </div>
  )
}
