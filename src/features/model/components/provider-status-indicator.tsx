import { useEffect } from "react"
import { useTranslation } from "react-i18next"

import { TooltipActionButton } from "@/components/actions"
import { useProviderModels } from "@/features/model/hooks/use-provider-models"
import {
  AlertTriangle,
  CheckCircle,
  Loader2,
  RefreshCw,
  XCircle
} from "@/lib/lucide-icon"
import { STATUS_STYLES } from "@/lib/ui-status"
import { cn } from "@/lib/utils"

const iconMap = {
  loading: (
    <Loader2
      className={cn("size-4 animate-spin", STATUS_STYLES.neutral.text)}
    />
  ),
  error: <XCircle className={cn("size-4", STATUS_STYLES.danger.text)} />,
  empty: <AlertTriangle className={cn("size-4", STATUS_STYLES.warning.text)} />,
  ready: <CheckCircle className={cn("size-4", STATUS_STYLES.success.text)} />
}

export const ProviderStatusIndicator = () => {
  const { t } = useTranslation()
  const { status, refresh, error } = useProviderModels()

  const getLabelMap = () => ({
    loading: t("model.provider_status.checking"),
    error: t("model.provider_status.error"),
    empty: t("model.provider_status.empty"),
    ready: t("model.provider_status.ready")
  })

  useEffect(() => {
    // Auto-refresh every 10 seconds
    const interval = setInterval(() => {
      refresh()
    }, 10_000)

    return () => clearInterval(interval)
  }, [refresh])

  return (
    <TooltipActionButton
      variant="secondary"
      size="icon"
      onClick={() => refresh()}
      className="m-1 rounded-lg border border-border/50 bg-card shadow-xs transition-all duration-200 hover:bg-accent/50"
      ariaLabel={getLabelMap()[status]}
      tooltipSide="left"
      icon={iconMap[status]}
      tooltip={
        <>
          <div className="flex items-center gap-2 text-sm">
            <span>{getLabelMap()[status]}</span>
            {status !== "loading" && (
              <RefreshCw
                className="size-3.5 cursor-pointer text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation()
                  refresh()
                }}
              />
            )}
          </div>
          {status === "error" && error && (
            <div
              className={cn(
                "mt-1 max-w-xs text-xs",
                STATUS_STYLES.danger.text
              )}>
              {error}
            </div>
          )}
        </>
      }
    />
  )
}
