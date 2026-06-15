import { useId, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { MiniBadge } from "@/components/ui/mini-badge"
import {
  type SettingsEntry,
  searchSettings
} from "@/features/settings/settings-registry"
import { Search } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

/** Registry tab key → the i18n key for that tab's nav label. */
const TAB_LABEL_KEYS: Record<string, string> = {
  general: "settings.tabs.general",
  models: "settings.tabs.models",
  providers: "settings.tabs.providers",
  context: "settings.tabs.context",
  embeddings: "settings.tabs.embeddings",
  contentExtraction: "settings.tabs.extraction",
  prompts: "settings.tabs.prompts",
  shortcuts: "settings.tabs.shortcuts",
  voices: "settings.tabs.voices",
  reset: "settings.tabs.reset",
  guides: "settings.tabs.guides"
}

const MAX_RESULTS = 8

interface SettingsSearchProps {
  /** Navigate to and highlight the chosen setting (sets tab + focus). */
  onSelect: (entry: SettingsEntry) => void
  className?: string
}

export const SettingsSearch = ({
  onSelect,
  className
}: SettingsSearchProps) => {
  const { t } = useTranslation()
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const blurTimer = useRef<number | null>(null)
  const listId = useId()

  const results = useMemo(
    () => (query.trim() ? searchSettings(query, t).slice(0, MAX_RESULTS) : []),
    [query, t]
  )

  const choose = (entry: SettingsEntry) => {
    onSelect(entry)
    setQuery("")
    setOpen(false)
  }

  return (
    <div className={cn("relative", className)}>
      <div className="relative">
        <Search className="icon-sm pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={listId}
          value={query}
          placeholder={t("settings.search.placeholder")}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Delay so a result mousedown registers before the list unmounts.
            blurTimer.current = window.setTimeout(() => setOpen(false), 120)
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("")
              setOpen(false)
            } else if (e.key === "Enter" && results[0]) {
              choose(results[0])
            }
          }}
          className="h-9 w-full rounded-control border border-input bg-background pl-8 pr-3 text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      </div>

      {open && results.length > 0 && (
        <ul
          id={listId}
          className="absolute z-50 mt-1 max-h-80 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md">
          {results.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                // mousedown fires before input blur, so the click survives.
                onMouseDown={(e) => {
                  e.preventDefault()
                  if (blurTimer.current) window.clearTimeout(blurTimer.current)
                  choose(entry)
                }}
                className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent">
                <span className="truncate">{t(entry.labelKey)}</span>
                <MiniBadge
                  text={t(TAB_LABEL_KEYS[entry.tab] ?? entry.tab)}
                  className="shrink-0"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
