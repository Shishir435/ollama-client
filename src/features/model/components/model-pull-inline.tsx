import { Download, Loader2, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { CopyButton } from "@/features/chat/components/copy-button"
import { useModelPull } from "@/features/model/hooks/use-model-pull"
import {
  ollamaPullCommand,
  pullProgressLabel,
  SUGGESTED_FIRST_MODEL
} from "@/features/model/lib/pull-progress"
import { ProviderId } from "@/lib/providers/types"

export interface ModelPullInlineProps {
  /**
   * The Ollama-type provider to download to. Defaults to the built-in one; a
   * caller showing a custom Ollama server passes its id, or the download lands
   * on a different server than the one the user is looking at.
   */
  providerId?: string
  /**
   * Called once when a download finishes, with the provider it went to, so the
   * caller can re-list that provider's models.
   */
  onPulled?: (model: string, providerId: string) => void
  /**
   * Starts as a single "Pull a model" button and opens the form on demand,
   * for a menu that has other things to show.
   */
  collapsible?: boolean
  /** Hides the terminal-command fallback for a caller that has no room. */
  showCommand?: boolean
}

/**
 * Download an Ollama model without leaving the panel: a suggested small model
 * prefilled, live progress with cancel, and the equivalent `ollama pull`
 * command to copy when the inline pull cannot run. The pull itself is the same
 * durable job the settings page uses.
 */
export const ModelPullInline = ({
  providerId = ProviderId.OLLAMA,
  onPulled,
  collapsible = false,
  showCommand = true
}: ModelPullInlineProps) => {
  const { t } = useTranslation()
  const { pullingModel, progress, pullModel, cancelPull, observedJob } =
    useModelPull()
  const [name, setName] = useState(SUGGESTED_FIRST_MODEL)
  const [expanded, setExpanded] = useState(!collapsible)
  const lastPhase = useRef(progress?.phase)
  const requested = useRef({ model: name, providerId })

  useEffect(() => {
    if (progress?.phase === "success" && lastPhase.current !== "success") {
      /**
       * Report the job that finished, not this form's request: a download
       * reattached on mount may be another model on another server. A job
       * that names no provider ran on the built-in Ollama server.
       */
      const done = observedJob
        ? {
            model: observedJob.model,
            providerId: observedJob.providerId ?? ProviderId.OLLAMA
          }
        : requested.current
      onPulled?.(done.model, done.providerId)
    }
    lastPhase.current = progress?.phase
  }, [progress?.phase, onPulled, observedJob])

  const downloading = pullingModel !== null
  const label = pullProgressLabel(t, progress)
  const command = ollamaPullCommand(name)

  const start = () => {
    const trimmed = name.trim()
    if (!trimmed || downloading) return
    requested.current = { model: trimmed, providerId }
    pullModel(trimmed, providerId)
  }

  if (!expanded && !downloading) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-center"
        onClick={() => setExpanded(true)}>
        <Download className="icon-sm" />
        {t("model.pull.open")}
      </Button>
    )
  }

  return (
    <div className="flex w-full flex-col gap-2 text-left">
      <form
        className="flex items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          start()
        }}>
        <Input
          value={name}
          disabled={downloading}
          aria-label={t("model.pull.name_label")}
          onChange={(event) => setName(event.target.value)}
          placeholder={SUGGESTED_FIRST_MODEL}
          className="min-w-0 flex-1"
        />
        {downloading ? (
          <Button type="button" variant="outline" onClick={cancelPull}>
            <X className="icon-sm" />
            {t("model.pull.cancel")}
          </Button>
        ) : (
          <Button type="submit" disabled={!name.trim()}>
            <Download className="icon-sm" />
            {t("model.pull.action")}
          </Button>
        )}
      </form>
      <p className="text-micro text-muted-foreground">
        {t("model.pull.suggestion", { model: SUGGESTED_FIRST_MODEL })}
      </p>
      {label && (
        <output className="block space-y-1.5" aria-live="polite">
          {downloading && (
            <Progress
              aria-label={t("model.pull.name_label")}
              value={
                progress?.phase === "pulling"
                  ? (progress.percent ?? null)
                  : null
              }
            />
          )}
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            {downloading && <Loader2 className="icon-sm animate-spin" />}
            <span className="break-all">
              {pullingModel ? `${pullingModel}: ` : ""}
              {label}
            </span>
          </p>
        </output>
      )}
      {showCommand && (
        <div className="space-y-1">
          <p className="text-micro text-muted-foreground">
            {t("model.pull.command_hint")}
          </p>
          <div className="flex items-center gap-1 rounded-control bg-muted p-2 text-foreground">
            <code className="min-w-0 flex-1 break-all font-mono text-xs select-all">
              {command}
            </code>
            <CopyButton text={command} />
          </div>
        </div>
      )}
    </div>
  )
}
