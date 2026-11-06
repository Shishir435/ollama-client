import { X } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useSynchronizedDraft } from "@/hooks/use-synchronized-draft"

interface SessionTagsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tags: string[]
  onSave: (tags: string[]) => Promise<void>
}

/**
 * One label as stored: trimmed, without a leading `#` (the list adds its own),
 * empty when nothing is left.
 */
const normalizeTag = (raw: string) => raw.trim().replace(/^#+/, "").trim()

/** Add every tag in `raw` (comma-separated) that is not already present, ignoring case. */
export const mergeTags = (current: string[], raw: string): string[] => {
  const next = [...current]
  for (const piece of raw.split(",")) {
    const tag = normalizeTag(piece)
    if (!tag) continue
    if (next.some((existing) => existing.toLowerCase() === tag.toLowerCase()))
      continue
    next.push(tag)
  }
  return next
}

export const SessionTagsDialog = ({
  open,
  onOpenChange,
  tags,
  onSave
}: SessionTagsDialogProps) => {
  const { t } = useTranslation()
  const [draftTags, setDraftTags] = useSynchronizedDraft(
    JSON.stringify([open, tags]),
    tags
  )
  const [value, setValue] = useState("")
  const [saving, setSaving] = useState(false)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("sessions.tags.title")}</DialogTitle>
          <DialogDescription>
            {t("sessions.tags.description")}
          </DialogDescription>
        </DialogHeader>
        {draftTags.length > 0 && (
          <ul
            className="flex flex-wrap gap-1.5"
            aria-label={t("sessions.tags.title")}>
            {draftTags.map((tag) => (
              <li
                key={tag}
                className="inline-flex items-center gap-1 rounded-chip bg-muted py-0.5 pl-2 pr-1 text-xs text-foreground">
                #{tag}
                <button
                  type="button"
                  className="inline-flex size-4 items-center justify-center rounded-chip text-muted-foreground hover:bg-state-hover hover:text-foreground"
                  aria-label={t("sessions.tags.remove", { tag })}
                  onClick={() =>
                    setDraftTags((current) => current.filter((x) => x !== tag))
                  }>
                  <X aria-hidden className="icon-xs" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Input
          value={value}
          onChange={(event) => {
            const next = event.target.value
            if (next.includes(",")) {
              setDraftTags((current) => mergeTags(current, next))
              setValue("")
              return
            }
            setValue(next)
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return
            event.preventDefault()
            setDraftTags((current) => mergeTags(current, value))
            setValue("")
          }}
          placeholder={t("sessions.tags.placeholder")}
          aria-label={t("sessions.tags.title")}
        />
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              setValue("")
              onOpenChange(false)
            }}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={saving}
            onClick={async () => {
              if (saving) return
              setSaving(true)
              try {
                await onSave(mergeTags(draftTags, value))
                setValue("")
                onOpenChange(false)
              } finally {
                setSaving(false)
              }
            }}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
