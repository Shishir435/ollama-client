import { ChevronLeft } from "lucide-react"
import type React from "react"
import { useTranslation } from "react-i18next"

import { TooltipActionButton } from "@/components/actions"

interface ContextSubViewProps {
  title: string
  onBack: () => void
  /** Trailing header content: character counts, a copy button. */
  headerActions?: React.ReactNode
  children: React.ReactNode
}

/**
 * A sheet view that replaces the main panel rather than opening a second sheet,
 * so the user never loses their place in the Context sheet. The back button is
 * the only way out, which is why it is part of the shell instead of each view.
 */
export const ContextSubView = ({
  title,
  onBack,
  headerActions,
  children
}: ContextSubViewProps) => {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <TooltipActionButton
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 rounded-control text-muted-foreground hover:text-foreground"
          onClick={onBack}
          label={t("common.actions.back")}
          icon={<ChevronLeft className="icon-sm" />}
        />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {title}
        </span>
        {headerActions}
      </div>
      {children}
    </div>
  )
}
