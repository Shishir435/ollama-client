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
import { useOllamaModels } from "@/hooks/use-ollama-models"
import { STORAGE_KEYS } from "@/lib/constant"
import { cn } from "@/lib/utils"
import { Check, ChevronDown, RotateCcw } from "lucide-react"
import { useEffect, useState } from "react"

import { useStorage } from "@plasmohq/storage/hook"

import { InfoPopup } from "./info-popup" // your generic dialog

function ModelMenu() {
  const [open, setOpen] = useState(false)
  const [showErrorPopup, setShowErrorPopup] = useState(false)
  const [showEmptyPopup, setShowEmptyPopup] = useState(false)

  const [selectedModel, setSelectedModel] = useStorage<string>(
    STORAGE_KEYS.OLLAMA.SELECTED_MODEL,
    ""
  )
  const { models, error, refresh, loading } = useOllamaModels()

  useEffect(() => {
    if (error) {
      setShowErrorPopup(true)
    } else if (models && models.length === 0) {
      setShowEmptyPopup(true)
    }
  }, [error, models])

  useEffect(() => {
    if (models && models.length > 0 && !selectedModel) {
      setSelectedModel(models[0].model)
    }
  }, [models, selectedModel, setSelectedModel])

  const handleSelect = (currentValue: string) => {
    setSelectedModel(currentValue)
    setOpen(false)
  }

  if (showErrorPopup) {
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

  if (showEmptyPopup) {
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
      <PopoverTrigger asChild>
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
      </PopoverTrigger>

      <PopoverContent className="w-[200px] p-0">
        <div className="flex items-center justify-between border-b px-2 py-1 text-sm text-muted-foreground">
          <span>Models</span>
          <button
            onClick={refresh}
            className="transition-colors hover:text-foreground"
            title="Refresh models">
            <RotateCcw
              className={cn("transition-transform", loading && "animate-spin")}
              size={16}
            />
          </button>
        </div>

        <Command>
          <CommandInput placeholder="Search model..." className="h-9" />
          <CommandList>
            <CommandEmpty>No model found.</CommandEmpty>
            <CommandGroup>
              {models.map((model) => (
                <CommandItem
                  key={model.name}
                  value={model.name}
                  onSelect={handleSelect}
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
