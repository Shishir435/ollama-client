import { Search } from "lucide-react"
import { type Ref, useEffect, useId, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { useBrowserBuiltInVisible } from "@/features/model/hooks/use-browser-built-in-visible"
import type { SettingsTab } from "@/features/settings/settings-registry"
import {
  buildSettingsSearchRecords,
  rankSettingsSearchRecords,
  type SettingsSearchRecord
} from "@/features/settings/settings-search-index"
import { cn } from "@/lib/class-names"

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
  permissions: "settings.tabs.permissions",
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
  const { t } = useTranslation()
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const blurTimer = useRef<number | null>(null)
  const resultsRef = useRef<HTMLSelectElement>(null)
  const listId = useId()
  const modKey =
    typeof navigator !== "undefined" &&
    navigator.platform.toUpperCase().includes("MAC")
      ? "⌘"
      : "Ctrl"

  const browserBuiltInVisible = useBrowserBuiltInVisible()
  const records = useMemo(() => {
    return buildSettingsSearchRecords(undefined, t, browserBuiltInVisible)
  }, [t, browserBuiltInVisible])

  const results = useMemo(
    () =>
      query.trim()
        ? rankSettingsSearchRecords(query, records, activeTab)
            .slice(0, MAX_RESULTS)
            .map((result) => result.record)
        : [],
    [activeTab, query, records]
  )
  const [requestedIndex, setActiveIndex] = useState(0)
  /** Results can shrink without a keystroke (records load late, tab changes). */
  const activeIndex = Math.max(0, Math.min(requestedIndex, results.length - 1))
  const hasQuery = query.trim().length > 0
  const listOpen = open && hasQuery
  const activeRecord = listOpen ? results[activeIndex] : undefined
  const optionId = (index: number) => `${listId}-option-${index}`

  useEffect(() => {
    if (!listOpen) return
    document
      .getElementById(`${listId}-option-${activeIndex}`)
      ?.scrollIntoView?.({ block: "nearest" })
  }, [activeIndex, listId, listOpen])

  const choose = (record: SettingsSearchRecord) => {
    if (blurTimer.current) window.clearTimeout(blurTimer.current)
    document.getElementById(`${listId}-input`)?.focus()
    onSelect(record)
    setQuery("")
    setActiveIndex(0)
    setOpen(false)
  }

  useEffect(
    () => () => {
      if (blurTimer.current) window.clearTimeout(blurTimer.current)
    },
    []
  )

  return (
    <div className={cn("relative", className)}>
      <div className="relative">
        <Search className="icon-sm pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          id={`${listId}-input`}
          type="search"
          role="combobox"
          aria-label={t("settings.search.placeholder")}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={listOpen}
          aria-controls={listOpen && results.length > 0 ? listId : undefined}
          aria-describedby={
            listOpen && results.length === 0 ? listId : undefined
          }
          aria-activedescendant={
            activeRecord ? optionId(activeIndex) : undefined
          }
          value={query}
          placeholder={t("settings.search.placeholder")}
          onChange={(e) => {
            setQuery(e.target.value)
            setActiveIndex(0)
            setOpen(true)
          }}
          onFocus={() => {
            if (blurTimer.current) window.clearTimeout(blurTimer.current)
            setOpen(true)
          }}
          onBlur={() => {
            blurTimer.current = window.setTimeout(() => {
              if (resultsRef.current !== document.activeElement) {
                setOpen(false)
              }
            }, 120)
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("")
              setActiveIndex(0)
              setOpen(false)
            } else if (e.key === "ArrowDown" && results.length > 0) {
              e.preventDefault()
              setOpen(true)
              setActiveIndex((activeIndex + 1) % results.length)
            } else if (e.key === "ArrowUp" && results.length > 0) {
              e.preventDefault()
              setOpen(true)
              setActiveIndex(
                (activeIndex - 1 + results.length) % results.length
              )
            } else if (e.key === "Enter" && results[activeIndex]) {
              e.preventDefault()
              choose(results[activeIndex])
            }
          }}
          className={cn(
            "h-9 w-full rounded-control border border-input bg-background pl-8 text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-focus",
            showShortcutHint ? "pr-20" : "pr-3"
          )}
        />
        {showShortcutHint && (
          <KbdGroup
            aria-label={t("settings.search.shortcut_label")}
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
            <Kbd>{modKey}</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        )}
      </div>

      {listOpen && (
        <div className="absolute z-50 mt-1 max-h-80 w-full overflow-y-auto rounded-control border border-border bg-popover p-1 shadow-md">
          {results.length === 0 ? (
            <output
              id={listId}
              className="px-2 py-1.5 text-sm text-muted-foreground">
              {t("settings.search.no_results", { query: query.trim() })}
            </output>
          ) : (
            <select
              ref={resultsRef}
              id={listId}
              aria-label={t("settings.search.placeholder")}
              size={Math.max(2, results.length)}
              value={String(activeIndex)}
              onFocus={() => {
                if (blurTimer.current) window.clearTimeout(blurTimer.current)
              }}
              onBlur={() => {
                blurTimer.current = window.setTimeout(() => setOpen(false), 120)
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault()
                  setOpen(false)
                  document.getElementById(`${listId}-input`)?.focus()
                }
              }}
              onChange={(event) => {
                const record = results[Number(event.currentTarget.value)]
                if (record) choose(record)
              }}
              className="w-full border-0 bg-transparent text-sm outline-none">
              {results.map((record, index) => (
                <option
                  key={`${record.entryId}:${record.sourceType}:${record.sourceOrder}`}
                  id={optionId(index)}
                  value={String(index)}
                  onClick={() => {
                    if (index === activeIndex) choose(record)
                  }}>
                  {record.displayLabel} ·{" "}
                  {t(TAB_LABEL_KEYS[record.tab] ?? record.tab)}
                  {record.displayContext ? ` · ${record.displayContext}` : ""}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  )
}
