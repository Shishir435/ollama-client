import { useTranslation } from "react-i18next"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"

export const CharCount = ({ count }: { count: number }) => {
  const { t } = useTranslation()

  if (count === 0) return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="cursor-default font-mono text-xs text-muted-foreground">
          {count}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>
          {count} {t("chat.input.chars")}
        </p>
      </TooltipContent>
    </Tooltip>
  )
}
