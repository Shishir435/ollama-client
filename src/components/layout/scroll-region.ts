/**
 * Props for a scroll container that is its own Tab stop.
 *
 * Chrome and Firefox put a scroller in the tab order so the keyboard can
 * scroll it, which is worth keeping for a long list. A Tab stop has to show
 * where it is and say what it is, though, or focus lands on a nameless box
 * with nothing drawn around it. The outline sits inside the edge because a
 * scroller's own parent usually clips anything drawn outside it.
 *
 * `style` clears the inline `outline: none` react-virtuoso puts on its
 * scroller, which no class can outrank.
 */
export const scrollRegionProps = (label: string) =>
  ({
    tabIndex: 0,
    role: "region",
    "aria-label": label,
    style: { outline: undefined }
  }) as const

export const SCROLL_REGION_FOCUS_CLASS =
  "outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-muted-foreground"
