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

export const SessionTagsDialog = ({
  open,
  onOpenChange,
  tags,
  onSave
}: SessionTagsDialogProps) => {
  const { t } = useTranslation()
  const [value, setValue] = useSynchronizedDraft(
    JSON.stringify([open, tags]),
    tags.join(", ")
  )
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
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t("sessions.tags.placeholder")}
          aria-label={t("sessions.tags.title")}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={saving}
            onClick={async () => {
              if (saving) return
              setSaving(true)
              try {
                await onSave(value.split(","))
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
