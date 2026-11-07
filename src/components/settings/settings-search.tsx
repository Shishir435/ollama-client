import { Search } from "lucide-react"
import { type Ref, useEffect, useId, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { useBrowserBuiltInVisible } from "@/features/model/hooks/use-browser-built-in-visible"
import {
  SETTINGS_TAB_LABEL_KEYS,
  type SettingsTab
} from "@/features/settings/settings-registry"
import {
  buildSettingsSearchRecords,
  rankSettingsSearchRecords,
  type SettingsSearchRecord
} from "@/features/settings/settings-search-index"
import { cn } from "@/lib/class-names"
import { isMacPlatform } from "@/lib/platform"

/** Results shown first; "show more" raises the cap to the second figure. */
const INITIAL_RESULTS = 8
const EXPANDED_RESULTS = 40

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
  const [showAll, setShowAll] = useState(false)
  const listId = useId()
  const modKey = isMacPlatform() ? "⌘" : t("settings.search.shortcut_ctrl")

  const browserBuiltInVisible = useBrowserBuiltInVisible()
  const records = useMemo(() => {
    return buildSettingsSearchRecords(undefined, t, browserBuiltInVisible)
  }, [t, browserBuiltInVisible])

  const results = useMemo(
    () =>
      query.trim()
        ? rankSettingsSearchRecords(query, records, activeTab)
            .slice(0, showAll ? EXPANDED_RESULTS : INITIAL_RESULTS)
            .map((result) => result.record)
        : [],
    [activeTab, query, records, showAll]
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
          aria-controls={listOpen && results.length > 0 ? listId : undefined}
          aria-expanded={listOpen}
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
            setShowAll(false)
            setOpen(true)
          }}
          onFocus={() => {
            if (blurTimer.current) window.clearTimeout(blurTimer.current)
            setOpen(true)
          }}
          onBlur={() => {
            blurTimer.current = window.setTimeout(() => setOpen(false), 120)
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
            "h-9 w-full rounded-control border border-stroke-control bg-background pl-8 text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-focus",
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
        // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- the mousedown only keeps focus in the input; it is not a control
        <div
          // Keep focus in the input while the pointer works the list.
          onMouseDown={(event) => event.preventDefault()}
          className="absolute z-50 mt-1 max-h-96 w-full overflow-y-auto rounded-control border border-border bg-popover p-1 shadow-md">
          {results.length === 0 ? (
            <output
              id={listId}
              className="block px-2 py-1.5 text-sm text-muted-foreground">
              {t("settings.search.no_results", { query: query.trim() })}
            </output>
          ) : (
            <>
              <ul
                id={listId}
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-to-interactive-role -- custom popup listbox owned by the combobox; a native select cannot show a description and tab chip
                role="listbox"
                aria-label={t("settings.search.placeholder")}>
                {results.map((record, index) => {
                  const description = record.entry.descriptionKey
                    ? t(record.entry.descriptionKey)
                    : ""
                  const selected = index === activeIndex
                  return (
                    <li
                      key={`${record.entryId}:${record.sourceType}:${record.sourceOrder}`}
                      id={optionId(index)}
                      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-to-interactive-role -- option of the custom listbox above
                      role="option"
                      aria-selected={selected}
                      tabIndex={-1}
                      onClick={() => choose(record)}
                      onKeyDown={() => undefined}
                      onMouseMove={() => setActiveIndex(index)}
                      className={cn(
                        "flex cursor-pointer items-start justify-between gap-2 rounded-control px-2 py-1.5 text-sm",
                        selected && "bg-state-selected"
                      )}>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {record.displayLabel}
                        </span>
                        {record.displayContext && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {record.displayContext}
                          </span>
                        )}
                        {description &&
                          description !== record.entry.descriptionKey && (
                            <span className="line-clamp-1 text-xs text-muted-foreground">
                              {description}
                            </span>
                          )}
                      </span>
                      <span className="shrink-0 rounded-control bg-surface-sunken px-1.5 py-0.5 text-xs text-muted-foreground">
                        {t(SETTINGS_TAB_LABEL_KEYS[record.tab])}
                      </span>
                    </li>
                  )
                })}
              </ul>
              {!showAll && results.length === INITIAL_RESULTS && (
                <button
                  type="button"
                  className="mt-1 w-full rounded-control px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-state-hover"
                  onClick={() => setShowAll(true)}>
                  {t("settings.search.show_more")}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
