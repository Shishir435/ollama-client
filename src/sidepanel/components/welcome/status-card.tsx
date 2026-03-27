import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { useProviderModels } from "@/features/model/hooks/use-provider-models"
import { AlertTriangle, CheckCircle, RefreshCw } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

export const StatusCard = () => {
  const { status, refresh } = useProviderModels()
  const { t } = useTranslation()

  const getStatusConfig = () => {
    switch (status) {
      case "loading":
        return {
          icon: RefreshCw,
          iconClass: "animate-spin",
          borderClass: "border-border",
          bgClass: "bg-muted-foreground",
          title: t("welcome.status.connecting.title"),
          message: t("welcome.status.connecting.message")
        }
      case "error":
        return {
          icon: AlertTriangle,
          iconClass: "",
          borderClass: "border-destructive/30",
          bgClass: "bg-destructive",
          title: t("welcome.status.connection_failed.title"),
          message: t("welcome.status.connection_failed.message")
        }
      case "empty":
        return {
          icon: AlertTriangle,
          iconClass: "",
          borderClass: "border-amber-500/30",
          bgClass: "bg-amber-500",
          title: t("welcome.status.no_models.title"),
          message: t("welcome.status.no_models.message")
        }
      case "ready":
        return {
          icon: CheckCircle,
          iconClass: "",
          borderClass: "border-emerald-500/30",
          bgClass: "bg-emerald-500",
          title: t("welcome.status.ready.title"),
          message: t("welcome.status.ready.message")
        }
      default:
        return null
    }
  }

  const statusConfig = getStatusConfig()

  if (!statusConfig) return null

  return (
    <div
      className={cn(
        "mb-4 w-full max-w-xl rounded-xl border bg-card p-4 text-card-foreground shadow-sm",
        statusConfig.borderClass
      )}>
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "shrink-0 rounded-full p-2 text-white",
            statusConfig.bgClass
          )}>
          <statusConfig.icon
            className={cn("h-4 w-4 text-white", statusConfig.iconClass)}
          />
        </div>
        <div className="flex-1 text-left">
          <p className="mb-0.5 text-sm font-semibold text-foreground">
            {statusConfig.title}
          </p>
          <p
            className={cn(
              "text-xs text-muted-foreground",
              status === "error" ? "mb-3" : "mb-0"
            )}>
            {statusConfig.message}
          </p>
          {status === "error" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => refresh()}
              className="border-destructive/40 text-destructive hover:bg-destructive/10">
              <RefreshCw className="mr-1 h-3 w-3" />
              {t("common.actions.retry")}
            </Button>
          )}
          {status === "empty" && (
            <p className="text-xs text-muted-foreground">
              {t("welcome.setup_guide.hint")}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
