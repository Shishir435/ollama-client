import type { LucideIcon } from "lucide-react"
import type React from "react"
import { cn } from "@/lib/utils"

/**
 * How much room the state claims.
 *
 * - `comfortable` — fills a page or dialog body, so it reserves height and
 *   leads with a large glyph.
 * - `compact` — sits inside a dense list where reserved height would push the
 *   list's own rows out of view. Side-panel lists hand-rolled a bare `<p>`
 *   rather than use this component while `comfortable` was the only option.
 */
export type EmptyStateDensity = "comfortable" | "compact"

interface EmptyStateProps extends Omit<React.ComponentProps<"div">, "title"> {
  icon?: LucideIcon
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  density?: EmptyStateDensity
}

export const EmptyState = ({
  icon: Icon,
  title,
  description,
  actions,
  density = "comfortable",
  className,
  ...props
}: EmptyStateProps) => {
  const isCompact = density === "compact"
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        isCompact ? "gap-1 px-2 py-3" : "min-h-48 px-4",
        className
      )}
      {...props}>
      {Icon &&
        (isCompact ? (
          <Icon className="icon-sm text-muted-foreground/50" />
        ) : (
          <div className="mb-4 rounded-full bg-muted/30 p-4">
            <Icon className="icon-3xl text-muted-foreground/40" />
          </div>
        ))}
      <h3
        className={cn(
          "font-medium",
          isCompact
            ? "text-xs text-muted-foreground"
            : "mb-1 text-sm text-foreground"
        )}>
        {title}
      </h3>
      {description && (
        <p
          className={cn(
            "text-muted-foreground",
            isCompact ? "text-2xs" : "max-w-sm text-xs"
          )}>
          {description}
        </p>
      )}
      {actions && (
        <div className={isCompact ? undefined : "mt-4"}>{actions}</div>
      )}
    </div>
  )
}
