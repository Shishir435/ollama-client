import { useState } from "react"
import { useTranslation } from "react-i18next"

import { TooltipActionButton } from "@/components/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from "@/components/ui/command"
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
import { browser } from "@/lib/browser-api"
import { DEFAULT_PROVIDER_ID, MESSAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { Check, ChevronDown, RotateCcw, Settings } from "@/lib/lucide-icon"
import { getModelCapabilities } from "@/lib/providers/capabilities"
import { getProviderDisplayName } from "@/lib/providers/registry"
import { cn } from "@/lib/utils"
import {
  formatFileSize,
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
  const {
    models,
    refresh,
    isLoading,
    selectedModel,
    selectedModelRef,
    setSelectedModel,
    selectionConflictModel,
    clearSelectionConflict
  } = useProviderModels()

  const {
    resolve,
    getOverride,
    canSelfReportCapabilities,
    setOverride,
    clearOverride
  } = useModelCapabilityOverrides()

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

  const filteredDefaultModels = models.filter(
    (model) => !isEmbeddingModel(model.name, model.details?.families || [])
  )

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

    if (modelName && modelName !== previousModel) {
      browser.runtime
        .sendMessage({
          type: MESSAGE_KEYS.PROVIDER.WARMUP_MODEL,
          payload: {
            model: modelName,
            providerId,
            previousModel,
            previousProviderId
          }
        })
        .catch((error) => {
          logger.warn("Failed to trigger model warmup", "ModelMenu", { error })
        })
    }
  }

  if (!models) return null

  const groupedModels = filteredDefaultModels.reduce(
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
  )
  const duplicateModelNames = new Set(
    filteredDefaultModels
      .map((model) => model.name)
      .filter((name, index, arr) => arr.indexOf(name) !== index)
  )

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
  // Detection only (no override) — the "reset to detected" target.
  const targetDetected = capabilityTarget
    ? getModelCapabilities({
        providerId: capabilityTarget.providerId,
        ollamaCapabilities: targetTags,
        lmStudioModelType: targetModelData?.capabilityHints?.modelType,
        contextLength: targetModelData?.capabilityHints?.contextLength
      })
    : null
  // Effective capabilities (override applied) — seeds the sheet toggles so they
  // match what the menu badges show.
  const targetCurrent = capabilityTarget
    ? getModelCapabilities({
        providerId: capabilityTarget.providerId,
        ollamaCapabilities: targetTags,
        lmStudioModelType: targetModelData?.capabilityHints?.modelType,
        contextLength: targetModelData?.capabilityHints?.contextLength,
        override: getOverride(
          capabilityTarget.providerId,
          capabilityTarget.model
        )
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
                    className="h-8 justify-between gap-1.5 rounded-lg bg-transparent px-2 font-medium hover:bg-background/80 items-center transition-all"
                  />
                }
              />
            )
          }
          tooltip={tooltipTextContent}
          icon={
            trigger ? null : (
              <>
                {selectedModel ? (
                  <div className="flex items-center gap-1.5">
                    {(() => {
                      const SelectedModelIcon = getModelIcon(selectedModel)
                      return (
                        <SelectedModelIcon className="icon-md text-muted-foreground" />
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
                <ChevronDown className="icon-md opacity-50" />
              </>
            )
          }
        />

        <PopoverContent className="w-[320px] p-0" align="start">
          <Command className="max-h-100 w-full">
            <div className="flex flex-col justify-between w-full h-full p-1">
              {selectionConflictModel && (
                <div className="mb-2 rounded-md border border-status-warning/40 bg-status-warning/10 px-2 py-1.5 text-xs text-status-warning">
                  Provider selection required for{" "}
                  <strong>{selectionConflictModel}</strong>.
                </div>
              )}
              <div className="flex items-center justify-between p-1">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {t("model.menu.models_label")}
                </span>
                <TooltipActionButton
                  onClick={() => refresh()}
                  variant="ghost"
                  size="icon"
                  className="size-6"
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
              <CommandInput
                placeholder={t("model.menu.search_placeholder")}
                className="bg-transparent rounded-md text-sm outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                autoFocus
              />
            </div>
            <CommandSeparator className="mt-2" />
            <CommandList className="max-h-75 overflow-y-auto px-0.5 py-1 scrollbar-none">
              <CommandEmpty className="py-6 text-center text-sm">
                {t("model.menu.no_model_found")}
              </CommandEmpty>

              {Object.entries(groupedModels).map(([providerId, group]) => (
                <CommandGroup key={providerId} heading={group.name}>
                  {group.models.map((model) => {
                    const ModelIcon = getModelIcon(model.name)
                    const caps = resolve(
                      model,
                      capabilityTags[modelTagsKey(providerId, model.name)]
                    )
                    const hasOverride = Boolean(
                      getOverride(providerId, model.name)
                    )
                    // Offer manual capability entry for providers that cannot
                    // report capabilities themselves, or to edit an existing
                    // override. Ollama self-reports, so it's not prompted here.
                    const showCapabilityEdit =
                      !canSelfReportCapabilities(providerId) || hasOverride
                    return (
                      <CommandItem
                        key={`${providerId}-${model.name}`}
                        value={model.name}
                        onSelect={() => handleSelect(model.name, providerId)}
                        className="flex items-center gap-2 rounded-md px-1.5 py-1.5 mb-0.5 cursor-pointer aria-selected:bg-accent">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/50">
                          <ModelIcon className="icon-sm text-muted-foreground" />
                        </div>

                        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-medium text-sm">
                              {model.name}
                            </span>
                            {duplicateModelNames.has(model.name) && (
                              <Badge
                                variant="secondary"
                                className="h-4 px-1 text-[10px]">
                                Conflict
                              </Badge>
                            )}
                            {(selectedModelRef
                              ? selectedModelRef.modelId === model.name &&
                                selectedModelRef.providerId === providerId
                              : selectedModel === model.name) && (
                              <Check className="icon-sm text-primary" />
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 mt-0.5">
                            {model.details?.parameter_size && (
                              <Badge
                                variant="outline"
                                className="h-4 px-1 text-[10px] font-mono text-muted-foreground border-border/50">
                                {model.details.parameter_size}
                              </Badge>
                            )}
                            {model.details?.quantization_level && (
                              <Badge
                                variant="outline"
                                className="h-4 px-1 text-[10px] font-mono text-muted-foreground border-border/50">
                                {model.details.quantization_level}
                              </Badge>
                            )}
                            <ModelCapabilityBadges caps={caps} />
                            {model.size ? (
                              <span className="text-[10px] text-muted-foreground tabular-nums">
                                {formatFileSize(model.size, t)}
                              </span>
                            ) : null}
                            {showCapabilityEdit && (
                              <button
                                type="button"
                                aria-label={t(
                                  "model.capabilities.edit_aria_label",
                                  { model: model.name }
                                )}
                                title={t("model.capabilities.edit_tooltip")}
                                className="ml-auto flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  e.preventDefault()
                                  openCapabilitySheet(model.name, providerId)
                                }}>
                                <Settings className="icon-xs" />
                              </button>
                            )}
                          </div>
                        </div>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {capabilityTarget && targetDetected && targetCurrent && (
        <ModelCapabilitySheet
          open={true}
          onOpenChange={(next) => {
            if (!next) setCapabilityTarget(null)
          }}
          providerId={capabilityTarget.providerId}
          modelName={capabilityTarget.model}
          current={targetCurrent}
          detected={targetDetected}
          canSelfReport={canSelfReportCapabilities(capabilityTarget.providerId)}
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
        />
      )}
    </>
  )
}
