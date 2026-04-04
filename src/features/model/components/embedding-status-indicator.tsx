import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { useModelPull } from "@/features/model/hooks/use-model-pull"
import { useToast } from "@/hooks/use-toast"
import { browser } from "@/lib/browser-api"
import type { EmbeddingConfig } from "@/lib/constants"
import {
  DEFAULT_EMBEDDING_CONFIG,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_PROVIDER_ID,
  MESSAGE_KEYS,
  normalizeEmbeddingModelName,
  STORAGE_KEYS
} from "@/lib/constants"
import {
  AlertTriangle,
  Database,
  Download,
  Loader2,
  RefreshCw
} from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ModelCheckResponse } from "@/types"

export const EmbeddingStatusIndicator = () => {
  const { t } = useTranslation()
  const [selectedModel] = useStorage<string>(
    {
      key: STORAGE_KEYS.EMBEDDINGS.SELECTED_MODEL,
      instance: plasmoGlobalStorage
    },
    DEFAULT_EMBEDDING_MODEL
  )
  const [config] = useStorage<EmbeddingConfig>(
    {
      key: STORAGE_KEYS.EMBEDDINGS.CONFIG,
      instance: plasmoGlobalStorage
    },
    DEFAULT_EMBEDDING_CONFIG
  )

  const modelName = normalizeEmbeddingModelName(
    config?.sharedEmbeddingModel || selectedModel || DEFAULT_EMBEDDING_MODEL
  )
  const providerId =
    modelName === DEFAULT_EMBEDDING_MODEL
      ? DEFAULT_PROVIDER_ID
      : config?.sharedEmbeddingProviderId || DEFAULT_PROVIDER_ID

  const [isChecking, setIsChecking] = useState(false)
  const [modelExists, setModelExists] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { pullingModel, progress, pullModel } = useModelPull()
  const isDownloading = pullingModel === modelName

  const [retryCount, setRetryCount] = useState(0)
  const retryTimerRef = useRef<number | null>(null)
  const lastPullErrorRef = useRef<string | null>(null)
  const MAX_RETRIES = 3
  const CHECK_TIMEOUT_MS = 6000
  const { toast } = useToast()

  const checkModel = useCallback(async () => {
    setIsChecking(true)
    setError(null)
    try {
      console.info("[EmbeddingStatus] Checking model", {
        model: modelName,
        providerId
      })

      const resp = (await Promise.race([
        browser.runtime.sendMessage({
          type: MESSAGE_KEYS.PROVIDER.CHECK_EMBEDDING_MODEL,
          payload: { model: modelName, providerId }
        }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Status check timed out")),
            CHECK_TIMEOUT_MS
          )
        )
      ])) as ModelCheckResponse

      console.info("[EmbeddingStatus] Check response", {
        model: modelName,
        providerId,
        success: resp?.success,
        exists: resp?.data?.exists,
        error: resp?.error
      })

      if (resp?.success && resp.data && resp.data.exists === true) {
        setModelExists(true)
      } else {
        setModelExists(false)
        if (resp?.error) {
          setError(resp.error.message || "Unknown error")
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn("[EmbeddingStatus] Check failed", {
        model: modelName,
        providerId,
        error: message
      })
      setModelExists(null)
      setError(message)
    } finally {
      setIsChecking(false)
    }
  }, [modelName, providerId])

  useEffect(() => {
    checkModel()
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
  }, [checkModel])

  // Auto-retry on error
  useEffect(() => {
    if (error && retryCount < MAX_RETRIES) {
      const backoff = 2 ** retryCount * 1000
      retryTimerRef.current = window.setTimeout(() => {
        setRetryCount((c) => c + 1)
        checkModel()
      }, backoff)
    }
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
  }, [error, retryCount, checkModel])

  // Re-check when download completes
  useEffect(() => {
    if (progress === "✅ Success" && !isDownloading) {
      checkModel()
    }
  }, [progress, isDownloading, checkModel])

  const handleRetry = (e?: React.MouseEvent) => {
    e?.stopPropagation()
    setError(null)
    setRetryCount(0)
    console.info("[EmbeddingStatus] Manual retry", {
      model: modelName,
      providerId
    })
    checkModel()
  }

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()
    pullModel(modelName, providerId)
  }

  const status =
    isChecking || isDownloading
      ? "loading"
      : error
        ? "error"
        : modelExists === true
          ? "ready"
          : modelExists === false
            ? "missing"
            : "default"

  const statusConfig = {
    loading: {
      icon: <Loader2 className="size-4 animate-spin text-yellow-500" />,
      color: "text-yellow-500",
      text: isDownloading
        ? t("model.embedding_status.downloading", {
            model: modelName,
            progress: progress || ""
          })
        : t("model.embedding_status.checking")
    },
    ready: {
      icon: <Database className="size-4 text-green-600" />,
      color: "text-600",
      text: t("model.embedding_status.ready", { model: modelName })
    },
    missing: {
      icon: <Database className="size-4 text-red-500" />,
      color: "text-red-500",
      text: t("model.embedding_status.missing", { model: modelName })
    },
    error: {
      icon: <AlertTriangle className="size-4 text-red-500" />,
      color: "text-red-500",
      text: t("model.embedding_status.error")
    },
    default: {
      icon: <Database className="size-4 text-muted-foreground" />,
      color: "text-muted-foreground",
      text: t("model.embedding_status.checking_model")
    }
  }

  const { icon, text: statusText, color: statusColor } = statusConfig[status]

  useEffect(() => {
    if (!progress || !progress.startsWith("❌")) {
      return
    }

    if (lastPullErrorRef.current === progress) {
      return
    }

    lastPullErrorRef.current = progress
    toast({
      title: "Embedding download failed",
      description: progress.replace(/^❌\s*/, ""),
      variant: "destructive"
    })
  }, [progress, toast])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="secondary"
          size="icon"
          onClick={modelExists === false ? handleDownload : handleRetry}
          className="m-1 rounded-xl border border-border/50 bg-background/50 shadow-xs backdrop-blur-xs transition-all duration-200 hover:bg-accent/50">
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-[250px]">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className={statusColor}>{statusText}</span>
            {!isChecking && !isDownloading && (
              <RefreshCw
                className="size-4 cursor-pointer text-muted-foreground hover:text-foreground"
                onClick={handleRetry}
              />
            )}
          </div>

          {modelExists === false && !isDownloading && !isChecking && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                {t("model.embedding_status.required_for_rag")}
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="h-7 text-xs w-full"
                onClick={handleDownload}>
                <Download className="mr-2 h-3 w-3" />
                {t("model.embedding_status.download_button")}
              </Button>
            </div>
          )}

          {error && (
            <div className="text-xs text-red-500 wrap-break-word">{error}</div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
