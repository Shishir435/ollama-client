import { useStorage } from "@plasmohq/storage/hook"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

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
import { DEFAULT_PROVIDER_ID, STORAGE_KEYS } from "@/lib/constants"
import { Check, ChevronDown, RotateCcw } from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { getProviderDisplayName } from "@/lib/providers/registry"
import { cn } from "@/lib/utils"

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
    if (_onSelectModel) {
      _onSelectModel(modelName) // for chat message region
    } else {
      setSelectedModel(modelName) // for global selection
    }
    setOpen(false)
  }

  if (!models) return null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild aria-label={tooltipTextContent}>
            {trigger ?? (
              <div
                role="combobox"
                aria-expanded={open}
                tabIndex={0}
                className="cursor-pointer justify-between">
                <div className="flex items-center gap-2 capitalize">
                  {selectedModel
                    ? models.find((m) => m.name === selectedModel)?.name
                    : t("model.menu.select_placeholder")}
                  <ChevronDown className="opacity-50" size="16" />
                </div>
              </div>
            )}
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{tooltipTextContent}</TooltipContent>
      </Tooltip>

      <PopoverContent className="w-[200px] p-0">
        <div className="flex items-center justify-between border-b px-2 py-1 text-sm text-muted-foreground">
          <span>{t("model.menu.models_label")}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={refresh}
                variant="link"
                size="sm"
                aria-label={t("model.menu.refresh_aria_label")}>
                <RotateCcw
                  className={cn(
                    "transition-transform",
                    isLoading && "animate-spin"
                  )}
                  size={8}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("model.menu.refresh_tooltip")}</TooltipContent>
          </Tooltip>
        </div>

        <Command>
          <CommandInput
            placeholder={t("model.menu.search_placeholder")}
            className="h-9"
            autoFocus
          />
          <CommandList>
            <CommandEmpty>{t("model.menu.no_model_found")}</CommandEmpty>

            {/* Group models by provider */}
            {Object.entries(
              models
                .filter((model) => {
                  // Filter out embedding models
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
            ).map(([providerId, group]) => (
              <CommandGroup key={providerId} heading={group.name}>
                {group.models.map((model) => (
                  <CommandItem
                    key={`${providerId}-${model.name}`}
                    value={model.name}
                    onSelect={() => handleSelect(model.name)}
                    className="capitalize">
                    {model.name}
                    <Check
                      className={cn(
                        "ml-auto",
                        selectedModel === model.name
                          ? "opacity-100"
                          : "opacity-0"
                      )}
                    />
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
