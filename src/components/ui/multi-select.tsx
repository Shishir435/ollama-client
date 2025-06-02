import { useState } from "react"

import {
  Check,
  CheckIcon,
  ChevronsUpDown,
  Loader2,
  XCircle
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export type Option = {
  label: string
  value: string
  icon?: React.ComponentType<{ className?: string }>
}

export type MultiSelectProps = {
  options: Option[]
  defaultValue?: string[]
  onValueChange?: (values: string[]) => void
  maxCount?: number
  placeholder?: string
  variant?: "default" | "flat"
  statusForValue?: (value: string) => {
    loading: boolean
    error: Error | string | null
    data: unknown
  }
}

export function MultiSelect({
  options,
  defaultValue = [],
  onValueChange,
  maxCount = 3,
  placeholder = "Select items",
  variant = "default",
  statusForValue
}: MultiSelectProps) {
  const [selectedValues, setSelectedValues] = useState<string[]>(defaultValue)
  const [open, setOpen] = useState(false)

  const toggleOption = (value: string) => {
    const newValues = selectedValues.includes(value)
      ? selectedValues.filter((v) => v !== value)
      : [...selectedValues, value]

    setSelectedValues(newValues)
    onValueChange?.(newValues)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          className={cn(
            "flex h-auto w-full items-center justify-between rounded-xl border border-input bg-background px-3 py-2 text-sm",
            "cursor-pointer"
          )}>
          {selectedValues.length === 0 ? (
            <span className="text-muted-foreground">{placeholder}</span>
          ) : (
            <div className="flex max-w-[85%] flex-wrap gap-1">
              {selectedValues.slice(0, maxCount).map((value) => {
                const option = options.find((o) => o.value === value)
                const Icon = option?.icon
                const status = statusForValue?.(value)
                const isLoading = status?.loading
                const isError = !!status?.error
                const isSuccess = !status?.loading && !status?.error

                return (
                  <Badge
                    key={value}
                    variant="secondary"
                    className={cn(
                      "flex items-center gap-1 rounded-md px-2 py-1",
                      "bg-muted text-muted-foreground"
                    )}>
                    {Icon && <Icon className="h-4 w-4" />}
                    <span>{option?.label}</span>

                    {isLoading && (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                    {isSuccess && (
                      <CheckIcon className="h-4 w-4 text-green-500" />
                    )}
                    {isError && <XCircle className="h-4 w-4 text-red-500" />}

                    <XCircle
                      className="h-4 w-4 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleOption(value)
                      }}
                    />
                  </Badge>
                )
              })}
              {selectedValues.length > maxCount && (
                <span className="text-sm text-muted-foreground">
                  +{selectedValues.length - maxCount} more
                </span>
              )}
            </div>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 text-muted-foreground" />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0">
        <Command>
          <CommandInput placeholder={placeholder} />
          <CommandGroup>
            {options.map((option) => (
              <CommandItem
                key={option.value}
                onSelect={() => toggleOption(option.value)}>
                <div className="flex items-center gap-2">
                  {option.icon && <option.icon className="h-4 w-4" />}
                  <span>{option.label}</span>
                </div>
                {selectedValues.includes(option.value) && (
                  <Check className="ml-auto h-4 w-4" />
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
