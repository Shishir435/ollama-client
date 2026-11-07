import { MODEL_DISCOVERY_FAILURE } from "@ollama-client/contracts/provider-rpc"
import { RpcMethod } from "@ollama-client/contracts/rpc"
import {
  Boxes,
  Check,
  ChevronDown,
  Layers3,
  MessageSquare,
  RotateCcw,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import type {
  ConnectionHealth,
  HealthTone
} from "@/features/model/hooks/use-connection-health"
import { useModelCapabilityOverrides } from "@/features/model/hooks/use-model-capability-overrides"
import {
  modelTagsKey,
  useModelCapabilityTags
} from "@/features/model/hooks/use-model-capability-tags"
import { useProviderIcons } from "@/features/model/hooks/use-provider-icons"
import { useProviderModels } from "@/features/model/hooks/use-provider-models"
import { UNVERIFIED_PROVIDER_CODE } from "@/features/model/lib/provider-catalog-codes"
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
import { STATUS_STYLES } from "@/lib/ui-status"
import { extensionRpcClient } from "@/protocol/extension-client"
import {
  formatFileSize,
  formatParameterSize,
  isEmbeddingModel
} from "../lib/model-utils"
import { ConnectionHealthNotice } from "./connection-health-notice"
import { EmbeddingModelMenuPanel } from "./embedding-model-menu-panel"
import { ModelCapabilityBadges } from "./model-capabilities/capability-badges"
import { ModelCapabilitySheet } from "./model-capabilities/capability-sheet"
import {
  compareModelNames,
  HealthDot,
  MenuListHeader,
  MenuSearch,
  RailButton,
  RailDivider,
  SelectedSourceDot,
  type SortDirection
} from "./model-menu-parts"

/**
 * The glyph for one model row.
 *
 * The provider's mark is the default everywhere: across providers it tells two
 * same-named models apart, and inside one it keeps the list visually of a piece
 * with the rail. Family glyphs guessed from a name gave one Ollama list a
 * robot, a brain and a cube side by side, which said nothing true. Inside a
 * single provider a model whose id names its own vendor (`codex/gpt-…`,
 * `anthropic/claude-…`) wears that vendor's mark instead, since the catalog
 * states it.
 */
const ModelRowIcon = ({
  scoped,
  providerId,
  providerBrand,
  providerName,
  providerIconUrl,
  modelBrand
}: {
  scoped: boolean
  providerId: string
  providerBrand?: string
  providerName?: string
  providerIconUrl?: string
  modelBrand?: ProviderBrandId
}) => {
  if (scoped && modelBrand) {
    return (
      <ProviderIcon
        brand={modelBrand}
        className="icon-sm text-muted-foreground"
      />
    )
  }
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

export interface ModelMenuProps {
  trigger?: React.ReactNode
  onSelectModel?: (model: string) => void
  tooltipTextContent: string
  showStatusPopup?: boolean
  /**
   * Chat provider and embedding state, when this picker is the place they are
   * reported (the composer). Without it the picker shows no status at all,
   * so a per-message picker does not run its own embedding check.
   */
  health?: ConnectionHealth
}

type ModelMenuView = "chat" | "embeddings"

export const ModelMenu = ({
  trigger,
  onSelectModel: _onSelectModel,
  tooltipTextContent,
  showStatusPopup: _showStatusPopup = true,
  health
}: ModelMenuProps) => {
  const { t } = useTranslation()
  const [open, setOpenState] = useState(false)
  const [activeView, setActiveView] = useState<ModelMenuView>("chat")
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc")
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
    unverifiedProviders,
    ollamaEnabled
  } = useProviderModels()
  /** Opening the menu re-asks any provider whose list has gone stale. */
  const setOpen = (next: boolean) => {
    setOpenState(next)
    if (next) void refreshStale()
  }

  /**
   * Failures the all-providers notice names. The selected provider's issue is
   * left to the status line above the menu, which says it more precisely.
   */
  const providerFailureNames = (unreachable: boolean) =>
    unavailableProviders
      .filter(
        (failure) =>
          failure.providerId !== health?.selectedIssueProviderId &&
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
  /**
   * A provider whose catalog could not be read. Only the provider the chat
   * model runs on is red when unreachable; any other is amber, since the
   * user's next message does not depend on it.
   */
  const failedProviderTones: Record<string, HealthTone> = Object.fromEntries(
    unavailableProviders.map((failure) => [
      failure.providerId,
      failure.code === MODEL_DISCOVERY_FAILURE.REQUEST_FAILED &&
      failure.providerId === (selectedModelRef?.providerId ?? null)
        ? "danger"
        : "warning"
    ])
  )

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
  /**
   * A provider that failed contributes no models, so it would have no place
   * in the rail and its health dot, its name and its retry would have
   * nowhere to live. It keeps an empty entry instead.
   */
  const railGroups = useMemo(() => {
    const groups: Record<
      string,
      { name: string; brand?: string; models: typeof models }
    > =
      ollamaEnabled && !providerGroups[DEFAULT_PROVIDER_ID]
        ? {
            [DEFAULT_PROVIDER_ID]: {
              name: getProviderDisplayName(DEFAULT_PROVIDER_ID),
              models: []
            },
            ...providerGroups
          }
        : { ...providerGroups }
    for (const failure of [...unavailableProviders, ...unverifiedProviders]) {
      groups[failure.providerId] ??= {
        name:
          failure.providerName || getProviderDisplayName(failure.providerId),
        models: []
      }
    }
    return groups
  }, [ollamaEnabled, providerGroups, unavailableProviders, unverifiedProviders])

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
  /** Why the provider being viewed has nothing to list, when it failed. */
  const activeProviderFailure = effectiveActiveProviderId
    ? [...unavailableProviders, ...unverifiedProviders].find(
        (failure) => failure.providerId === effectiveActiveProviderId
      )
    : undefined

  const prepareView = (view: ModelMenuView) => {
    setActiveView(view)
    setSearchQuery("")
    setHighlightIndex(0)
    setActiveProviderId((current) => {
      if (current && railGroups[current]) return current
      return railGroups[selectedProviderId] ? selectedProviderId : null
    })
  }

  const selectProvider = (providerId: string | null) => {
    setActiveProviderId(providerId)
    setSearchQuery("")
    setHighlightIndex(0)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) prepareView("chat")
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
    return [...matching].sort((left, right) =>
      compareModelNames(
        sortDirection,
        left.name,
        right.name,
        (left.providerId || DEFAULT_PROVIDER_ID).localeCompare(
          right.providerId || DEFAULT_PROVIDER_ID,
          "en"
        )
      )
    )
  }, [
    effectiveActiveProviderId,
    chatModels,
    providerGroups,
    searchQuery,
    sortDirection
  ])
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
  const hints = targetModelData?.capabilityHints
  const targetEvidence = capabilityTarget && {
    providerId: capabilityTarget.providerId,
    ollamaCapabilities: targetTags,
    lmStudioModelType: hints?.modelType,
    capabilityTags: hints?.capabilityTags,
    contextLength: hints?.contextLength,
    modalities: hints?.modalities,
    outputModalities: hints?.outputModalities,
    supportedParameters: hints?.supportedParameters,
    probed: getProbe(capabilityTarget.providerId, capabilityTarget.model)
  }
  /** Detection + probe alone: the "reset to detected" target. */
  const targetDetected = targetEvidence && getModelCapabilities(targetEvidence)
  /** With the override applied, so the sheet agrees with the menu badges. */
  const targetCurrent =
    capabilityTarget &&
    targetEvidence &&
    getModelCapabilities({
      ...targetEvidence,
      override: getOverride(capabilityTarget.providerId, capabilityTarget.model)
    })

  /** The rail's foot offers the other view; it only changes what is shown. */
  const chatView = activeView === "chat"
  const ViewSwitchIcon = chatView ? Boxes : MessageSquare
  const viewSwitch = (
    <>
      <RailDivider />
      <RailButton
        label={t(
          chatView
            ? "model.menu.choose_embedding_model"
            : "model.menu.choose_chat_models"
        )}
        data-testid="model-menu-view-switch"
        onClick={() => prepareView(chatView ? "embeddings" : "chat")}>
        <ViewSwitchIcon aria-hidden="true" className="icon-md" />
        {health && (
          <HealthDot
            tone={chatView ? health.embeddingTone : health.providerTone}
            className="right-1 top-1"
          />
        )}
      </RailButton>
    </>
  )

  const triggerLabel = health?.summary
    ? `${tooltipTextContent} · ${health.summary}`
    : tooltipTextContent

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <TooltipActionButton
          trigger={
            trigger ? (
              <PopoverTrigger
                aria-label={triggerLabel}
                render={trigger as React.ReactElement}
              />
            ) : (
              <PopoverTrigger
                aria-label={triggerLabel}
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
          tooltip={triggerLabel}
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
                       * Without a vendor in its id it wears its provider's
                       * mark, as the row does.
                       */
                      const selectedProviderId = selectedModelRef?.providerId
                      const selectedRow = models.find(
                        (m) =>
                          m.name === selectedModel &&
                          (!selectedProviderId ||
                            (m.providerId || DEFAULT_PROVIDER_ID) ===
                              selectedProviderId)
                      )
                      const rowProviderId =
                        selectedRow?.providerId ||
                        selectedProviderId ||
                        DEFAULT_PROVIDER_ID
                      const selectedBrand = resolveModelBrand(selectedModel)
                      return (
                        <span className="relative inline-flex shrink-0">
                          {selectedBrand ? (
                            <ProviderIcon
                              brand={selectedBrand}
                              className="icon-md shrink-0 text-muted-foreground"
                            />
                          ) : (
                            <ProviderIcon
                              providerId={rowProviderId}
                              brand={selectedRow?.providerBrand}
                              fallbackName={selectedRow?.providerName}
                              iconUrl={providerIcons[rowProviderId]}
                              className="icon-md shrink-0 text-muted-foreground"
                            />
                          )}
                          {health && (
                            <HealthDot
                              tone={health.tone}
                              className="-right-0.5 -top-0.5"
                            />
                          )}
                        </span>
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
          aria-label={
            activeView === "embeddings"
              ? t("chat.connection.embeddings")
              : t("chat.connection.provider")
          }
          className="w-[calc(100vw-1rem)] max-w-96 overflow-hidden p-0"
          align="start">
          {health && (
            <ConnectionHealthNotice view={activeView} health={health} />
          )}
          {activeView === "embeddings" ? (
            <EmbeddingModelMenuPanel railFooter={viewSwitch} />
          ) : (
            <div className="flex h-96 min-h-0 overflow-hidden rounded-b-panel bg-popover text-popover-foreground">
              <nav
                aria-label={t("settings.tabs.providers")}
                className="flex w-12 shrink-0 flex-col items-center gap-1 overflow-hidden border-r border-border bg-surface-sunken p-1.5">
                <RailButton
                  label={t("model.menu.models_label")}
                  selected={effectiveActiveProviderId === null}
                  onClick={() => selectProvider(null)}>
                  <Layers3 className="icon-md" />
                </RailButton>
                <RailDivider />

                <div
                  data-testid="provider-rail-scroll"
                  className="flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto scrollbar-none">
                  {providerEntries.map(([providerId, group]) => {
                    const unreachable = unavailableProviders.some(
                      (failure) =>
                        failure.providerId === providerId &&
                        failure.code === MODEL_DISCOVERY_FAILURE.REQUEST_FAILED
                    )
                    return (
                      <RailButton
                        key={providerId}
                        label={
                          unreachable
                            ? t("model.provider_status.unreachable", {
                                provider: group.name
                              })
                            : `${group.name} · ${group.models.length}`
                        }
                        ariaLabel={group.name}
                        selected={effectiveActiveProviderId === providerId}
                        onClick={() => selectProvider(providerId)}>
                        <ProviderIcon
                          providerId={providerId}
                          brand={group.brand}
                          fallbackName={group.name}
                          iconUrl={providerIcons[providerId]}
                          className="icon-md"
                        />
                        {providerId === selectedProviderId && (
                          <SelectedSourceDot />
                        )}
                        {health &&
                          failedProviderTones[providerId] !== undefined && (
                            <HealthDot
                              tone={failedProviderTones[providerId]}
                              className="bottom-1 right-1"
                            />
                          )}
                      </RailButton>
                    )
                  })}
                </div>
                {viewSwitch}
              </nav>

              <div className="flex min-w-0 flex-1 flex-col p-1">
                <MenuListHeader
                  title={
                    effectiveActiveProviderId
                      ? railGroups[effectiveActiveProviderId]?.name
                      : t("model.menu.models_label")
                  }
                  count={visibleModels.length}
                  sortDirection={sortDirection}
                  onSort={() => {
                    setSortDirection((current) =>
                      current === "asc" ? "desc" : "asc"
                    )
                    setHighlightIndex(0)
                    virtuosoRef.current?.scrollToIndex({ index: 0 })
                  }}
                  onRefresh={() => refresh()}
                  refreshing={isLoading}
                />

                {selectionConflictModel && (
                  <div className="mx-1 mb-1 rounded-control border border-status-warning/40 bg-tint-warning px-2 py-1.5 text-xs text-status-warning-text">
                    {t("model.menu.selection_conflict", {
                      model: selectionConflictModel
                    })}
                  </div>
                )}
                {(unreachableProviderNames || emptyProviderNames) && (
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

                <MenuSearch
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
                />

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
                    <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center text-xs text-muted-foreground">
                      {searchQuery.trim() ? (
                        t("model.menu.no_model_match")
                      ) : activeProviderFailure ? (
                        <>
                          <p
                            className={
                              STATUS_STYLES[
                                failedProviderTones[
                                  activeProviderFailure.providerId
                                ] === "danger"
                                  ? "danger"
                                  : "warning"
                              ].text
                            }>
                            {t(
                              activeProviderFailure.code ===
                                MODEL_DISCOVERY_FAILURE.REQUEST_FAILED
                                ? "model.menu.providers_unreachable"
                                : activeProviderFailure.code ===
                                    UNVERIFIED_PROVIDER_CODE
                                  ? "model.menu.providers_unverified"
                                  : "model.menu.providers_unavailable",
                              {
                                names:
                                  activeProviderFailure.providerName ||
                                  getProviderDisplayName(
                                    activeProviderFailure.providerId
                                  )
                              }
                            )}
                          </p>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={isLoading}
                            onClick={() =>
                              void refreshProvider(
                                activeProviderFailure.providerId
                              )
                            }>
                            <RotateCcw className="icon-sm" />
                            {t("model.menu.retry")}
                          </Button>
                        </>
                      ) : (
                        t("model.menu.no_model_found")
                      )}
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
                        const providerId =
                          model.providerId || DEFAULT_PROVIDER_ID
                        const modelBrand = resolveModelBrand(model.name)
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
                        const isSelected = selectedModelRef
                          ? selectedModelRef.modelId === model.name &&
                            selectedModelRef.providerId === providerId
                          : selectedModel === model.name
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
                              active={isSelected}
                              leading={
                                <div className="flex size-7 shrink-0 items-center justify-center">
                                  <ModelRowIcon
                                    scoped={effectiveActiveProviderId !== null}
                                    providerId={providerId}
                                    providerBrand={model.providerBrand}
                                    providerName={model.providerName}
                                    providerIconUrl={providerIcons[providerId]}
                                    modelBrand={modelBrand}
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
                                  {isSelected && (
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
                                      openCapabilitySheet(
                                        model.name,
                                        providerId
                                      )
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
          )}
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
