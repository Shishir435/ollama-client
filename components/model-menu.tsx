import type { OllamaModel } from "@/types";
import { Check, ChevronsUpDown } from "lucide-react"
 
import { cn } from "@/lib/utils"
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
import { useEffect, useState } from "react";
import { MESSAGE_KEYS } from "@/lib/constant";

function ModelMenu(){
    const [open, setOpen] = useState(false)
    const [value, setValue] = useState("")
    const [models, setModels] = useState<OllamaModel[] | null>(null)
      const [error, setError] = useState<string | null>(null)
    
      const fetchModels = () => {
        chrome.runtime.sendMessage({ type: MESSAGE_KEYS.OLLAMA.GET_MODELS }, (response) => {
          if (response.success) {
            setModels(response.data.models ?? [])
            console.log(models)
            setError(null)
          } else {
            setError("Failed to fetch models. Ensure Ollama is running. or see the local ollama url")
            setModels(null)
          }
        })
      }
    
      useEffect(()=>{
        fetchModels()
      },[])
    
 
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
        <Command>
          <CommandInput placeholder="Search model..." className="h-9" />
          <CommandList>
            <CommandEmpty>No framework found.</CommandEmpty>
            <CommandGroup>
              {models.map((model) => (
                <CommandItem
                  key={model.name}
                  value={model.name}
                  onSelect={(currentValue) => {
                    setValue(currentValue === value ? "" : currentValue)
                    setOpen(false)
                  }}
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