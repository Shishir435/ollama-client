import { Quote, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useSelectionContext } from "@/features/chat/stores/selection-context-store"

const preview = (text: string, max = 80): string => {
  const compact = text.replace(/\s+/g, " ").trim()
  return compact.length > max ? `${compact.slice(0, max)}…` : compact
}

/**
 * The page text staged for the next message, one removable chip per passage.
 * Removing a chip is the whole of "I changed my mind": nothing is sent for it.
 */
export function SelectionContextChips() {
  const { t } = useTranslation()
  const { items, remove } = useSelectionContext()
  if (items.length === 0) return null

  return (
    <ul
      aria-label={t("chat.selection_context.label")}
      className="flex flex-wrap gap-1 px-3 pt-2">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex max-w-full items-center gap-1 rounded-control border border-border bg-surface-sunken py-0.5 pl-1.5 pr-0.5 text-xs text-muted-foreground"
          title={
            [item.title, item.url].filter(Boolean).join("\n") || undefined
          }>
          <Quote className="icon-xs shrink-0" />
          <span className="min-w-0 truncate">{preview(item.text)}</span>
          <button
            type="button"
            className="shrink-0 rounded-control p-0.5 hover:bg-state-hover hover:text-foreground"
            aria-label={t("chat.selection_context.remove", {
              text: preview(item.text, 30)
            })}
            onClick={() => remove(item.id)}>
            <X className="icon-xs" />
          </button>
        </li>
      ))}
    </ul>
  )
}
