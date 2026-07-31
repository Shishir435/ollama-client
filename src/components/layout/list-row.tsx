/**
 * @file Dense list-row geometry, shared by every icon + label + trailing-action
 * row in the side panel (context sheet toggles, tab list, upload cards).
 *
 * The rows these replaced each rebuilt the same grid by hand and drifted apart:
 * leading edges landed on 8/16/18/26px and trailing glyphs on 8/14/16px in one
 * sheet. The scale lives here instead:
 *
 * - Every leading glyph and title sits on one content edge, 10px in from the
 *   row's own container edge.
 * - A trailing hit-area carries its own internal padding, so its *box* inset is
 *   that 10px minus the control's padding. Bare text and glyphs pay the full
 *   10px. Same convention `button.tsx` uses for inline-end icons.
 * - A row nested inside an already-padded container (a scroll list's `p-1`)
 *   pays only the remainder, so the content edge stays put either way.
 */

import type React from "react"

import { cn } from "@/lib/utils"

/** Row padding and column gaps. `compact` tightens both. */
export type ListRowDensity = "default" | "compact"

/**
 * Which container the row sits in, and so how much inset it pays itself.
 *
 * - `container` — an unpadded parent, so the row pays the full 10px content
 *   edge.
 * - `nested` — an already-padded parent (a scroll list's `p-1`), so the row pays
 *   only the remainder and the content edge stays put.
 */
export type ListRowInset = "container" | "nested"

/**
 * What the trailing slot ends in, which decides who pays the trailing inset.
 *
 * - `text` — bare text or glyphs, so the row pays the full inset.
 * - `control` — a hit-area with its own padding, so the row pays that inset
 *   minus the control's padding.
 */
export type ListRowTrailingKind = "text" | "control"

/** Whether the row draws its own border. */
export type ListRowSurface = "none" | "outline"

const DENSITY: Record<ListRowDensity, string> = {
  default: "gap-x-2 gap-y-0.5 py-1.5",
  compact: "gap-x-1.5 gap-y-0.5 py-1"
}

const LEADING_INSET: Record<ListRowInset, string> = {
  container: "pl-2.5",
  nested: "pl-1.5"
}

const TRAILING_INSET: Record<
  ListRowInset,
  Record<ListRowTrailingKind, string>
> = {
  container: { text: "pr-2.5", control: "pr-1" },
  nested: { text: "pr-1.5", control: "pr-0.5" }
}

const SURFACE: Record<ListRowSurface, string> = {
  none: "",
  outline: "border border-border/40"
}

// Four static templates rather than one interpolated string so Tailwind can see
// every class it has to emit. Empty `auto` tracks would still take a column gap,
// which is the phantom-gutter bug this primitive exists to prevent.
const TEMPLATE = {
  both: "grid-cols-[auto_minmax(0,1fr)_auto]",
  leading: "grid-cols-[auto_minmax(0,1fr)]",
  trailing: "grid-cols-[minmax(0,1fr)_auto]",
  none: "grid-cols-[minmax(0,1fr)]"
} as const

interface ListRowSlots {
  /** Leading glyph column. Vertically centred on the first line. */
  leading?: React.ReactNode
  /** Trailing column: status glyphs, then at most one hit-area. */
  trailing?: React.ReactNode
  /**
   * Second line of the row's own label. Part of the label, so the trailing slot
   * centres on the whole block.
   */
  description?: React.ReactNode
  /**
   * Second line holding its own content or control, aligned to the content
   * column but spanning to the row's end. The trailing slot stays centred on the
   * title line, because it belongs to the title rather than to this block.
   */
  below?: React.ReactNode
  density?: ListRowDensity
  inset?: ListRowInset
  /** Whether the trailing slot ends in a hit-area that pays its own padding. */
  trailingKind?: ListRowTrailingKind
  surface?: ListRowSurface
  /**
   * Selection tint. Omit entirely for a static row: `undefined` means the row is
   * not selectable and gets no hover or selected treatment, which is different
   * from `false` (selectable, currently off).
   */
  active?: boolean
}

const listRowClass = ({
  density = "default",
  inset = "container",
  trailingKind = "text",
  surface = "none",
  active,
  hasLeading,
  hasTrailing,
  // A whole-row button is always interactive; a `ListRow` div only is when the
  // caller declared a selection state, because otherwise its children own their
  // own hover and a row-wide tint would fire on cursor-over-nothing.
  hoverable
}: Omit<ListRowSlots, "leading" | "trailing" | "description" | "below"> & {
  hasLeading: boolean
  hasTrailing: boolean
  hoverable: boolean
}) =>
  cn(
    "grid min-w-0 rounded-control text-left text-xs transition-colors",
    hasLeading && hasTrailing
      ? TEMPLATE.both
      : hasLeading
        ? TEMPLATE.leading
        : hasTrailing
          ? TEMPLATE.trailing
          : TEMPLATE.none,
    DENSITY[density],
    LEADING_INSET[inset],
    TRAILING_INSET[inset][trailingKind],
    SURFACE[surface],
    (hoverable || active !== undefined) &&
      "hover:bg-muted/35 hover:text-foreground",
    active === true && "bg-muted/55 text-foreground",
    active === false && "text-muted-foreground"
  )

