import { Scissors } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { openOptionsInTab, runtime } from "@/lib/browser-api"
import type { ChatMessage } from "@/types"

/** Whether the page text this answer saw was cut to fit the model's window. */
export const wasPageContextTrimmed = (message: ChatMessage): boolean =>
  message.role === "assistant" && message.metrics?.tabContextTruncated === true

/**
 * Says so when the page the answer was built from did not fit, with the way to
 * a larger window. Quiet by design — one line under the answer — because the
 * answer may be fine; it only has to be knowable that it saw part of the page.
 */
export const ContextTrimmedNotice = () => {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-x-2 px-2 pt-0.5 pb-1 text-micro text-muted-foreground">
      <Scissors aria-hidden="true" className="icon-xs shrink-0" />
      <span>{t("chat.context.trimmed")}</span>
      <Button
        type="button"
        variant="link"
        className="h-auto p-0 text-micro"
        onClick={() =>
          void openOptionsInTab(
            runtime.getURL("options.html?tab=models&focus=num-ctx")
          )
        }>
        {t("chat.context.trimmed_action")}
      </Button>
    </div>
  )
}
