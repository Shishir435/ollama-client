import { useStorage } from "@plasmohq/storage/hook"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { useProviderModels } from "@/features/model/hooks/use-provider-models"
import { browser } from "@/lib/browser-api"
import { DEFAULT_PROVIDER_ID, MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"
import { Check, ChevronDown, RotateCcw } from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { getProviderDisplayName } from "@/lib/providers/registry"
import { cn } from "@/lib/utils"

import { formatFileSize, getModelIcon } from "../lib/model-utils"

interface ModelMenuProps {
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
  const [selectedModel, setSelectedModel] = useStorage<string>(
    {
      key: STORAGE_KEYS.PROVIDER.SELECTED_MODEL,
      instance: plasmoGlobalStorage
    },
    ""
  )

  const { status, models, refresh, isLoading } = useProviderModels()

  useEffect(() => {
    if (status === "ready" && models.length > 0 && !selectedModel) {
      setSelectedModel(models[0].name)
    }
  }, [status, models, selectedModel, setSelectedModel])

  const handleSelect = (modelName: string) => {
    const previousModel = selectedModel
    if (_onSelectModel) {
      _onSelectModel(modelName)
    } else {
      setSelectedModel(modelName)
    }
    setOpen(false)

    if (modelName && modelName !== previousModel) {
      browser.runtime
        .sendMessage({
          type: MESSAGE_KEYS.PROVIDER.WARMUP_MODEL,
          payload: {
            model: modelName,
            previousModel
          }
        })
        .catch((error) => {
          console.warn("Failed to trigger model warmup", error)
        })
    }
  }

  if (!models) return null

  const groupedModels = models
    .filter((model) => {
      if (
        model.details?.families?.some((f) =>
          ["bert", "nomic-bert", "xlm-roberta"].includes(f)
        )
      )
        return false
      if (model.name.includes("embed")) return false
      return true
    })
    .reduce(
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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild aria-label={tooltipTextContent}>
            {trigger ?? (
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={open}
                className="h-8 justify-between gap-2 rounded-full border-border/60 bg-background/50 backdrop-blur-sm px-3 font-normal hover:bg-accent/50 hover:text-accent-foreground items-center">
                {selectedModel ? (
                  <div className="flex items-center gap-2">
                    <span className="text-lg leading-none">
                      {getModelIcon(selectedModel)}
                    </span>
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
                <ChevronDown className="size-4 opacity-50" />
              </Button>
            )}
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{tooltipTextContent}</TooltipContent>
      </Tooltip>

      <PopoverContent className="w-[320px] p-0" align="start">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {t("model.menu.models_label")}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={refresh}
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                aria-label={t("model.menu.refresh_aria_label")}>
                <RotateCcw
                  className={cn(
                    "h-3.5 w-3.5 transition-transform",
                    isLoading && "animate-spin"
                  )}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("model.menu.refresh_tooltip")}</TooltipContent>
          </Tooltip>
        </div>

        <Command className="max-h-[400px]">
          <div className="flex items-center border-b px-3">
            <CommandInput
              placeholder={t("model.menu.search_placeholder")}
              className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
              autoFocus
            />
          </div>
          <CommandList className="max-h-[300px] overflow-y-auto p-1">
            <CommandEmpty className="py-6 text-center text-sm">
              {t("model.menu.no_model_found")}
            </CommandEmpty>

            {Object.entries(groupedModels).map(([providerId, group]) => (
              <CommandGroup key={providerId} heading={group.name}>
                {group.models.map((model) => (
                  <CommandItem
                    key={`${providerId}-${model.name}`}
                    value={model.name}
                    onSelect={() => handleSelect(model.name)}
                    className="flex items-center gap-3 rounded-md px-2 py-2 mb-1 cursor-pointer aria-selected:bg-accent">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/50 text-xl">
                      {getModelIcon(model.name)}
                    </div>

                    <div className="flex flex-1 flex-col overflow-hidden">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-sm">
                          {model.name}
                        </span>
                        {selectedModel === model.name && (
                          <Check className="h-3.5 w-3.5 text-primary" />
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
                        {model.size ? (
                          <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                            {formatFileSize(model.size, t)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