const isFilled = (slot: React.ReactNode) =>
  slot !== undefined && slot !== null && slot !== false

const ListRowSlotContent = ({
  leading,
  trailing,
  description,
  below,
  children,
  hasLeading
}: Pick<ListRowSlots, "leading" | "trailing" | "description" | "below"> & {
  children?: React.ReactNode
  hasLeading: boolean
}) => {
  const contentColumn = hasLeading ? "col-start-2" : "col-start-1"
  return (
    <>
      {isFilled(leading) && (
        // `self-stretch` bounds the glyph to the row it is placed in, so it
        // centres on the label block: the title line alone, or title plus
        // description when the row's label runs to two lines.
        <div
          className={cn(
            "col-start-1 row-start-1 flex shrink-0 items-center self-stretch",
            isFilled(description) && "-row-end-1"
          )}>
          {leading}
        </div>
      )}
      <div
        className={cn(
          "row-start-1 flex min-w-0 items-center gap-1.5",
          contentColumn
        )}>
        {children}
      </div>
      {isFilled(description) && (
        <div className={cn("row-start-2 min-w-0", contentColumn)}>
          {description}
        </div>
      )}
      {isFilled(trailing) && (
        <div
          className={cn(
            "row-start-1 flex shrink-0 items-center gap-1 self-stretch",
            hasLeading ? "col-start-3" : "col-start-2",
            isFilled(description) && "-row-end-1"
          )}>
          {trailing}
        </div>
      )}
      {isFilled(below) && (
        <div
          className={cn(
            "-col-end-1 min-w-0",
            contentColumn,
            isFilled(description) ? "row-start-3" : "row-start-2"
          )}>
          {below}
        </div>
      )}
    </>
  )
}

export type ListRowProps = ListRowSlots & React.ComponentProps<"div">

/**
 * Layout shell for rows whose click targets are independent, so the row itself
 * stays a `div`. Carries no feature state — callers own the slots.
 *
 * Only hoverable once `active` is set, because otherwise the children own their
 * own hover and a row-wide tint would fire on cursor-over-nothing. Use
 * {@link ListRowButton} when the whole row is one target.
 */
export const ListRow = ({
  leading,
  trailing,
  description,
  below,
  density,
  inset,
  trailingKind,
  surface,
  active,
  className,
  children,
  ...props
}: ListRowProps) => {
  const hasLeading = isFilled(leading)
  return (
    <div
      className={cn(
        listRowClass({
          density,
          inset,
          trailingKind,
          surface,
          active,
          hasLeading,
          hasTrailing: isFilled(trailing),
          hoverable: false
        }),
        className
      )}
      {...props}>
      <ListRowSlotContent
        leading={leading}
        trailing={trailing}
        description={description}
        below={below}
        hasLeading={hasLeading}>
        {children}
      </ListRowSlotContent>
    </div>
  )
}

export type ListRowButtonProps = ListRowSlots & React.ComponentProps<"button">

/**
 * Same geometry as {@link ListRow} on a real `<button>`, for rows that are one
 * whole-row target. Always interactive, so it takes the hover tint without an
 * `active` prop, and adds the disabled and focus-ring treatments.
 */
export const ListRowButton = ({
  leading,
  trailing,
  description,
  below,
  density,
  inset,
  trailingKind,
  surface,
  active,
  className,
  children,
  type = "button",
  ...props
}: ListRowButtonProps) => {
  const hasLeading = isFilled(leading)
  return (
    <button
      type={type}
      className={cn(
        listRowClass({
          density,
          inset,
          trailingKind,
          surface,
          active,
          hasLeading,
          hasTrailing: isFilled(trailing),
          hoverable: true
        }),
        "w-full disabled:pointer-events-none disabled:opacity-50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
      {...props}>
      <ListRowSlotContent
        leading={leading}
        trailing={trailing}
        description={description}
        below={below}
        hasLeading={hasLeading}>
        {children}
      </ListRowSlotContent>
    </button>
  )
}

const listRowTitleClass = "min-w-0 flex-1 truncate text-left font-medium"

/** Truncating title for the content slot. */
export const ListRowTitle = ({
  className,
  ...props
}: React.ComponentProps<"span">) => (
  <span className={cn(listRowTitleClass, className)} {...props} />
)

/**
 * Same title, as its own hit-area. For rows whose title activates something
 * different from the trailing control, so the row itself must stay a `div`.
 */
export const ListRowTitleButton = ({
  className,
  type = "button",
  ...props
}: React.ComponentProps<"button">) => (
  <button
    type={type}
    className={cn(
      listRowTitleClass,
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      className
    )}
    {...props}
  />
)

/** Secondary line under the title, inside the content slot. */
export const ListRowDescription = ({
  className,
  ...props
}: React.ComponentProps<"p">) => (
  <p
    className={cn("truncate text-2xs text-muted-foreground", className)}
    {...props}
  />
)
