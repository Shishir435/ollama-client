import { ArrowDownAZ, ArrowDownZA, RotateCcw, Search } from "lucide-react"
import type { ComponentProps, ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import {
  HEALTH_DOT_CLASS,
  type HealthTone
} from "@/features/model/hooks/use-connection-health"
import { cn } from "@/lib/class-names"

/** The pieces the chat and embedding views of the model menu share. */

export type SortDirection = "asc" | "desc"

/** Name order both lists use; `tiebreak` separates same-named rows. */
export const compareModelNames = (
  direction: SortDirection,
  left: string,
  right: string,
  tiebreak = 0
) => {
  const order =
    left.localeCompare(right, "en", { numeric: true, sensitivity: "base" }) ||
    left.localeCompare(right, "en", { sensitivity: "variant" }) ||
    tiebreak
  return direction === "asc" ? order : -order
}

/**
 * An icon-only rail button that names itself on hover and on keyboard focus;
 * a native `title` only appears for a pointer.
 */
export const RailButton = ({
  label,
  ariaLabel,
  selected,
  className,
  children,
  ...props
}: Omit<ComponentProps<"button">, "aria-label" | "title"> & {
  label: string
  ariaLabel?: string
  selected?: boolean
}) => (
  <Tooltip>
    <TooltipTrigger
      render={
        <button
          type="button"
          aria-label={ariaLabel ?? label}
          aria-pressed={selected}
          className={cn(
            "relative flex size-9 shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            selected && "bg-state-selected text-foreground shadow-sm",
            className
          )}
          {...props}
        />
      }>
      {children}
    </TooltipTrigger>
    <TooltipContent side="right">{label}</TooltipContent>
  </Tooltip>
)

export const RailDivider = () => (
  <div className="my-0.5 h-px w-7 shrink-0 bg-border/60" />
)

/** Marks the source the current selection comes from. */
export const SelectedSourceDot = () => (
  <span className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" />
)

/** A status dot pinned to a corner of the icon it describes. */
export const HealthDot = ({
  tone,
  className
}: {
  tone: HealthTone
  className?: string
}) => (
  <span
    aria-hidden="true"
    data-health-tone={tone}
    className={cn(
      "absolute size-2 rounded-full ring-2 ring-surface-overlay",
      HEALTH_DOT_CLASS[tone],
      className
    )}
  />
)

/** Title, count, A–Z toggle, any extra actions, then refresh. */
export const MenuListHeader = ({
  title,
  count,
  sortDirection,
  onSort,
  onRefresh,
  refreshing,
  children
}: {
  title: ReactNode
  count: number
  sortDirection: SortDirection
  /** Omitted where there is nothing to order. */
  onSort?: () => void
  onRefresh: () => void
  refreshing: boolean
  children?: ReactNode
}) => {
  const { t } = useTranslation()
  const sortLabel = t(
    sortDirection === "asc" ? "model.menu.sort_za" : "model.menu.sort_az"
  )
  const SortIcon = sortDirection === "asc" ? ArrowDownAZ : ArrowDownZA
  return (
    <div className="flex items-center gap-1 px-2 py-1">
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold">{title}</p>
        <p className="text-micro text-muted-foreground tabular-nums">
          {count} {t("model.menu.models_label")}
        </p>
      </div>
      {onSort && (
        <TooltipActionButton
          onClick={onSort}
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          label={sortDirection === "asc" ? "A–Z" : "Z–A"}
          showLabel
          ariaLabel={sortLabel}
          tooltip={sortLabel}
          icon={<SortIcon aria-hidden="true" className="icon-sm" />}
        />
      )}
      {children}
      <TooltipActionButton
        onClick={onRefresh}
        variant="ghost"
        size="icon"
        className="size-7"
        ariaLabel={t("model.menu.refresh_aria_label")}
        tooltip={t("model.menu.refresh_tooltip")}
        icon={
          <RotateCcw
            className={cn(
              "icon-sm transition-transform",
              refreshing && "animate-spin"
            )}
          />
        }
      />
    </div>
  )
}

/** The search box both lists filter with. */
export const MenuSearch = (props: ComponentProps<typeof Input>) => {
  const { t } = useTranslation()
  return (
    <div className="relative px-1 pb-1">
      <Search className="icon-sm pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder={t("model.menu.search_placeholder")}
        aria-label={t("model.menu.search_placeholder")}
        className="h-8 pl-8 text-xs"
        {...props}
      />
    </div>
  )
}
