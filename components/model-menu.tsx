import { InfoPopup } from "@/components/info-popup"
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
import { useOllamaModels } from "@/hooks/use-ollama-models"
import { STORAGE_KEYS } from "@/lib/constant"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { cn } from "@/lib/utils"
import { Check, ChevronDown, RotateCcw } from "lucide-react"
import { useEffect, useState } from "react"

import { useStorage } from "@plasmohq/storage/hook"

interface ModelMenuProps {
  trigger?: React.ReactNode
  onSelectModel?: (model: string) => void
  tooltipTextContent: string
  showStatusPopup?: boolean
}

function ModelMenu({
  trigger,
  onSelectModel,
  tooltipTextContent,
  showStatusPopup = true
}: ModelMenuProps) {
  const [open, setOpen] = useState(false)
  const [showEmptyPopup, setShowEmptyPopup] = useState(false)
  const [showErrorPopup, setShowErrorPopup] = useState(false)
  const [selectedModel, setSelectedModel] = useStorage<string>(
    { key: STORAGE_KEYS.OLLAMA.SELECTED_MODEL, instance: plasmoGlobalStorage },
    ""
  )

  const { status, models, error, refresh, loading } = useOllamaModels()

  useEffect(() => {
    if (status === "ready" && models.length > 0 && !selectedModel) {
      setSelectedModel(models[0].name)
    }
  }, [status, models, selectedModel, setSelectedModel])

  const handleSelect = (modelName: string) => {
    if (onSelectModel) {
      onSelectModel(modelName) // for chat message region
    } else {
      setSelectedModel(modelName) // for global selection
    }
    setOpen(false)
  }

  if (showStatusPopup && status === "error") {
    setShowErrorPopup(true)
    return (
      <InfoPopup
        open={showErrorPopup}
        onClose={() => setShowErrorPopup(false)}
        title="Failed to Load Models"
        message={error!}
        type="error"
        actionButton={<Button onClick={refresh}>Retry</Button>}
      />
    )
  }

  if (showStatusPopup && status === "empty") {
    setShowEmptyPopup(true)
    return (
      <InfoPopup
        open={showEmptyPopup}
        onClose={() => setShowEmptyPopup(false)}
        title="No Models Found"
        message="Please pull at least one model in Ollama to get started."
        type="warning"
        actionButton={<Button onClick={refresh}>Refresh</Button>}
      />
    )
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
                className="cursor-pointer justify-between">
                <div className="flex items-center gap-2 capitalize">
                  {selectedModel
                    ? models.find((m) => m.name === selectedModel)?.name
                    : "Select model..."}
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
          <span>Models</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={refresh}
                variant="link"
                size="sm"
                aria-label="Refresh models">
                <RotateCcw
                  className={cn(
                    "transition-transform",
                    loading && "animate-spin"
                  )}
                  size={8}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh models</TooltipContent>
          </Tooltip>
        </div>

        <Command>
          <CommandInput
            placeholder="Search model..."
            className="h-9"
            autoFocus
          />
          <CommandList>
            <CommandEmpty>No model found.</CommandEmpty>
            <CommandGroup>
              {models.map((model) => (
                <CommandItem
                  key={model.name}
                  value={model.name}
                  onSelect={() => handleSelect(model.name)}
                  className="capitalize">
                  {model.name}
                  <Check
                    className={cn(
                      "ml-auto",
                      selectedModel === model.name ? "opacity-100" : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export default ModelMenu
