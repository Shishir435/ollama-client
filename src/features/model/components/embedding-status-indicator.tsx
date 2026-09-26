import { RpcMethod } from "@ollama-client/contracts/rpc"
import {
  AlertTriangle,
  Brain,
  Download,
  Loader2,
  RefreshCw,
  Settings
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { Button } from "@/components/ui/button"
import { useModelPull } from "@/features/model/hooks/use-model-pull"
import { useSetting } from "@/hooks/use-setting"
import { useToast } from "@/hooks/use-toast"
import { openOptionsInTab, runtime } from "@/lib/browser-api"
import { cn } from "@/lib/class-names"
import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_PROVIDER_ID,
  normalizeEmbeddingModelName
} from "@/lib/constants"
import { SETTINGS } from "@/lib/storage/settings"
import { STATUS_STYLES } from "@/lib/ui-status"
import { extensionRpcClient } from "@/protocol/extension-client"
import { useNativeEmbeddings } from "../hooks/use-native-embeddings"

type Availability = "available" | "missing" | "unavailable" | "unverified"

const externalModelName = (providerId: string, model: string) =>
  providerId === DEFAULT_PROVIDER_ID
    ? normalizeEmbeddingModelName(model)
    : model

export const EmbeddingStatusIndicator = () => {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { state: nativeState } = useNativeEmbeddings()
  const nativeMode = nativeState?.mode
  const [selectedModel] = useSetting(SETTINGS.EMBEDDING_SELECTED_MODEL)
  const [config] = useSetting(SETTINGS.EMBEDDING_CONFIG)
  const providerId = config?.sharedEmbeddingProviderId || DEFAULT_PROVIDER_ID
  const externalModel =
    config?.sharedEmbeddingModel || selectedModel || DEFAULT_EMBEDDING_MODEL
  const modelName =
    nativeMode === "bundled"
      ? t("settings.embeddings.bundled.title")
      : externalModelName(providerId, externalModel)
  const key = JSON.stringify([nativeMode, providerId, modelName])
  const [checked, setChecked] = useState<{
    key: string
    status: Availability
    canDownload: boolean
  }>()
  const [isChecking, setIsChecking] = useState(false)
  const request = useRef<AbortController | null>(null)
  const { pullingModel, progress, pullModel } = useModelPull()
  const isDownloading = pullingModel === modelName
  const lastPullError = useRef<string | null>(null)
  const checkModel = useCallback(async () => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    if (nativeMode !== "external") {
      setIsChecking(false)
      return
    }
    setIsChecking(true)
    try {
      const result = await extensionRpcClient.call(
        RpcMethod.EmbeddingsCheckModel,
        { model: modelName, providerId },
        { signal: controller.signal }
      )
      if (controller.signal.aborted) return
      setChecked({
        key,
        status: result.status ?? (result.exists ? "available" : "unverified"),
        canDownload: result.canDownload === true
      })
    } catch {
      if (!controller.signal.aborted)
        setChecked({ key, status: "unavailable", canDownload: false })
    } finally {
      if (!controller.signal.aborted) setIsChecking(false)
    }
  }, [key, modelName, nativeMode, providerId])

  useEffect(() => {
    void checkModel()
    return () => request.current?.abort()
  }, [checkModel])
  useEffect(() => {
    if (progress === "✅ Success" && !isDownloading) void checkModel()
  }, [progress, isDownloading, checkModel])
  useEffect(() => {
    if (!progress?.startsWith("❌") || lastPullError.current === progress)
      return
    lastPullError.current = progress
    toast({
      title: t("model.embedding_status.download_failed"),
      description: t("model.embedding_status.download_failed_description"),
      variant: "destructive"
    })
  }, [progress, toast, t])

  const availability =
    nativeMode === "bundled"
      ? "available"
      : checked?.key === key
        ? checked.status
        : undefined
  const loading = isChecking || isDownloading || !availability
  const canDownload =
    !loading &&
    availability === "missing" &&
    checked?.key === key &&
    checked.canDownload
  const statusText = loading
    ? isDownloading
      ? t("model.embedding_status.downloading", {
          model: modelName,
          progress: progress || ""
        })
      : t("model.embedding_status.checking")
    : availability === "available"
      ? t("model.embedding_status.ready", { model: modelName })
      : availability === "missing"
        ? t("model.embedding_status.missing", { model: modelName })
        : t(`model.embedding_status.${availability}`)
  const color =
    availability === "available"
      ? STATUS_STYLES.success.text
      : STATUS_STYLES.warning.text
  const icon = loading ? (
    <Loader2 className="icon-sm animate-spin" />
  ) : availability === "unavailable" ? (
    <AlertTriangle className={cn("icon-sm", color)} />
  ) : (
    <Brain className={cn("icon-sm", color)} />
  )
  const openSetup = () =>
    void openOptionsInTab(
      runtime.getURL("options.html?tab=context&focus=embeddings-model-select")
    )
  const download = () => {
    if (canDownload) void pullModel(modelName, providerId)
  }
  return (
    <TooltipActionButton
      variant="ghost"
      size="icon"
      ariaLabel={statusText}
      tooltipSide="left"
      tooltipClassName="max-w-62.5"
      onClick={canDownload ? download : openSetup}
      icon={icon}
      tooltip={
        <div className="flex flex-col gap-2">
          <span className={color}>{statusText}</span>
          {canDownload && (
            <Button size="sm" variant="secondary" onClick={download}>
              <Download className="mr-2 icon-xs" />
              {t("model.embedding_status.download_button")}
            </Button>
          )}
          {!loading && nativeMode === "external" && (
            <Button size="sm" variant="ghost" onClick={() => void checkModel()}>
              <RefreshCw className="mr-2 icon-xs" />
              {t("common.actions.retry")}
            </Button>
          )}
          {availability !== "available" && (
            <Button size="sm" variant="ghost" onClick={openSetup}>
              <Settings className="mr-2 icon-xs" />
              {t("onboarding.provider.open_setup")}
            </Button>
          )}
        </div>
      }
    />
  )
}
