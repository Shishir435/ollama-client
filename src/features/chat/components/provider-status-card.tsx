import { AlertTriangle, RefreshCw } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { SetupGuideLink } from "@/components/setup-guide-link"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle
} from "@/components/ui/card"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet"
import { ProviderSettings } from "@/features/model/components/provider-settings"
import { useProviderModels } from "@/features/model/hooks/use-provider-models"
import { cn } from "@/lib/class-names"

/**
 * Why the panel can't chat yet, with the way out. Says nothing while
 * connecting or once a provider answers: the composer is the ready state.
 */
export const ProviderStatusCard = () => {
  const {
    status,
    refresh,
    unavailableProviders = [],
    ollamaEnabled
  } = useProviderModels()
  const unreachableName = unavailableProviders[0]?.providerName
  const { t } = useTranslation()
  const [setupOpen, setSetupOpen] = useState(false)

  const getStatusConfig = () => {
    switch (status) {
      case "error":
        return {
          icon: AlertTriangle,
          iconClass: "",
          borderClass: "border-destructive/30",
          bgClass: "bg-status-danger",
          iconFgClass: "text-status-danger-foreground",
          title: t("welcome.status.connection_failed.title", {
            provider: unreachableName ?? t("welcome.status.provider_fallback")
          }),
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
          message: t(
            ollamaEnabled
              ? "welcome.status.no_models.message"
              : "welcome.status.no_models.message_generic"
          )
        }
      default:
        return null
    }
  }

  const statusConfig = getStatusConfig()

  if (!statusConfig) return null

  return (
    <>
      <Card
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- A live region announcing provider status, not a calculated form output.
        role="status"
        aria-live="polite"
        className={cn(
          "min-h-min w-full max-w-xl shadow-sm ring-0 border",
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
            <CardTitle className="font-semibold">
              {statusConfig.title}
            </CardTitle>
            <CardDescription className={cn(status === "error" && "mb-3")}>
              {statusConfig.message}
            </CardDescription>
            {status === "error" && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => refresh()}
                  className="border-destructive/40 text-destructive hover:bg-tint-danger-hover">
                  <RefreshCw className="mr-1 icon-xs" />
                  {t("common.actions.retry")}
                </Button>
                <Button size="sm" onClick={() => setSetupOpen(true)}>
                  {t("onboarding.provider.open_setup")}
                </Button>
              </div>
            )}
            {status === "empty" && (
              <div className="space-y-2">
                <CardDescription>
                  {t("welcome.setup_guide.hint")}
                </CardDescription>
                <Button size="sm" onClick={() => setSetupOpen(true)}>
                  {t("onboarding.provider.open_setup")}
                </Button>
              </div>
            )}
            <SetupGuideLink className="h-auto px-0 text-xs" />
          </div>
        </CardContent>
      </Card>
      <Sheet open={setupOpen} onOpenChange={setSetupOpen}>
        <SheetContent
          side="right"
          className="w-[min(42rem,calc(100vw-0.5rem))] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t("onboarding.provider.title")}</SheetTitle>
          </SheetHeader>
          <div className="mt-4">
            <ProviderSettings />
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
