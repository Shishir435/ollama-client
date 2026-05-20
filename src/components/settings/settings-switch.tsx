import type React from "react"
import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
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
    <Card
      size="sm"
      data-settings-focus="true"
      data-settings-focus-id={id}
      className={cn(
        "flex-row items-center justify-between hover:bg-accent/20 focus-within:ring-ring/30",
        isDeepLinkHighlighted &&
          "ring-2 ring-primary ring-offset-2 ring-offset-background",
        className
      )}>
      <CardContent className="flex-1">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </CardContent>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="mr-3"
      />
    </Card>
  )
}
