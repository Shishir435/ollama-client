import { useState } from "react"
import { useTranslation } from "react-i18next"

import { TooltipActionButton } from "@/components/actions"
import { logger } from "@/lib/logger"
import { Check, Copy } from "@/lib/lucide-icon"

export const CopyButton = ({ text }: { text: string }) => {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard
      .writeText(text)
      .catch((err) =>
        logger.error("Clipboard write failed", "CopyButton", { error: err })
      )
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <TooltipActionButton
      ariaLabel={t("chat.actions.copy")}
      tooltip={copied ? t("chat.actions.copied") : t("chat.actions.copy")}
      size="icon"
      variant="ghost"
      className="size-7 rounded-control text-muted-foreground hover:bg-muted/55 hover:text-foreground"
      onClick={handleCopy}
      icon={
        copied ? (
          <Check className="size-4 text-status-success" />
        ) : (
          <Copy className="size-4" />
        )
      }
    />
  )
}
