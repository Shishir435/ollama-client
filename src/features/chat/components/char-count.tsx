import { useTranslation } from "react-i18next"

import { SimpleTooltip } from "@/components/ui/simple-tooltip"

export const CharCount = ({ count }: { count: number }) => {
  const { t } = useTranslation()

  if (count === 0) return null

  return (
    <SimpleTooltip
      content={
        <p>
          {count} {t("chat.input.chars")}
        </p>
      }
      side="top"
      triggerRender={
        <div className="cursor-default font-mono text-xs text-muted-foreground" />
      }>
      {count}
    </SimpleTooltip>
  )
}
