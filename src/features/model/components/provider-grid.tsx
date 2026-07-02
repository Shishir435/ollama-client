import { useTranslation } from "react-i18next"

import { TooltipActionButton } from "@/components/actions"
import { Button } from "@/components/ui/button"
import { MiniBadge } from "@/components/ui/mini-badge"
import type { ProviderHealthMap } from "@/features/model/hooks/use-provider-health"
import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
import { Info, Plus } from "@/lib/lucide-icon"
import { isBetaProvider } from "@/lib/providers/registry"
import { isCustomProviderId, type ProviderConfig } from "@/lib/providers/types"
import { cn } from "@/lib/utils"

// Status dot color is picked by the first rule that matches.
const dotStatusRules = [
  { test: (enabled: boolean) => !enabled, cls: "bg-muted-foreground/40" },
  {
    test: (_enabled: boolean, hasFailed: boolean | undefined) => hasFailed,
    cls: "bg-status-danger"
  },
  {
    test: (
      _enabled: boolean,
      _hasFailed: boolean | undefined,
      isConnected: boolean | undefined
    ) => isConnected,
    cls: "bg-status-success"
  }
] as const

const getStatusDotClass = (
  enabled: boolean,
  hasFailed: boolean | undefined,
  isConnected: boolean | undefined
): string =>
  dotStatusRules.find((r) => r.test(enabled, hasFailed, isConnected))?.cls ??
  "bg-status-warning"

export interface ProviderGridProps {
  providers: ProviderConfig[]
  selectedId: string
  providerHealth: ProviderHealthMap
  manualTestStatus: { success: boolean; message: string } | null
  onSelect: (id: string) => void
  onAdd: () => void
}

/**
 * Top-of-screen picker for the active provider. Each tile shows the
 * provider's enabled/health state via a colored dot and badges for
 * beta status / default-provider marker.
 *
 * Status precedence: a manual test (only relevant to the currently
 * selected provider) wins over the periodic auto-health result.
 */
export const ProviderGrid = ({
  providers,
  selectedId,
  providerHealth,
  manualTestStatus,
  onSelect,
  onAdd
}: ProviderGridProps) => {
  const { t } = useTranslation()

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {providers.map((provider) => {
        const isSelected = selectedId === provider.id
        const autoHealth = providerHealth[provider.id]
        const manual = isSelected ? manualTestStatus : null

        const status =
          manual || (autoHealth ? { success: autoHealth.success } : null)

        const isConnected = status?.success === true
        const hasFailed = status?.success === false

        return (
          <Button
            key={provider.id}
            type="button"
            onClick={() => onSelect(provider.id)}
            className={cn(
              "h-11 justify-start px-3 transition-colors",
              isSelected
                ? "border-primary/40 bg-accent/20 text-accent-foreground"
                : "border-border bg-card text-card-foreground hover:bg-accent/10"
            )}>
            <span className="flex items-center gap-2 min-w-0">
              <span
                className={cn(
                  "inline-block size-2.5 shrink-0 rounded-full",
                  getStatusDotClass(provider.enabled, hasFailed, isConnected)
                )}
              />

              <span className="flex items-center gap-1.5 min-w-0">
                <span className="font-medium truncate">{provider.name}</span>

                {isBetaProvider(provider.id) && (
                  <>
                    <MiniBadge text={t("settings.providers.beta_badge")} />
                    <TooltipActionButton
                      trigger={
                        <span className="inline-flex text-muted-foreground/60 transition-colors hover:text-foreground" />
                      }
                      icon={Info}
                      iconClassName="icon-xs"
                      label={t("settings.providers.beta_notice")}
                      tooltipClassName="max-w-xs text-xs"
                    />
                  </>
                )}

                {provider.id === DEFAULT_PROVIDER_ID && (
                  <MiniBadge text={t("settings.providers.default")} />
                )}

                {isCustomProviderId(String(provider.id)) && (
                  <MiniBadge text={t("settings.providers.add.custom_badge")} />
                )}
              </span>
            </span>
          </Button>
        )
      })}

      <Button
        type="button"
        onClick={onAdd}
        data-settings-focus="true"
        data-settings-focus-id="provider-add"
        className="h-11 justify-start border-dashed px-3 text-muted-foreground transition-colors hover:text-foreground border-border bg-card hover:bg-accent/10">
        <span className="flex items-center gap-2">
          <Plus className="icon-sm" />
          <span className="font-medium">
            {t("settings.providers.add.button")}
          </span>
        </span>
      </Button>
    </div>
  )
}
