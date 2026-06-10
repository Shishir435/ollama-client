import { useState } from "react"
import { useTranslation } from "react-i18next"

import { TooltipActionButton } from "@/components/actions"
import { chatIconBtnCls } from "@/features/chat/lib/chat-styles"
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
      className={chatIconBtnCls}
      onClick={handleCopy}
      icon={
        copied ? (
          <Check className="icon-xs text-status-success" />
        ) : (
          <Copy className="icon-xs" />
        )
      }
    />
  )
}
