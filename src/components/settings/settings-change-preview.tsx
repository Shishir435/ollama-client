import type { SettingWrite } from "@/features/settings/apply-settings"

/** camelCase / kebab / snake → "Sentence case" words. */
const humanize = (raw: string): string => {
  const spaced = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .trim()
    .toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

// Strip a leading store prefix from a scalar key so the label reads cleanly
// (e.g. "chat-max-tab-context-chars" → "Max tab context chars").
const STORE_PREFIX = /^(chat|embeddings|provider|browser|file-upload|image)-/

const labelFor = (write: SettingWrite): string =>
  write.field
    ? humanize(write.field)
    : humanize(write.storageKey.replace(STORE_PREFIX, ""))

const formatValue = (value: unknown): string => {
  if (typeof value === "boolean") return value ? "On" : "Off"
  if (typeof value === "string") return value
  return String(value)
}

interface SettingsChangePreviewProps {
  writes: SettingWrite[]
}

/**
 * A modern, readable preview of a batch of settings changes — one labeled row
 * per change with the value as a pill. Shared by the preset apply dialog and
 * per-card reset so both read the same way. Uses block/flex spans (not divs) so
 * it can live inside a dialog description element.
 */
export const SettingsChangePreview = ({
  writes
}: SettingsChangePreviewProps) => (
  <span className="mt-2 flex max-h-64 flex-col gap-1 overflow-y-auto">
    {writes.map((write) => (
      <span
        key={`${write.storageKey}.${write.field ?? ""}`}
        className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-2.5 py-1.5">
        <span className="min-w-0 truncate text-xs text-foreground">
          {labelFor(write)}
        </span>
        <span className="shrink-0 rounded bg-background px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          {formatValue(write.value)}
        </span>
      </span>
    ))}
  </span>
)
