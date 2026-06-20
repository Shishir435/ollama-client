import { type Ref, useId, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { MiniBadge } from "@/components/ui/mini-badge"
import type { SettingsTab } from "@/features/settings/settings-registry"
import {
  buildSettingsSearchRecords,
  rankSettingsSearchRecords,
  type SettingsSearchRecord
} from "@/features/settings/settings-search-index"
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
  onSelect: (record: SettingsSearchRecord) => void
  activeTab?: SettingsTab
  className?: string
  inputRef?: Ref<HTMLInputElement>
  showShortcutHint?: boolean
}

export const SettingsSearch = ({
  onSelect,
  activeTab,
  className,
  inputRef,
  showShortcutHint = false
}: SettingsSearchProps) => {
  const { i18n, t } = useTranslation()
  const language = i18n.language
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const blurTimer = useRef<number | null>(null)
  const listId = useId()
  const modKey =
    typeof navigator !== "undefined" &&
    navigator.platform.toUpperCase().includes("MAC")
      ? "⌘"
      : "Ctrl"

  const records = useMemo(() => {
    void language
    return buildSettingsSearchRecords(undefined, t)
  }, [language, t])

  const results = useMemo(
    () =>
      query.trim()
        ? rankSettingsSearchRecords(query, records, activeTab)
            .slice(0, MAX_RESULTS)
            .map((result) => result.record)
        : [],
    [activeTab, query, records]
  )

  const choose = (record: SettingsSearchRecord) => {
    onSelect(record)
    setQuery("")
    setOpen(false)
  }

  return (
    <div className={cn("relative", className)}>
      <div className="relative">
        <Search className="icon-sm pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
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
          className={cn(
            "h-9 w-full rounded-control border border-input bg-background pl-8 text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring/40",
            showShortcutHint ? "pr-20" : "pr-3"
          )}
        />
        {showShortcutHint && (
          <KbdGroup
            aria-label="Search settings shortcut"
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
            <Kbd>{modKey}</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        )}
      </div>

      {open && results.length > 0 && (
        <ul
          id={listId}
          className="absolute z-50 mt-1 max-h-80 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md">
          {results.map((record) => (
            <li
              key={`${record.entryId}:${record.sourceType}:${record.sourceOrder}`}>
              <button
                type="button"
                // mousedown fires before input blur, so the click survives.
                onMouseDown={(e) => {
                  e.preventDefault()
                  if (blurTimer.current) window.clearTimeout(blurTimer.current)
                  choose(record)
                }}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent">
                <span className="truncate">{record.displayLabel}</span>
                <MiniBadge
                  text={t(TAB_LABEL_KEYS[record.tab] ?? record.tab)}
                  className="row-span-2 shrink-0"
                />
                {record.displayContext && (
                  <span className="truncate text-xs text-muted-foreground">
                    {record.displayContext}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
