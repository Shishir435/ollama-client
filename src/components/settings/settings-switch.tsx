import type React from "react"
import { useEffect, useState } from "react"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

interface SettingsSwitchProps {
  label: React.ReactNode
  description?: React.ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  id?: string
  className?: string
}

export const SettingsSwitch = ({
  label,
  description,
  checked,
  onCheckedChange,
  id,
  className
}: SettingsSwitchProps) => {
  const [isDeepLinkHighlighted, setIsDeepLinkHighlighted] = useState(false)

  useEffect(() => {
    if (!id || typeof window === "undefined") return

    const focusTarget = new URLSearchParams(window.location.search).get("focus")
    if (focusTarget !== id) return

    setIsDeepLinkHighlighted(true)
    const timeoutId = window.setTimeout(() => {
      setIsDeepLinkHighlighted(false)
    }, 3500)

    return () => window.clearTimeout(timeoutId)
  }, [id])

  return (
    <div
      data-settings-focus="true"
      data-settings-focus-id={id}
      className={cn(
        "flex items-center justify-between rounded-lg border bg-card p-4 transition-colors hover:bg-accent/20 focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/30",
        isDeepLinkHighlighted &&
          "ring-2 ring-primary ring-offset-2 ring-offset-background",
        className
      )}>
      <div className="space-y-0.5">
        <Label htmlFor={id} className="text-base font-medium">
          {label}
        </Label>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}
