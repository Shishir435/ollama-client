import type React from "react"
import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface SettingsControlCardProps {
  label: React.ReactNode
  description?: React.ReactNode
  /** Rendered at the trailing edge: a switch, a select, a button. */
  control: React.ReactNode
  /** Settings-registry id — labels the control and receives `?focus=` deep links. */
  id?: string
  className?: string
  controlClassName?: string
}

/**
 * One settings control on its own card surface: label and description leading,
 * the control trailing.
 *
 * Extracted from `SettingsSwitch` when a select needed the same row. A bare
 * stacked field between two of these reads as a loose control floating between
 * cards, and rebuilding the surface by hand drifts — `Card` is `rounded-panel`
 * with a ring, not a border, so a hand-rolled row lands a different radius and
 * a different edge treatment beside its own neighbour.
 */
export const SettingsControlCard = ({
  label,
  description,
  control,
  id,
  className,
  controlClassName
}: SettingsControlCardProps) => {
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
      <div className={cn("mr-3 shrink-0", controlClassName)}>{control}</div>
    </Card>
  )
}
