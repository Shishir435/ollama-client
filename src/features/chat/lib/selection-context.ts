import type { SelectionContextItem } from "@/features/chat/stores/selection-context-store"

/**
 * One staged passage as the quoted block the model reads: the text, then
 * where it came from. A block quote is what the composer already produces for
 * a selection sent from the context menu, so both read the same in history.
 */
export const formatSelectionContextItem = (
  item: SelectionContextItem
): string => {
  const quoted = item.text
    .trim()
    .split("\n")
    .map((line) => `> ${line}`.trimEnd())
    .join("\n")
  /** One line, so no part of the title escapes the quote. */
  const title = item.title?.replace(/\s+/g, " ").trim()
  const source = [title, item.url ? `(${item.url})` : ""]
    .filter(Boolean)
    .join(" ")
  return source ? `${quoted}\n> — Source: ${source}` : quoted
}

/** The typed message with every staged passage quoted ahead of it. */
export const withSelectionContext = (
  typed: string,
  items: readonly SelectionContextItem[]
): string =>
  items.length === 0
    ? typed
    : [...items.map(formatSelectionContextItem), typed]
        .filter((block) => block.length > 0)
        .join("\n\n")
