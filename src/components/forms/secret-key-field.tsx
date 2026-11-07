import { Check as CheckIcon, Eye, EyeOff } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface SecretKeyFieldProps {
  id: string
  /** A key is already stored and kept unless the user replaces or removes it. */
  stored: boolean
  /** What the user has typed; empty when nothing is being replaced. */
  value: string
  onChange: (value: string) => void
  /** Explicitly delete the stored key. Typing and deleting never does. */
  onRemove: () => void
  /** The removal is queued until the next save. */
  removePending?: boolean
  onUndoRemove?: () => void
  /** Leave replace mode and keep the stored key. */
  onCancelReplace?: () => void
  placeholder?: string
}

/**
 * Credential input with a stored-key state, a show/hide toggle for what is
 * being typed, and an explicit Replace / Remove pair so a saved key is never
 * lost to an edit.
 */
export const SecretKeyField = ({
  id,
  stored,
  value,
  onChange,
  onRemove,
  removePending = false,
  onUndoRemove,
  onCancelReplace,
  placeholder
}: SecretKeyFieldProps) => {
  const { t } = useTranslation()
  const [replacing, setReplacing] = useState(false)
  const [visible, setVisible] = useState(false)

  if (removePending) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <output>{t("settings.secret_key.remove_pending")}</output>
        {onUndoRemove && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onUndoRemove}>
            {t("settings.secret_key.undo")}
          </Button>
        )}
      </div>
    )
  }

  if (stored && !replacing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 text-sm text-foreground">
          <CheckIcon
            className="icon-sm text-status-success-text"
            aria-hidden="true"
          />
          {t("settings.secret_key.saved")}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setReplacing(true)}>
          {t("settings.secret_key.replace")}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onRemove}>
          {t("settings.secret_key.remove")}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        type={visible ? "text" : "password"}
        autoComplete="off"
        value={value}
        onChange={(event) => {
          setReplacing(true)
          onChange(event.target.value)
        }}
        placeholder={placeholder}
        className="flex-1"
      />
      <TooltipActionButton
        type="button"
        variant="ghost"
        size="icon"
        ariaLabel={t(
          visible ? "settings.secret_key.hide" : "settings.secret_key.show"
        )}
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
        icon={
          visible ? (
            <EyeOff className="icon-sm" aria-hidden="true" />
          ) : (
            <Eye className="icon-sm" aria-hidden="true" />
          )
        }
      />
      {stored && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setReplacing(false)
            onCancelReplace?.()
          }}>
          {t("settings.secret_key.cancel")}
        </Button>
      )}
    </div>
  )
}
