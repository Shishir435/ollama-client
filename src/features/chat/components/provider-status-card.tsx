import { PackageOpen, RefreshCw, ServerOff } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { SetupGuideLink } from "@/components/setup-guide-link"
import { Button } from "@/components/ui/button"
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
 * Drawn like an onboarding step — a quiet card with a tinted glyph — because
 * a stopped local server is a setup step, not an alarm.
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
  /**
   * A background catalog poll reports "loading" for its duration. The card
   * holds the last settled answer through it rather than blinking out every
   * poll, and the setup sheet below is mounted regardless, so a poll never
   * discards a half-edited provider form.
   */
  const [settled, setSettled] = useState(status)
  if (status !== "loading" && status !== settled) setSettled(status)
  const blocked = settled === "error" || settled === "empty"

  const unreachable = settled === "error"
  const Icon = unreachable ? ServerOff : PackageOpen
  const title = unreachable
    ? t("welcome.status.connection_failed.title", {
        provider: unreachableName ?? t("welcome.status.provider_fallback")
      })
    : t("welcome.status.no_models.title")
  const message = unreachable
    ? t("welcome.status.connection_failed.message")
    : t(
        ollamaEnabled
          ? "welcome.status.no_models.message"
          : "welcome.status.no_models.message_generic"
      )

  return (
    <>
      {blocked && (
        <output
          aria-atomic="true"
          aria-live="polite"
          className="flex w-full max-w-sm flex-col gap-4 rounded-panel border border-border bg-card p-4 text-card-foreground shadow-sm">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-control",
                unreachable
                  ? "bg-tint-danger text-destructive"
                  : "bg-tint-warning text-foreground"
              )}>
              <Icon className="icon-md" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-semibold">{title}</p>
              <p className="text-xs text-muted-foreground">{message}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => setSetupOpen(true)}>
              {t("onboarding.provider.open_setup")}
            </Button>
            <Button variant="outline" onClick={() => refresh()}>
              <RefreshCw className="icon-xs" />
              {t("common.actions.retry")}
            </Button>
          </div>
          <SetupGuideLink className="h-auto self-center px-0 text-xs" />
        </output>
      )}
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
