import { Check, ChevronsUpDown, RotateCcw } from "lucide-react"
 
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useOllamaModels } from "@/hooks/useOllamaModels"
import { cn } from "@/lib/utils"
import { useState } from "react"

function ModelMenu(){
    const [open, setOpen] = useState(false)
    const [value, setValue] = useState("")
    const {models, error,refresh,loading}=useOllamaModels()
    
  return (models?
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[200px] justify-between"
        >
          {value
            ? models.find((model) => model.name === value)?.name
            : "Select model..."}
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0">
        <div className="flex items-center justify-between px-2 py-1 border-b text-sm text-muted-foreground">
        <span>Models</span>
          <button
            onClick={refresh}
            className="hover:text-foreground transition-colors"
            title="Refresh models"
          >
            <RotateCcw className={cn("transition-transform", loading && "animate-spin")} size={16} />
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
                  onSelect={(currentValue) => {
                    setValue(currentValue === value ? "" : currentValue)
                    setOpen(false)
                  }}
                  className="capitalize"
                >
                  {model.name}
                  <Check
                    className={cn(
                      "ml-auto",
                      value === model.name ? "opacity-100" : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>: <p className="text-red-500">{error}</p>)
}

export default ModelMenu