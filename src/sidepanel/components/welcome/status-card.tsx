import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle
} from "@/components/ui/card"
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
          bgClass: "bg-status-info",
          iconFgClass: "text-status-info-foreground",
          title: t("welcome.status.connecting.title"),
          message: t("welcome.status.connecting.message")
        }
      case "error":
        return {
          icon: AlertTriangle,
          iconClass: "",
          borderClass: "border-destructive/30",
          bgClass: "bg-status-danger",
          iconFgClass: "text-status-danger-foreground",
          title: t("welcome.status.connection_failed.title"),
          message: t("welcome.status.connection_failed.message")
        }
      case "empty":
        return {
          icon: AlertTriangle,
          iconClass: "",
          borderClass: "border-status-warning/30",
          bgClass: "bg-status-warning",
          iconFgClass: "text-status-warning-foreground",
          title: t("welcome.status.no_models.title"),
          message: t("welcome.status.no_models.message")
        }
      case "ready":
        return {
          icon: CheckCircle,
          iconClass: "",
          borderClass: "border-status-success/30",
          bgClass: "bg-status-success",
          iconFgClass: "text-status-success-foreground",
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
    <Card
      className={cn(
        "mb-4 min-h-min w-full max-w-xl shadow-sm ring-0 border",
        statusConfig.borderClass
      )}>
      <CardContent className="flex items-center gap-3">
        <div
          className={cn(
            "shrink-0 rounded-full p-2",
            statusConfig.bgClass,
            statusConfig.iconFgClass
          )}>
          <statusConfig.icon
            className={cn("icon-md", statusConfig.iconClass)}
          />
        </div>
        <div className="flex-1 text-left space-y-1">
          <CardTitle className="font-semibold">{statusConfig.title}</CardTitle>
          <CardDescription className={cn(status === "error" && "mb-3")}>
            {statusConfig.message}
          </CardDescription>
          {status === "error" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => refresh()}
              className="border-destructive/40 text-destructive hover:bg-destructive/10">
              <RefreshCw className="mr-1 icon-xs" />
              {t("common.actions.retry")}
            </Button>
          )}
          {status === "empty" && (
            <CardDescription>{t("welcome.setup_guide.hint")}</CardDescription>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
