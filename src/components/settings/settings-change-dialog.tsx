import type React from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import type { SettingWrite } from "@/features/settings/apply-settings"
import { getPresetFieldMeta } from "@/features/settings/preset-field-meta"
import { Info, type LucideIcon } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

/** camelCase / kebab / snake → "Sentence case". */
const humanize = (raw: string): string => {
  const spaced = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .trim()
    .toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

const STORE_PREFIX = /^(chat|embeddings|provider|browser|file-upload|image)-/

/** A non-interactive toggle visual reflecting an on/off preview value. */
const TogglePreview = ({ on }: { on: boolean }) => (
  <span
    aria-hidden
    className={cn(
      "relative inline-flex h-4.5 w-7.5 shrink-0 items-center rounded-full transition-colors",
      on ? "bg-primary" : "bg-input"
    )}>
    <span
      className={cn(
        "absolute size-3.5 rounded-full bg-white shadow transition-all",
        on ? "right-0.5" : "left-0.5"
      )}
    />
  </span>
)

interface SettingsChangeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  busy?: boolean
  /** Icon shown in the header badge. */
  icon: LucideIcon
  title: React.ReactNode
  description?: React.ReactNode
  /** The changes to preview. */
  writes: SettingWrite[]
  confirmLabel: string
  confirmIcon?: LucideIcon
  onConfirm: () => void
  /** Optional reassurance line in the footer. */
  footnote?: React.ReactNode
}

/**
 * A wide, settings-screen-style confirmation for applying a batch of changes
 * (presets, per-card reset). Each change is a row: icon + label + description +
 * a value control (toggle preview for booleans, a value pill otherwise). Far
 * more legible than a `key = value` dump.
 */
export const SettingsChangeDialog = ({
  open,
  onOpenChange,
  busy = false,
  icon: HeaderIcon,
  title,
  description,
  writes,
  confirmLabel,
  confirmIcon: ConfirmIcon,
  onConfirm,
  footnote
}: SettingsChangeDialogProps) => {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader className="flex-row items-start gap-3 pr-6">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-panel bg-primary/10 text-primary">
            <HeaderIcon className="icon-lg" />
          </span>
          <span className="min-w-0 flex-1 space-y-1">
            <DialogTitle className="text-base">{title}</DialogTitle>
            {description && (
              <DialogDescription>{description}</DialogDescription>
            )}
          </span>
        </DialogHeader>

        <div className="max-h-[50vh] overflow-y-auto rounded-panel border border-border/60">
          {writes.map((write, index) => {
            const meta = getPresetFieldMeta(write)
            const Icon = meta.icon
            const label = meta.labelKey
              ? t(meta.labelKey)
              : write.field
                ? humanize(write.field)
                : humanize(write.storageKey.replace(STORE_PREFIX, ""))
            const isBool = typeof write.value === "boolean"
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: settings preview rows can share storageKey/field; index suffix prevents future key collisions
                key={`${write.storageKey}.${write.field ?? "__scalar__"}.${index}`}
                className="flex items-center gap-3 px-3 py-2.5 not-last:border-b not-last:border-border/40">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-control bg-muted/50 text-muted-foreground">
                  <Icon className="icon-md" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {label}
                  </span>
                  {meta.descriptionKey && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {t(meta.descriptionKey)}
                    </span>
                  )}
                </span>
                {isBool ? (
                  <span className="flex shrink-0 items-center gap-2">
                    <TogglePreview on={write.value as boolean} />
                    <span className="w-6 text-xs text-muted-foreground">
                      {write.value
                        ? t("common.toggle.on")
                        : t("common.toggle.off")}
                    </span>
                  </span>
                ) : (
                  <span className="shrink-0 rounded-control border border-border bg-muted/30 px-2 py-1 font-mono text-xs text-foreground">
                    {String(write.value)}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        <DialogFooter className="items-center sm:justify-between">
          {footnote ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Info className="icon-sm shrink-0" />
              {footnote}
            </p>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <DialogClose
              render={
                <Button variant="outline" size="sm" disabled={busy}>
                  {t("common.cancel")}
                </Button>
              }
            />
            <Button size="sm" disabled={busy} onClick={onConfirm}>
              {ConfirmIcon && <ConfirmIcon className="icon-md" />}
              {confirmLabel}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
