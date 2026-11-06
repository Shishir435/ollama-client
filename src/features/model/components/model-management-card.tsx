import { Download, Loader2, Trash2, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { StatusCallout } from "@/components/feedback"
import {
  SCROLL_REGION_FOCUS_CLASS,
  scrollRegionProps
} from "@/components/layout/scroll-region"
import { SettingsCard, SettingsFormField } from "@/components/settings"
import { ConfirmActionDialog } from "@/components/settings/confirm-action-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { useModelPull } from "@/features/model/hooks/use-model-pull"
import { useProviderModels } from "@/features/model/hooks/use-provider-models"
import { useToast } from "@/hooks/use-toast"
import { getDisplayErrorMessage } from "@/lib/error-display"
import { getProviderCapabilities } from "@/lib/providers/capabilities"
import { ProviderId } from "@/lib/providers/types"

/** Starting points only; any name from the Ollama library works. */
const SUGGESTED_MODELS = ["llama3.2", "qwen3:8b", "gemma3"] as const

const formatBytes = (bytes: number): string => {
  if (!bytes) return ""
  const units = ["B", "KB", "MB", "GB", "TB"]
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024))
  )
  return `${Number((bytes / 1024 ** index).toFixed(1))} ${units[index]}`
}

/**
 * Chat-model management for servers that can do it themselves: download by
 * name with visible progress, and remove an installed model. Everything the
 * server cannot do is hidden rather than attempted — other providers manage
 * their models in their own app, which the note says in plain words.
 */
export const ModelManagementCard = () => {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { models, deleteModel, refresh, refreshProvider, ollamaEnabled } =
    useProviderModels()
  const { pullingModel, progress, pullModel, cancelPull } = useModelPull()
  const lastPhase = useRef(progress?.phase)
  useEffect(() => {
    if (progress?.phase === "success" && lastPhase.current !== "success") {
      void refreshProvider(ProviderId.OLLAMA)
    }
    lastPhase.current = progress?.phase
  }, [progress?.phase, refreshProvider])
  const [name, setName] = useState("")
  const [pendingDelete, setPendingDelete] = useState<{
    name: string
    providerId?: string
  } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const canPull = ollamaEnabled && getProviderCapabilities(ProviderId.OLLAMA)
  const downloading = pullingModel !== null
  const removable = models.filter(
    (model) =>
      model.providerId && getProviderCapabilities(model.providerId)?.modelDelete
  )

  const startPull = () => {
    const trimmed = name.trim()
    if (!trimmed || downloading) return
    pullModel(trimmed, ProviderId.OLLAMA)
  }

  const progressLabel = (() => {
    if (!progress) return null
    switch (progress.phase) {
      case "starting":
        return t("settings.model_management.starting")
      case "pulling":
        return progress.percent === undefined
          ? t("settings.model_management.pulling_text", {
              text: progress.text ?? ""
            })
          : t("settings.model_management.pulling_percent", {
              percent: progress.percent,
              text: progress.text ?? ""
            })
      case "success":
        return t("settings.model_management.success")
      case "cancelled":
        return t("settings.model_management.cancelled")
      case "failed":
        return progress.error
          ? t("settings.model_management.failed_with_reason", {
              reason: progress.error
            })
          : t("settings.model_management.failed")
    }
  })()

  const confirmDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await deleteModel({
        modelName: pendingDelete.name,
        providerId: pendingDelete.providerId
      })
      toast({
        title: t("settings.model_management.deleted", {
          name: pendingDelete.name
        })
      })
      setPendingDelete(null)
      void refresh()
    } catch (error) {
      toast({
        variant: "destructive",
        title: t("settings.model_management.delete_failed", {
          name: pendingDelete.name
        }),
        description: getDisplayErrorMessage(
          error,
          t("settings.model_management.delete_failed_description")
        )
      })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <SettingsCard
      icon={Download}
      title={t("settings.model_management.title")}
      description={t("settings.model_management.description")}>
      <div className="space-y-4">
        {canPull ? (
          <SettingsFormField
            focusId="model-download"
            htmlFor="model-download-input"
            label={t("settings.model_management.name_label")}
            description={t("settings.model_management.name_help")}>
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                startPull()
              }}>
              <Input
                id="model-download-input"
                value={name}
                disabled={downloading}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("settings.model_management.name_placeholder")}
                className="min-w-48 flex-1"
              />
              {downloading ? (
                <Button type="button" variant="outline" onClick={cancelPull}>
                  <X className="icon-md mr-2" />
                  {t("settings.model_management.cancel")}
                </Button>
              ) : (
                <Button type="submit" disabled={!name.trim()}>
                  <Download className="icon-md mr-2" />
                  {t("settings.model_management.download")}
                </Button>
              )}
            </form>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span>{t("settings.model_management.examples")}</span>
              {SUGGESTED_MODELS.map((suggestion) => (
                <Button
                  key={suggestion}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={downloading}
                  onClick={() => setName(suggestion)}>
                  {suggestion}
                </Button>
              ))}
            </div>
            {progressLabel && (
              <output className="mt-3 block space-y-1.5" aria-live="polite">
                {downloading && (
                  <Progress
                    aria-label={t("settings.model_management.title")}
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
                    {progressLabel}
                  </span>
                </p>
              </output>
            )}
          </SettingsFormField>
        ) : (
          <StatusCallout
            variant="info"
            title={t("settings.model_management.other_providers_note")}
          />
        )}

        {removable.length > 0 && (
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {t("settings.model_management.installed_title")}
            </p>
            <div
              {...scrollRegionProps(
                t("settings.model_management.installed_title")
              )}
              className={`max-h-80 overflow-y-auto overscroll-contain rounded-panel border border-border ${SCROLL_REGION_FOCUS_CLASS}`}>
              <ul className="divide-y divide-border">
                {removable.map((model) => (
                  <li
                    key={`${model.providerId}:${model.name}`}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate" title={model.name}>
                      {model.name}
                      {model.size ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {formatBytes(model.size)}
                        </span>
                      ) : null}
                    </span>
                    <TooltipActionButton
                      variant="ghost"
                      size="icon"
                      icon={Trash2}
                      tooltip={t("settings.model_management.delete")}
                      ariaLabel={t("settings.model_management.delete_named", {
                        name: model.name
                      })}
                      onClick={() =>
                        setPendingDelete({
                          name: model.name,
                          providerId: model.providerId
                        })
                      }
                    />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {canPull && (
          <p className="text-xs text-muted-foreground">
            {t("settings.model_management.other_providers_footnote")}
          </p>
        )}
      </div>

      <ConfirmActionDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null)
        }}
        title={t("settings.model_management.delete_title", {
          name: pendingDelete?.name ?? ""
        })}
        description={t("settings.model_management.delete_description")}
        confirmLabel={t("settings.model_management.delete")}
        destructive
        busy={deleting}
        onConfirm={confirmDelete}
      />
    </SettingsCard>
  )
}
