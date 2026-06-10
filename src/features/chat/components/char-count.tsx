import { useTranslation } from "react-i18next"

import { TooltipActionButton } from "@/components/actions"

export const CharCount = ({ count }: { count: number }) => {
  const { t } = useTranslation()

  if (count === 0) return null

  return (
    <TooltipActionButton
      trigger={
        <div className="cursor-default font-mono text-xs text-muted-foreground" />
      }
      tooltip={
        <p>
          {count} {t("chat.input.chars")}
        </p>
      }
      tooltipSide="top"
      showLabel
      label={count}
    />
  )
}
