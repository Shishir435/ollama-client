import { useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { Check, Copy } from "@/lib/lucide-icon"

export const CopyButton = ({ text }: { text: string }) => {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(text).catch((err) => console.error(err))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label="copy"
            size="icon"
            variant="ghost"
            className="size-4"
            onClick={handleCopy}
          />
        }>
        {copied ? (
          <Check className="size-3.5 text-status-success" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </TooltipTrigger>
      <TooltipContent>
        {copied ? t("chat.actions.copied") : t("chat.actions.copy")}
      </TooltipContent>
    </Tooltip>
  )
}
