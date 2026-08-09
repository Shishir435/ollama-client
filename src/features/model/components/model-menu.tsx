import { RpcMethod } from "@ollama-client/contracts/rpc"
import {
  Check,
  ChevronDown,
  Layers3,
  RotateCcw,
  Search,
  Settings
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Virtuoso } from "react-virtuoso"
import { TooltipActionButton } from "@/components/actions"
import { ListRow, ListRowTitleButton } from "@/components/layout/list-row"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover"
import { useModelCapabilityOverrides } from "@/features/model/hooks/use-model-capability-overrides"
import {
  modelTagsKey,
  useModelCapabilityTags
} from "@/features/model/hooks/use-model-capability-tags"
import { useProviderModels } from "@/features/model/hooks/use-provider-models"
import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { getModelCapabilities } from "@/lib/providers/capabilities"
import {
  getProviderDisplayName,
  getProviderMeta
} from "@/lib/providers/registry"
import { cn } from "@/lib/utils"
import { extensionRpcClient } from "@/protocol/extension-client"
import {
  formatFileSize,
  formatParameterSize,
  getModelIcon,
  isEmbeddingModel
} from "../lib/model-utils"
import { ModelCapabilityBadges } from "./model-capabilities/capability-badges"
import { ModelCapabilitySheet } from "./model-capabilities/capability-sheet"

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
  const [open, setOpen] = useState(false)
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const {
    models,
    refresh,
    isLoading,
    selectedModel,
    selectedModelRef,
    setSelectedModel,
    selectionConflictModel,
    clearSelectionConflict,
    unavailableProviders
  } = useProviderModels()

  const { resolve, getOverride, getProbe, setOverride, clearOverride } =
    useModelCapabilityOverrides()

  // Per-model capability tags from providers that self-report (Ollama). Fetched
  // only while the menu is open; cached and shared with the model-detail panel.
  const capabilityTags = useModelCapabilityTags(models, open)

  // Model whose capability sheet is open. Held by name+provider so the sheet
  // survives the popover closing underneath it.
  const [capabilityTarget, setCapabilityTarget] = useState<{
    model: string
    providerId: string
  } | null>(null)

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

  const providerGroups = useMemo(
    () =>
      chatModels.reduce(
        (groups, model) => {
          const providerId = model.providerId || DEFAULT_PROVIDER_ID
          const providerName =
            model.providerName || getProviderDisplayName(providerId)
          if (!groups[providerId]) {
            groups[providerId] = { name: providerName, models: [] }
          }
          groups[providerId].models.push(model)
          return groups
        },
        {} as Record<string, { name: string; models: typeof models }>
      ),
    [chatModels]
  )
  const providerEntries = useMemo(
    () => Object.entries(providerGroups),
    [providerGroups]
  )
  const selectedProviderId =
    selectedModelRef?.providerId ||
    chatModels.find((model) => model.name === selectedModel)?.providerId ||
    DEFAULT_PROVIDER_ID

  useEffect(() => {
    if (!open) return
    setSearchQuery("")
    setActiveProviderId((current) => {
      if (current && providerGroups[current]) return current
      return providerGroups[selectedProviderId] ? selectedProviderId : null
    })
  }, [open, providerGroups, selectedProviderId])

  const visibleModels = useMemo(() => {
    const providerModels = activeProviderId
      ? (providerGroups[activeProviderId]?.models ?? [])
      : chatModels
    const query = searchQuery.trim().toLocaleLowerCase()
    if (!query) return providerModels
    return providerModels.filter((model) =>
      model.name.toLocaleLowerCase().includes(query)
    )
  }, [activeProviderId, chatModels, providerGroups, searchQuery])

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
      // Fire-and-forget: warmup is an optimization, and the user has already
      // been given the newly selected model.
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
        supportedParameters:
          targetModelData?.capabilityHints?.supportedParameters,
        probed: getProbe(capabilityTarget.providerId, capabilityTarget.model)
      })
    : null
  // Effective capabilities (override applied) — seeds the sheet toggles so they
  // match what the menu badges show.
  const targetCurrent = capabilityTarget
    ? getModelCapabilities({
        providerId: capabilityTarget.providerId,
        ollamaCapabilities: targetTags,
        lmStudioModelType: targetModelData?.capabilityHints?.modelType,
        capabilityTags: targetModelData?.capabilityHints?.capabilityTags,
        contextLength: targetModelData?.capabilityHints?.contextLength,
        modalities: targetModelData?.capabilityHints?.modalities,
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
      <Popover open={open} onOpenChange={setOpen}>
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
                    role="combobox"
                    aria-expanded={open}
                    className="h-8 min-w-0 max-w-full justify-between gap-1.5 rounded-panel bg-transparent px-2 font-medium hover:bg-background/80 items-center transition-all"
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
                      const SelectedModelIcon = getModelIcon(selectedModel)
                      return (
                        <SelectedModelIcon className="icon-md shrink-0 text-muted-foreground" />
                      )
                    })()}
                    <span className="truncate font-medium">
                      {(() => {
                        const name =
                          models.find((m) => m.name === selectedModel)?.name ||
                          selectedModel
                        return name.length > 15
                          ? `${name.slice(0, 15)}...`
                          : name
                      })()}
                    </span>
                  </div>
                ) : (
                  <span className="text-muted-foreground">
                    {t("model.menu.select_placeholder")}
                  </span>
                )}
                <ChevronDown className="icon-md shrink-0 opacity-50" />
              </>
            )
          }
        />

        <PopoverContent
          className="w-[calc(100vw-1rem)] max-w-96 p-0"
          align="start">
          <div className="flex h-96 min-h-0 overflow-hidden rounded-xl bg-popover text-popover-foreground">
            <nav
              aria-label={t("settings.tabs.providers")}
              className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border/50 bg-muted/15 p-1.5">
              <button
                type="button"
                aria-label={t("model.menu.models_label")}
                title={t("model.menu.models_label")}
                aria-pressed={activeProviderId === null}
                onClick={() => {
                  setActiveProviderId(null)
                  setSearchQuery("")
                }}
                className={cn(
                  "flex size-9 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  activeProviderId === null &&
                    "bg-muted text-foreground shadow-sm"
                )}>
                <Layers3 className="icon-md" />
              </button>

              <div className="my-0.5 h-px w-7 bg-border/60" />

              {providerEntries.map(([providerId, group]) => {
                const meta = getProviderMeta(providerId, group.name)
                const isActive = activeProviderId === providerId
                return (
                  <button
                    key={providerId}
                    type="button"
                    aria-label={group.name}
                    title={`${group.name} · ${group.models.length}`}
                    aria-pressed={isActive}
                    onClick={() => {
                      setActiveProviderId(providerId)
                      setSearchQuery("")
                    }}
                    className={cn(
                      "relative flex size-9 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isActive && "bg-muted text-foreground shadow-sm"
                    )}>
                    {meta.icon.kind === "lucide" ? (
                      <meta.icon.icon className="icon-md" />
                    ) : (
                      <img
                        src={meta.icon.src}
                        alt={meta.icon.alt}
                        className="size-5 object-contain"
                      />
                    )}
                    {providerId === selectedProviderId && (
                      <span className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" />
                    )}
                  </button>
                )
              })}
            </nav>

            <div className="flex min-w-0 flex-1 flex-col p-1">
              <div className="flex items-center justify-between px-2 py-1">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold">
                    {activeProviderId
                      ? providerGroups[activeProviderId]?.name
                      : t("model.menu.models_label")}
                  </p>
                  <p className="text-nano text-muted-foreground tabular-nums">
                    {visibleModels.length} {t("model.menu.models_label")}
                  </p>
                </div>
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

              {selectionConflictModel && (
                <div className="mx-1 mb-1 rounded-control border border-status-warning/40 bg-status-warning/10 px-2 py-1.5 text-xs text-status-warning">
                  Provider selection required for{" "}
                  <strong>{selectionConflictModel}</strong>.
                </div>
              )}
              {unavailableProviders.length > 0 && (
                <div className="mx-1 mb-1 rounded-control border border-status-warning/40 bg-status-warning/10 px-2 py-1.5 text-micro text-status-warning">
                  {t("model.menu.providers_unavailable", {
                    names: unavailableProviders
                      .map(
                        (failure) =>
                          failure.providerName ||
                          getProviderDisplayName(failure.providerId)
                      )
                      .join(", ")
                  })}
                </div>
              )}

              <div className="relative px-1 pb-1">
                <Search className="icon-sm pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && visibleModels[0]) {
                      const model = visibleModels[0]
                      void handleSelect(
                        model.name,
                        model.providerId || DEFAULT_PROVIDER_ID
                      )
                    }
                  }}
                  placeholder={t("model.menu.search_placeholder")}
                  aria-label={t("model.menu.search_placeholder")}
                  className="h-8 pl-8 text-xs"
                  autoFocus
                />
              </div>

              <div className="min-h-0 flex-1 border-t border-border/50 pt-1">
                {visibleModels.length === 0 ? (
                  <div className="flex h-full items-center justify-center px-3 text-center text-xs text-muted-foreground">
                    {t("model.menu.no_model_found")}
                  </div>
                ) : (
                  <Virtuoso
                    data={visibleModels}
                    className="h-full scrollbar-none"
                    computeItemKey={(_index, model) =>
                      `${model.providerId || DEFAULT_PROVIDER_ID}:${model.name}`
                    }
                    itemContent={(_index, model) => {
                      const providerId = model.providerId || DEFAULT_PROVIDER_ID
                      const ModelIcon = getModelIcon(model.name)
                      const caps = resolve(
                        model,
                        capabilityTags[modelTagsKey(providerId, model.name)]
                      )
                      return (
                        <div className="px-1 pb-0.5">
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
                                <ModelIcon className="icon-sm text-muted-foreground" />
                              </div>
                            }
                            description={
                              <div className="mt-0.5 flex items-center gap-1.5 overflow-hidden">
                                {model.details?.parameter_size && (
                                  <Badge
                                    variant="outline"
                                    className="h-4 shrink-0 border px-1 text-nano font-mono text-muted-foreground border-border/50">
                                    {formatParameterSize(
                                      model.details.parameter_size
                                    )}
                                  </Badge>
                                )}
                                {model.details?.quantization_level && (
                                  <Badge
                                    variant="outline"
                                    className="h-4 shrink-0 px-1 text-nano font-mono text-muted-foreground border-border/50">
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
                                  className="flex size-7 shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  onClick={() =>
                                    openCapabilitySheet(model.name, providerId)
                                  }>
                                  <Settings className="icon-sm" />
                                </button>
                              </div>
                            }>
                            <ListRowTitleButton
                              onClick={() =>
                                void handleSelect(model.name, providerId)
                              }
                              className="flex items-center gap-1.5">
                              <span className="truncate font-medium text-micro">
                                {model.name}
                              </span>
                              {duplicateModelNames.has(model.name) && (
                                <Badge
                                  variant="secondary"
                                  className="h-4 shrink-0 px-1 text-micro">
                                  Conflict
                                </Badge>
                              )}
                              {model.size ? (
                                <span className="shrink-0 whitespace-nowrap text-nano text-muted-foreground tabular-nums">
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
