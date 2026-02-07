import type React from "react"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

interface SelectRowProps {
  label: React.ReactNode
  description?: React.ReactNode
  error?: string
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  children: React.ReactNode
  id?: string
  className?: string
  triggerClassName?: string
}

export const SelectRow = ({
  label,
  description,
  error,
  value,
  onValueChange,
  placeholder,
  children,
  id,
  className,
  triggerClassName
}: SelectRowProps) => {
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={id} className="flex items-center gap-2 text-sm">
        {label}
      </Label>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={id} className={triggerClassName}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
