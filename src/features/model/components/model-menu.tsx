import { MODEL_DISCOVERY_FAILURE } from "@ollama-client/contracts/provider-rpc"
import { RpcMethod } from "@ollama-client/contracts/rpc"
import {
  ArrowDownAZ,
  ArrowDownZA,
  Check,
  ChevronDown,
  Layers3,
  type LucideIcon,
  RotateCcw,
  Search,
  SlidersHorizontal
} from "lucide-react"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import { TooltipActionButton } from "@/components/actions"
import { ProviderIcon } from "@/components/icons"
import { ListRow, ListRowTitleButton } from "@/components/layout/list-row"
import {
  SCROLL_REGION_FOCUS_CLASS,
  scrollRegionProps
} from "@/components/layout/scroll-region"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { useModelCapabilityOverrides } from "@/features/model/hooks/use-model-capability-overrides"
import {
  modelTagsKey,
  useModelCapabilityTags
} from "@/features/model/hooks/use-model-capability-tags"
import { useProviderIcons } from "@/features/model/hooks/use-provider-icons"
import { useProviderModels } from "@/features/model/hooks/use-provider-models"
import { useSetting } from "@/hooks/use-setting"
import { cn } from "@/lib/class-names"
import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { getModelCapabilities } from "@/lib/providers/capabilities"
import {
  type ProviderBrandId,
  resolveModelBrand
} from "@/lib/providers/provider-brand"
import { isOllamaCloudModel } from "@/lib/providers/provider-errors"
import { getProviderDisplayName } from "@/lib/providers/registry"
import { writeSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"
import { extensionRpcClient } from "@/protocol/extension-client"
import {
  formatFileSize,
  formatParameterSize,
  getModelIcon,
  isEmbeddingModel
} from "../lib/model-utils"
import { ModelCapabilityBadges } from "./model-capabilities/capability-badges"
import { ModelCapabilitySheet } from "./model-capabilities/capability-sheet"

/**
 * The glyph for one model row.
 *
 * Across every provider the provider's mark is what tells two same-named
 * models apart, so it takes the slot. Inside a single provider that mark is
 * identical on every row and says nothing, so the model's own vendor takes it
 * instead where its id names one — five models under one heading wore five
 * identical generic glyphs while each id had stated its vendor in plain text
 * above them the whole time. A namespace with no mark of its own keeps the
 * generic icon rather than borrowing somebody's logo.
 */
/**
 * An icon-only rail button that names itself on hover and on keyboard focus.
 * A native `title` only appears for a pointer, so a keyboard user tabbing the
 * rail saw a column of unlabeled glyphs.
 */
const RailButton = ({
  label,
  ariaLabel,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"button">, "aria-label" | "title"> & {
  label: string
  ariaLabel?: string
}) => (
  <Tooltip>
    <TooltipTrigger
      render={
        <button
          type="button"
          aria-label={ariaLabel ?? label}
          className={className}
          {...props}
        />
      }>
      {children}
    </TooltipTrigger>
    <TooltipContent side="right">{label}</TooltipContent>
  </Tooltip>
)

const ModelRowIcon = ({
  scoped,
  providerId,
  providerBrand,
  providerName,
  providerIconUrl,
  modelBrand,
  FallbackIcon
}: {
  scoped: boolean
  providerId: string
  providerBrand?: string
  providerName?: string
  providerIconUrl?: string
  modelBrand?: ProviderBrandId
  FallbackIcon: LucideIcon
}) => {
  if (!scoped) {
    return (
      <ProviderIcon
        providerId={providerId}
        brand={providerBrand}
        fallbackName={providerName}
        iconUrl={providerIconUrl}
        className="icon-sm text-muted-foreground"
      />
    )
  }
  if (modelBrand) {
    return (
      <ProviderIcon
        brand={modelBrand}
        className="icon-sm text-muted-foreground"
      />
    )
  }
  return <FallbackIcon className="icon-sm text-muted-foreground" />
}

export interface ModelMenuProps {
  trigger?: React.ReactNode
  onSelectModel?: (model: string) => void
  tooltipTextContent: string
  showStatusPopup?: boolean
}

export const ModelMenu = ({
  trigger,
  onSelectModel: _onSelectModel,
  tooltipTextContent,
  showStatusPopup: _showStatusPopup = true
}: ModelMenuProps) => {
  const { t } = useTranslation()
  const [open, setOpenState] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc")
  /** The row the arrow keys are on; focus itself stays in the search box. */
  const [highlightIndex, setHighlightIndex] = useState(0)
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const listId = useId()
  const {
    models,
    refresh,
    refreshProvider,
    refreshStale,
    isLoading,
    selectedModel,
    selectedModelRef,
    setSelectedModel,
    selectionConflictModel,
    clearSelectionConflict,
    unavailableProviders,
    ollamaEnabled
  } = useProviderModels()
  /** Opening the menu re-asks any provider whose list has gone stale. */
  const setOpen = (next: boolean) => {
    setOpenState(next)
    if (next) void refreshStale()
  }

  const providerFailureNames = (unreachable: boolean) =>
    unavailableProviders
      .filter(
        (failure) =>
          (failure.code === MODEL_DISCOVERY_FAILURE.REQUEST_FAILED) ===
          unreachable
      )
      .map(
        (failure) =>
          failure.providerName || getProviderDisplayName(failure.providerId)
      )
      .join(", ")
  const unreachableProviderNames = providerFailureNames(true)
  const emptyProviderNames = providerFailureNames(false)

  const [cloudModels] = useSetting(SETTINGS.OLLAMA_CLOUD_MODELS)
  /**
   * The provider reads the switch when it lists, so the list is fetched again
   * once the new value is stored rather than filtered here; the switch
   * follows through the storage watch. Only Ollama reads it, so only
   * Ollama's catalog is asked again — a full refresh is a request against
   * every enabled provider, hosted ones included.
   */
  const toggleCloudModels = async (next: boolean) => {
    await writeSetting(SETTINGS.OLLAMA_CLOUD_MODELS, next)
    await refreshProvider(DEFAULT_PROVIDER_ID)
  }

  const { resolve, getOverride, getProbe, setOverride, clearOverride } =
    useModelCapabilityOverrides()

  // Site icons for providers with no curated mark; empty for everyone else.
  const providerIcons = useProviderIcons()

  /**
   * Model whose capability sheet is open. Held by name+provider so the sheet
   * survives the popover closing underneath it.
   */
  const [capabilityTarget, setCapabilityTarget] = useState<{
    model: string
    providerId: string
  } | null>(null)

  // Keep the selected sheet's evidence live after its menu closes.
  const capabilityTags = useModelCapabilityTags(models, open, capabilityTarget)

  const openCapabilitySheet = (model: string, providerId: string) => {
    setOpen(false)
    setCapabilityTarget({ model, providerId })
  }

  const chatModels = useMemo(
    () =>
      models.filter(
        (model) => !isEmbeddingModel(model.name, model.details?.families || [])
      ),
    [models]
  )

  /**
   * Ollama keeps its place in the rail with no local models: its cloud switch
   * lives on its page, and an empty `/api/tags` is exactly when someone wants
   * to turn cloud models on.
   */
  const providerGroups = useMemo(
    () =>
      chatModels.reduce(
        (groups, model) => {
          const providerId = model.providerId || DEFAULT_PROVIDER_ID
          const providerName =
            model.providerName || getProviderDisplayName(providerId)
          if (!groups[providerId]) {
            groups[providerId] = {
              name: providerName,
              brand: model.providerBrand,
              models: []
            }
          }
          groups[providerId].models.push(model)
          return groups
        },
        {} as Record<
          string,
          { name: string; brand?: string; models: typeof models }
        >
      ),
    [chatModels]
  )
  const railGroups = useMemo(
    () =>
      ollamaEnabled && !providerGroups[DEFAULT_PROVIDER_ID]
        ? {
            [DEFAULT_PROVIDER_ID]: {
              name: getProviderDisplayName(DEFAULT_PROVIDER_ID),
              models: [] as typeof models
            },
            ...providerGroups
          }
        : providerGroups,
    [ollamaEnabled, providerGroups]
  )
  const providerEntries = useMemo(
    () => Object.entries(railGroups),
    [railGroups]
  )
  const selectedProviderId =
    selectedModelRef?.providerId ||
    chatModels.find((model) => model.name === selectedModel)?.providerId ||
    DEFAULT_PROVIDER_ID

  const fallbackProviderId =
    (railGroups[selectedProviderId]?.models.length
      ? selectedProviderId
      : null) ??
    providerEntries.find(([, group]) => group.models.length > 0)?.[0] ??
    (railGroups[selectedProviderId] ? selectedProviderId : null)
  const effectiveActiveProviderId =
    activeProviderId === null || railGroups[activeProviderId]
      ? activeProviderId
      : fallbackProviderId

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) return
    setSearchQuery("")
    setActiveProviderId((current) => {
      if (current && railGroups[current]) return current
      return railGroups[selectedProviderId] ? selectedProviderId : null
    })
  }

  useEffect(() => {
    if (open) searchInputRef.current?.focus()
  }, [open])

  const visibleModels = useMemo(() => {
    const providerModels = effectiveActiveProviderId
      ? (providerGroups[effectiveActiveProviderId]?.models ?? [])
      : chatModels
    const query = searchQuery.trim().toLocaleLowerCase()
    const matching = query
      ? providerModels.filter((model) =>
          model.name.toLocaleLowerCase().includes(query)
        )
      : providerModels
    return [...matching].sort((left, right) => {
      const order =
        left.name.localeCompare(right.name, "en", {
          numeric: true,
          sensitivity: "base"
        }) ||
        left.name.localeCompare(right.name, "en", { sensitivity: "variant" }) ||
        (left.providerId || DEFAULT_PROVIDER_ID).localeCompare(
          right.providerId || DEFAULT_PROVIDER_ID,
          "en"
        )
      return sortDirection === "asc" ? order : -order
    })
  }, [
    effectiveActiveProviderId,
    chatModels,
    providerGroups,
    searchQuery,
    sortDirection
  ])
  const sortActionLabel = t(
    sortDirection === "asc" ? "model.menu.sort_za" : "model.menu.sort_az"
  )
  const modelKey = (model: (typeof visibleModels)[number]) =>
    `${model.providerId || DEFAULT_PROVIDER_ID}:${model.name}`
  const activeRowIndex = Math.max(
    0,
    Math.min(highlightIndex, visibleModels.length - 1)
  )
  const activeRow = visibleModels[activeRowIndex]
  const moveHighlight = (next: number) => {
    const bounded = Math.max(0, Math.min(next, visibleModels.length - 1))
    setHighlightIndex(bounded)
    virtuosoRef.current?.scrollIntoView({ index: bounded, behavior: "auto" })
  }

  const duplicateModelNames = useMemo(() => {
    const counts = new Map<string, number>()
    for (const model of chatModels) {
      counts.set(model.name, (counts.get(model.name) ?? 0) + 1)
    }
    return new Set(
      [...counts.entries()]
        .filter(([, count]) => count > 1)
        .map(([name]) => name)
    )
  }, [chatModels])

  const handleSelect = async (modelName: string, providerId?: string) => {
    const previousModel = selectedModel
    const previousProviderId = selectedModelRef?.providerId
    if (_onSelectModel) {
      _onSelectModel(modelName)
    } else {
      await setSelectedModel(modelName, providerId)
      if (selectionConflictModel) {
        await clearSelectionConflict()
      }
    }
    setOpen(false)

    if (
      modelName &&
      (modelName !== previousModel || providerId !== previousProviderId)
    ) {
      /**
       * Fire-and-forget: warmup is an optimization, and the user has already
       * been given the newly selected model.
       */
      extensionRpcClient
        .call(RpcMethod.ModelsWarmup, {
          model: modelName,
          ...(providerId && { providerId }),
          ...(previousModel && { previousModel }),
          ...(previousProviderId && { previousProviderId })
        })
        .catch((error) => {
          logger.warn("Failed to trigger model warmup", "ModelMenu", { error })
        })
    }
  }

  if (!models) return null

  const targetModelData = capabilityTarget
    ? models.find(
        (m) =>
          m.name === capabilityTarget.model &&
          (m.providerId || DEFAULT_PROVIDER_ID) === capabilityTarget.providerId
      )
    : undefined
  const targetTags = capabilityTarget
    ? capabilityTags[
        modelTagsKey(capabilityTarget.providerId, capabilityTarget.model)
      ]
    : undefined
  // Detection + probe (no override) — the "reset to detected" target.
  const targetDetected = capabilityTarget
    ? getModelCapabilities({
        providerId: capabilityTarget.providerId,
        ollamaCapabilities: targetTags,
        lmStudioModelType: targetModelData?.capabilityHints?.modelType,
        capabilityTags: targetModelData?.capabilityHints?.capabilityTags,
        contextLength: targetModelData?.capabilityHints?.contextLength,
        modalities: targetModelData?.capabilityHints?.modalities,
        outputModalities: targetModelData?.capabilityHints?.outputModalities,
        supportedParameters:
          targetModelData?.capabilityHints?.supportedParameters,
        probed: getProbe(capabilityTarget.providerId, capabilityTarget.model)
      })
    : null
  /**
   * Effective capabilities (override applied) — seeds the sheet toggles so they
   * match what the menu badges show.
   */
  const targetCurrent = capabilityTarget
    ? getModelCapabilities({
        providerId: capabilityTarget.providerId,
        ollamaCapabilities: targetTags,
        lmStudioModelType: targetModelData?.capabilityHints?.modelType,
        capabilityTags: targetModelData?.capabilityHints?.capabilityTags,
        contextLength: targetModelData?.capabilityHints?.contextLength,
        modalities: targetModelData?.capabilityHints?.modalities,
        outputModalities: targetModelData?.capabilityHints?.outputModalities,
        supportedParameters:
          targetModelData?.capabilityHints?.supportedParameters,
        override: getOverride(
          capabilityTarget.providerId,
          capabilityTarget.model
        ),
        probed: getProbe(capabilityTarget.providerId, capabilityTarget.model)
      })
    : null

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <TooltipActionButton
          trigger={
            trigger ? (
              <PopoverTrigger
                aria-label={tooltipTextContent}
                render={trigger as React.ReactElement}
              />
            ) : (
              <PopoverTrigger
                aria-label={tooltipTextContent}
                render={
                  <Button
                    variant="ghost"
                    aria-expanded={open}
                    className="h-8 min-w-0 max-w-full justify-between gap-1.5 rounded-panel px-2 font-medium items-center transition-all"
                  />
                }
              />
            )
          }
          tooltip={tooltipTextContent}
          icon={
            trigger ? undefined : (
              <>
                {selectedModel ? (
                  <div className="flex min-w-0 items-center gap-1.5">
                    {(() => {
                      /*
                       * The same vendor mark the menu row wears. The trigger
                       * kept the generic glyph, so choosing an OpenAI-marked
                       * model closed the menu and put a robot back in its
                       * place — the one row that has to agree with the list.
                       */
                      const SelectedModelIcon = getModelIcon(selectedModel)
                      const selectedBrand = resolveModelBrand(selectedModel)
                      return selectedBrand ? (
                        <ProviderIcon
                          brand={selectedBrand}
                          className="icon-md shrink-0 text-muted-foreground"
                        />
                      ) : (
                        <SelectedModelIcon className="icon-md shrink-0 text-muted-foreground" />
                      )
                    })()}
                    <span className="max-w-36 truncate font-medium">
                      {(() => {
                        const name =
                          models.find((m) => m.name === selectedModel)?.name ||
                          selectedModel
                        /**
                         * A vendor prefix the mark beside it already shows is
                         * dropped, so the narrow trigger spends its width on
                         * the model. The tooltip keeps the full id.
                         */
                        return resolveModelBrand(name)
                          ? name.slice(name.indexOf("/") + 1)
                          : name
                      })()}
                    </span>
                  </div>
                ) : (
                  <span className="min-w-0 truncate text-muted-foreground">
                    {t("model.menu.select_placeholder")}
                  </span>
                )}
                <ChevronDown className="icon-md shrink-0 opacity-50" />
              </>
            )
          }
        />

        <PopoverContent
          aria-label={t("chat.input.switch_model")}
          className="w-[calc(100vw-1rem)] max-w-96 overflow-hidden p-0"
          align="start">
          <div className="flex h-96 min-h-0 overflow-hidden rounded-panel bg-popover text-popover-foreground">
            <nav
              aria-label={t("settings.tabs.providers")}
              className="flex w-12 shrink-0 flex-col items-center gap-1 overflow-hidden border-r border-border bg-surface-sunken p-1.5">
              <RailButton
                label={t("model.menu.models_label")}
                aria-pressed={effectiveActiveProviderId === null}
                onClick={() => {
                  setActiveProviderId(null)
                  setSearchQuery("")
                  setHighlightIndex(0)
                }}
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  effectiveActiveProviderId === null &&
                    "bg-state-selected text-foreground shadow-sm"
                )}>
                <Layers3 className="icon-md" />
              </RailButton>

              <div className="my-0.5 h-px w-7 shrink-0 bg-border/60" />

              <div
                data-testid="provider-rail-scroll"
                className="flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto scrollbar-none">
                {providerEntries.map(([providerId, group]) => {
                  const isActive = effectiveActiveProviderId === providerId
                  return (
                    <RailButton
                      key={providerId}
                      label={`${group.name} · ${group.models.length}`}
                      ariaLabel={group.name}
                      aria-pressed={isActive}
                      onClick={() => {
                        setActiveProviderId(providerId)
                        setSearchQuery("")
                        setHighlightIndex(0)
                      }}
                      className={cn(
                        "relative flex size-9 shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isActive &&
                          "bg-state-selected text-foreground shadow-sm"
                      )}>
                      <ProviderIcon
                        providerId={providerId}
                        brand={group.brand}
                        fallbackName={group.name}
                        iconUrl={providerIcons[providerId]}
                        className="icon-md"
                      />
                      {providerId === selectedProviderId && (
                        <span className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" />
                      )}
                    </RailButton>
                  )
                })}
              </div>
            </nav>

            <div className="flex min-w-0 flex-1 flex-col p-1">
              <div className="flex items-center justify-between px-2 py-1">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold">
                    {effectiveActiveProviderId
                      ? railGroups[effectiveActiveProviderId]?.name
                      : t("model.menu.models_label")}
                  </p>
                  <p className="text-micro text-muted-foreground tabular-nums">
                    {visibleModels.length} {t("model.menu.models_label")}
                  </p>
                </div>
                <div className="flex items-center">
                  <TooltipActionButton
                    onClick={() => {
                      setSortDirection((current) =>
                        current === "asc" ? "desc" : "asc"
                      )
                      setHighlightIndex(0)
                      virtuosoRef.current?.scrollToIndex({ index: 0 })
                    }}
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    label={sortDirection === "asc" ? "A–Z" : "Z–A"}
                    showLabel
                    ariaLabel={sortActionLabel}
                    tooltip={sortActionLabel}
                    icon={
                      sortDirection === "asc" ? (
                        <ArrowDownAZ aria-hidden="true" className="icon-sm" />
                      ) : (
                        <ArrowDownZA aria-hidden="true" className="icon-sm" />
                      )
                    }
                  />
                  <TooltipActionButton
                    onClick={() => refresh()}
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    ariaLabel={t("model.menu.refresh_aria_label")}
                    tooltip={t("model.menu.refresh_tooltip")}
                    icon={
                      <RotateCcw
                        className={cn(
                          "icon-sm transition-transform",
                          isLoading && "animate-spin"
                        )}
                      />
                    }
                  />
                </div>
              </div>

              {selectionConflictModel && (
                <div className="mx-1 mb-1 rounded-control border border-status-warning/40 bg-tint-warning px-2 py-1.5 text-xs text-status-warning-text">
                  {t("model.menu.selection_conflict", {
                    model: selectionConflictModel
                  })}
                </div>
              )}
              {unavailableProviders.length > 0 && (
                <div className="mx-1 mb-1 flex items-start gap-2 rounded-control border border-status-warning/40 bg-tint-warning px-2 py-1.5 text-xs text-status-warning-text">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    {unreachableProviderNames && (
                      <p>
                        {t("model.menu.providers_unreachable", {
                          names: unreachableProviderNames
                        })}
                      </p>
                    )}
                    {emptyProviderNames && (
                      <p>
                        {t("model.menu.providers_unavailable", {
                          names: emptyProviderNames
                        })}
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="-my-0.5 shrink-0 text-status-warning-text"
                    disabled={isLoading}
                    onClick={() => refresh()}>
                    {t("model.menu.retry")}
                  </Button>
                </div>
              )}

              <div className="relative px-1 pb-1">
                <Search className="icon-sm pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={searchInputRef}
                  value={searchQuery}
                  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the search box drives a custom virtualized listbox; a native select cannot filter or virtualize
                  role="combobox"
                  aria-expanded="true"
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={
                    activeRow ? `${listId}-${modelKey(activeRow)}` : undefined
                  }
                  onChange={(event) => {
                    setSearchQuery(event.target.value)
                    setHighlightIndex(0)
                  }}
                  onKeyDown={(event) => {
                    const editing = event.currentTarget.value.length > 0
                    if (event.key === "ArrowDown") {
                      event.preventDefault()
                      moveHighlight(activeRowIndex + 1)
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault()
                      moveHighlight(activeRowIndex - 1)
                    } else if (
                      event.key === "Home" &&
                      (!editing || event.ctrlKey || event.metaKey)
                    ) {
                      event.preventDefault()
                      moveHighlight(0)
                    } else if (
                      event.key === "End" &&
                      (!editing || event.ctrlKey || event.metaKey)
                    ) {
                      event.preventDefault()
                      moveHighlight(visibleModels.length - 1)
                    } else if (event.key === "Enter" && activeRow) {
                      event.preventDefault()
                      void handleSelect(
                        activeRow.name,
                        activeRow.providerId || DEFAULT_PROVIDER_ID
                      )
                    }
                  }}
                  placeholder={t("model.menu.search_placeholder")}
                  aria-label={t("model.menu.search_placeholder")}
                  className="h-8 pl-8 text-xs"
                />
              </div>

              {effectiveActiveProviderId === DEFAULT_PROVIDER_ID && (
                <div className="mx-1 mb-1 flex items-center gap-2 rounded-control px-2 py-1 text-xs">
                  <label
                    htmlFor="model-menu-ollama-cloud"
                    className="min-w-0 flex-1 cursor-pointer">
                    <span className="block font-medium">
                      {t("model.menu.cloud_models.label")}
                    </span>
                    <span className="block text-micro text-muted-foreground">
                      {t("model.menu.cloud_models.description")}
                    </span>
                  </label>
                  <Switch
                    id="model-menu-ollama-cloud"
                    size="sm"
                    checked={cloudModels === true}
                    onCheckedChange={(next) => void toggleCloudModels(next)}
                  />
                </div>
              )}

              <div className="min-h-0 flex-1 border-t border-border pt-1">
                {visibleModels.length === 0 ? (
                  <div className="flex h-full items-center justify-center px-3 text-center text-xs text-muted-foreground">
                    {searchQuery.trim()
                      ? t("model.menu.no_model_match")
                      : t("model.menu.no_model_found")}
                  </div>
                ) : (
                  <Virtuoso
                    ref={virtuosoRef}
                    id={listId}
                    data={visibleModels}
                    {...scrollRegionProps(t("model.menu.models_label"))}
                    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- virtualized rows cannot be native options
                    role="listbox"
                    className={`h-full scrollbar-none ${SCROLL_REGION_FOCUS_CLASS}`}
                    computeItemKey={(_index, model) => modelKey(model)}
                    itemContent={(index, model) => {
                      const providerId = model.providerId || DEFAULT_PROVIDER_ID
                      const modelBrand = resolveModelBrand(model.name)
                      const ModelIcon = getModelIcon(model.name)
                      const isCloud =
                        Boolean(model.cloud) ||
                        model.details?.format === "cloud" ||
                        ((providerId === DEFAULT_PROVIDER_ID ||
                          providerId.startsWith("custom:ollama:")) &&
                          isOllamaCloudModel(model.name))
                      const caps = resolve(
                        model,
                        capabilityTags[modelTagsKey(providerId, model.name)]
                      )
                      const highlighted = index === activeRowIndex
                      return (
                        // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- named by the row contents it wraps
                        <div
                          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- row holds its own buttons, so it cannot be a native option
                          role="option"
                          id={`${listId}-${modelKey(model)}`}
                          aria-selected={highlighted}
                          className={cn(
                            "mx-1 mb-0.5 rounded-control",
                            highlighted && "ring-2 ring-inset ring-focus"
                          )}>
                          <ListRow
                            density="compact"
                            inset="nested"
                            trailingKind="control"
                            active={
                              selectedModelRef
                                ? selectedModelRef.modelId === model.name &&
                                  selectedModelRef.providerId === providerId
                                : selectedModel === model.name
                            }
                            leading={
                              <div className="flex size-7 shrink-0 items-center justify-center">
                                {/*
                                 * In a single provider's view every row shares
                                 * the same vendor, so the model-family glyph is
                                 * what carries information. Across all models
                                 * the provider is what tells two same-named
                                 * models apart, so its mark takes the slot.
                                 */}
                                <ModelRowIcon
                                  scoped={effectiveActiveProviderId !== null}
                                  providerId={providerId}
                                  providerBrand={model.providerBrand}
                                  providerName={model.providerName}
                                  providerIconUrl={providerIcons[providerId]}
                                  modelBrand={modelBrand}
                                  FallbackIcon={ModelIcon}
                                />
                              </div>
                            }
                            description={
                              <div className="mt-0.5 flex items-center gap-1.5 overflow-hidden">
                                {model.details?.parameter_size && (
                                  <Badge
                                    variant="outline"
                                    className="h-4 shrink-0 border px-1 text-micro text-muted-foreground border-border">
                                    {formatParameterSize(
                                      model.details.parameter_size
                                    )}
                                  </Badge>
                                )}
                                {isCloud && (
                                  <Badge
                                    variant="outline"
                                    title={
                                      [
                                        model.cloud?.description,
                                        !model.cloud?.requiredPlan &&
                                          t("model.menu.cloud_plan_unknown")
                                      ]
                                        .filter(Boolean)
                                        .join("\n\n") || undefined
                                    }
                                    className="h-4 shrink-0 border px-1 text-micro capitalize text-muted-foreground border-border">
                                    {t("model.menu.cloud_badge", {
                                      plan: model.cloud?.requiredPlan
                                        ? ` · ${model.cloud.requiredPlan}`
                                        : ""
                                    })}
                                  </Badge>
                                )}
                                {model.details?.quantization_level && (
                                  <Badge
                                    variant="outline"
                                    className="h-4 shrink-0 px-1 text-micro text-muted-foreground border-border">
                                    {model.details.quantization_level}
                                  </Badge>
                                )}
                                <ModelCapabilityBadges
                                  caps={caps}
                                  className="shrink-0"
                                />
                              </div>
                            }
                            trailing={
                              <div className="flex items-center gap-0.5">
                                {(selectedModelRef
                                  ? selectedModelRef.modelId === model.name &&
                                    selectedModelRef.providerId === providerId
                                  : selectedModel === model.name) && (
                                  <Check className="icon-sm shrink-0 text-primary" />
                                )}
                                <button
                                  type="button"
                                  aria-label={t(
                                    "model.capabilities.edit_aria_label",
                                    { model: model.name }
                                  )}
                                  title={t("model.capabilities.edit_tooltip")}
                                  className="flex size-7 shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  onClick={() =>
                                    openCapabilitySheet(model.name, providerId)
                                  }>
                                  <SlidersHorizontal className="icon-sm" />
                                </button>
                              </div>
                            }>
                            <ListRowTitleButton
                              onClick={() =>
                                void handleSelect(model.name, providerId)
                              }
                              className="flex items-center gap-1.5">
                              <span
                                className="truncate text-xs font-medium"
                                title={model.name}>
                                {model.name}
                              </span>
                              {/*
                               * Only across all models, and only naming which
                               * provider this row is. Two routers serving the
                               * same upstream catalog share hundreds of ids, so
                               * a "Conflict" badge on every one of them inside a
                               * single provider's list flagged the normal case
                               * and said nothing about which row to pick.
                               */}
                              {effectiveActiveProviderId === null &&
                                duplicateModelNames.has(model.name) && (
                                  <Badge
                                    variant="secondary"
                                    className="h-4 shrink-0 max-w-24 truncate px-1 text-micro">
                                    {model.providerName ||
                                      getProviderDisplayName(providerId)}
                                  </Badge>
                                )}
                              {model.size ? (
                                <span className="shrink-0 whitespace-nowrap text-micro text-muted-foreground tabular-nums">
                                  {formatFileSize(model.size, t)}
                                </span>
                              ) : null}
                            </ListRowTitleButton>
                          </ListRow>
                        </div>
                      )
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {capabilityTarget && targetDetected && targetCurrent && (
        <ModelCapabilitySheet
          open={true}
          onOpenChange={(next) => {
            if (!next) setCapabilityTarget(null)
          }}
          providerId={capabilityTarget.providerId}
          providerDisplayName={targetModelData?.providerName}
          modelName={capabilityTarget.model}
          current={targetCurrent}
          detected={targetDetected}
          reasoningSupport={targetModelData?.capabilityHints?.reasoning}
          hasOverride={Boolean(
            getOverride(capabilityTarget.providerId, capabilityTarget.model)
          )}
          onSave={(override) =>
            setOverride(
              capabilityTarget.providerId,
              capabilityTarget.model,
              override
            )
          }
          onReset={() =>
            clearOverride(capabilityTarget.providerId, capabilityTarget.model)
          }
          onProbe={async () => {
            return extensionRpcClient.call(
              RpcMethod.ProvidersProbeModelCapabilities,
              {
                providerId: capabilityTarget.providerId,
                modelName: capabilityTarget.model
              }
            )
          }}
        />
      )}
    </>
  )
}
