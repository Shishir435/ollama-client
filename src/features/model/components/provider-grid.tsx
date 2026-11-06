import {
  CircleAlert,
  CircleCheck,
  CircleOff,
  CircleX,
  Plus
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { ProviderIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { MiniBadge } from "@/components/ui/mini-badge"
import type { ProviderHealthMap } from "@/features/model/hooks/use-provider-health"
import { useProviderIcons } from "@/features/model/hooks/use-provider-icons"
import { cn } from "@/lib/class-names"
import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
import { resolveProviderBrand } from "@/lib/providers/provider-brand"
import { isCustomProviderId, type ProviderConfig } from "@/lib/providers/types"

/**
 * Status glyph: a distinct shape per state, so the state is not carried by
 * color alone. The first rule that matches wins.
 */
const statusGlyphRules = [
  {
    test: (enabled: boolean) => !enabled,
    Icon: CircleOff,
    cls: "text-muted-foreground"
  },
  {
    test: (_enabled: boolean, hasFailed: boolean | undefined) => hasFailed,
    Icon: CircleX,
    cls: "text-status-danger-text"
  },
  {
    test: (
      _enabled: boolean,
      _hasFailed: boolean | undefined,
      isConnected: boolean | undefined
    ) => isConnected,
    Icon: CircleCheck,
    cls: "text-status-success-text"
  }
] as const

const getStatusGlyph = (
  enabled: boolean,
  hasFailed: boolean | undefined,
  isConnected: boolean | undefined
) =>
  statusGlyphRules.find((r) => r.test(enabled, hasFailed, isConnected)) ?? {
    Icon: CircleAlert,
    cls: "text-status-warning-text"
  }

/** The settings panel the selected provider tab controls. */
export const PROVIDER_PANEL_ID = "provider-config-panel"

export interface ProviderGridProps {
  providers: Array<Omit<ProviderConfig, "apiKey">>
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
  const providerIcons = useProviderIcons()

  /** Arrow keys move between provider tabs, as in any tab strip. */
  const moveTabFocus = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentId: string
  ) => {
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"]
    if (!keys.includes(event.key)) return
    const ids = providers.map((provider) => String(provider.id))
    const delta =
      event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1
    const nextId =
      ids[(ids.indexOf(currentId) + delta + ids.length) % ids.length]
    if (!nextId) return
    event.preventDefault()
    document.getElementById(`provider-tab-${nextId}`)?.focus()
    onSelect(nextId)
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div
        role="tablist"
        aria-label={t("settings.tabs.providers")}
        className="contents">
        {providers.map((provider) => {
          const isSelected = selectedId === provider.id
          const autoHealth = providerHealth[provider.id]
          const manual = isSelected ? manualTestStatus : null

          const status =
            manual || (autoHealth ? { success: autoHealth.success } : null)

          /*
           * A provider with no catalog is never contacted by the background
           * check — it answers from the remembered "nothing to discover", and
           * its model count comes from the ids the user declared. That is not a
           * live connection, so it gets the same amber "model IDs only" state
           * the settings header shows, rather than a green dot for a round trip
           * nobody made. An explicit test did reach the endpoint, so it wins.
           */
          const manualModelsOnly =
            !manual && autoHealth?.modelListSupported === false

          const isConnected = !manualModelsOnly && status?.success === true
          const hasFailed = !manualModelsOnly && status?.success === false
          const statusLabelKey = !provider.enabled
            ? "settings.providers.status_off"
            : hasFailed
              ? "settings.providers.connection_failed"
              : isConnected
                ? "settings.providers.connected"
                : manualModelsOnly
                  ? "settings.providers.manual_models"
                  : "settings.providers.not_tested"

          const statusGlyph = getStatusGlyph(
            provider.enabled,
            hasFailed,
            isConnected
          )
          const StatusGlyph = statusGlyph.Icon

          return (
            <div key={provider.id} role="presentation">
              <Button
                type="button"
                role="tab"
                id={`provider-tab-${provider.id}`}
                aria-selected={isSelected}
                aria-controls={PROVIDER_PANEL_ID}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => onSelect(provider.id)}
                onKeyDown={(event) => moveTabFocus(event, provider.id)}
                className={cn(
                  "h-11 w-full justify-start px-3 transition-colors",
                  isSelected
                    ? "border-primary/40 bg-state-selected text-accent-foreground"
                    : "border-stroke-control bg-card text-card-foreground hover:bg-state-hover"
                )}>
                <span className="flex items-center gap-2 min-w-0">
                  <StatusGlyph
                    aria-hidden
                    className={cn("icon-xs shrink-0", statusGlyph.cls)}
                  />

                  <ProviderIcon
                    providerId={String(provider.id)}
                    brand={resolveProviderBrand({
                      id: String(provider.id),
                      baseUrl: provider.baseUrl,
                      name: provider.name,
                      serviceProfile: provider.serviceProfile
                    })}
                    fallbackName={provider.name}
                    iconUrl={providerIcons[String(provider.id)]}
                    className="icon-sm shrink-0 text-muted-foreground"
                  />

                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="min-w-0 truncate font-medium"
                      title={provider.name}>
                      {provider.name}
                    </span>
                    <span className="sr-only">{t(statusLabelKey)}</span>

                    {provider.id === DEFAULT_PROVIDER_ID && (
                      <MiniBadge text={t("settings.providers.default")} />
                    )}

                    {isCustomProviderId(String(provider.id)) && (
                      <MiniBadge
                        text={t("settings.providers.add.custom_badge")}
                      />
                    )}
                  </span>
                </span>
              </Button>
            </div>
          )
        })}
      </div>

      <Button
        type="button"
        onClick={onAdd}
        data-settings-focus="true"
        data-settings-focus-id="provider-add"
        className="h-11 justify-start border-dashed px-3 text-muted-foreground transition-colors hover:text-foreground border-stroke-control bg-card hover:bg-state-hover">
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
