import type React from "react"
import { createContext, useContext } from "react"
import { Card } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/class-names"

/**
 * True while a row renders inside a surface that already draws its own edge.
 *
 * `SettingsCard` provides it for its content, so a row placed in a card is a
 * plain line in that card instead of a second card drawn inside the first.
 */
const SettingsRowNestedContext = createContext(false)

/** Marks its children as sitting on a surface that already has an edge. */
export const SettingsRowSurface = ({
  children
}: {
  children: React.ReactNode
}) => (
  <SettingsRowNestedContext.Provider value>
    {children}
  </SettingsRowNestedContext.Provider>
)

export interface SettingsRowProps extends Omit<
  React.ComponentProps<"div">,
  "children"
> {
  label: React.ReactNode
  description?: React.ReactNode
  /** Id of the control the label names. */
  htmlFor?: string
  /**
   * Settings-registry id: the row receives `?focus=` deep links and search
   * highlights through `data-settings-focus-id`.
   */
  focusId?: string
  /** A glyph before the label, such as a data-category icon. */
  leading?: React.ReactNode
  /** A small badge or count beside the label. */
  meta?: React.ReactNode
  /** Rendered at the trailing edge: a switch, a select, a button, a badge. */
  control?: React.ReactNode
}

/**
 * The one settings row: label and `text-xs` description leading, the control
 * trailing.
 *
 * Standing alone it draws its own small card. Inside a `SettingsCard` it
 * draws no surface at all, which is what keeps a switch in a card from
 * becoming a card inside a card. A list of rows inside a card separates them
 * with `divide-y` on the list, not with borders on each row.
 */
export const SettingsRow = ({
  label,
  description,
  htmlFor,
  focusId,
  leading,
  meta,
  control,
  className,
  ...props
}: SettingsRowProps) => {
  const nested = useContext(SettingsRowNestedContext)
  const body = (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {leading}
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex min-w-0 items-center gap-2">
            {htmlFor ? (
              <Label htmlFor={htmlFor} className="text-sm font-medium">
                {label}
              </Label>
            ) : (
              <p className="text-sm font-medium">{label}</p>
            )}
            {meta}
          </div>
          {description && (
            <p className="max-w-prose text-xs text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>
      {control && <div className="shrink-0">{control}</div>}
    </>
  )
  const layout = "flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"

  if (nested) {
    return (
      <div
        data-settings-focus={focusId ? "true" : undefined}
        data-settings-focus-id={focusId}
        className={cn("flex rounded-control py-2", layout, className)}
        {...props}>
        {body}
      </div>
    )
  }

  return (
    <Card
      size="sm"
      data-settings-focus={focusId ? "true" : undefined}
      data-settings-focus-id={focusId}
      className={cn(
        "px-3 hover:bg-state-hover focus-within:ring-focus",
        layout,
        className
      )}
      {...props}>
      {body}
    </Card>
  )
}
