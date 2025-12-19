import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { StatusAlert } from "@/components/settings"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useOllamaPull } from "@/features/model/hooks/use-ollama-pull"
import { browser } from "@/lib/browser-api"
import {
  DEFAULT_EMBEDDING_MODEL,
  MESSAGE_KEYS,
  STORAGE_KEYS
} from "@/lib/constants"
import { AlertCircle, CheckCircle, Download, Loader2 } from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ChromeResponse } from "@/types"

interface EmbeddingModelStatusProps {
  selectedModel: string
}

export const EmbeddingModelStatus = ({
  selectedModel
}: EmbeddingModelStatusProps) => {
  const { t } = useTranslation()
  const [modelExists, setModelExists] = useState<boolean | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const { pullingModel, progress, pullModel } = useOllamaPull()
  const [wasDownloading, setWasDownloading] = useState(false)
  const [autoDownloaded, setAutoDownloaded] = useState(false)

  const currentModel = selectedModel || DEFAULT_EMBEDDING_MODEL
  const isDownloading = pullingModel === currentModel

  // Load auto-downloaded status
  useEffect(() => {
    plasmoGlobalStorage
      .get(STORAGE_KEYS.EMBEDDINGS.AUTO_DOWNLOADED)
      .then((val) => setAutoDownloaded(Boolean(val)))
  }, [])

  // Track when download starts
  useEffect(() => {
    if (isDownloading) {
      setWasDownloading(true)
    }
  }, [isDownloading])

  const checkModel = useCallback(async () => {
    setIsChecking(true)
    try {
      const response = (await browser.runtime.sendMessage({
        type: MESSAGE_KEYS.OLLAMA.CHECK_EMBEDDING_MODEL,
        payload: currentModel
      })) as ChromeResponse & { data?: { exists?: boolean } }

      console.log(
        `[Embedding Settings] Check response for "${currentModel}":`,
        response
      )

      if (response?.success === true && response.data?.exists === true) {
        console.log(`[Embedding Settings] Model exists: true`)
        setModelExists(true)
      } else if (
        response?.success === true &&
        response.data?.exists === false
      ) {
        console.log(`[Embedding Settings] Model exists: false`)
        setModelExists(false)
      } else {
        console.warn(`[Embedding Settings] Invalid response:`, response)
        // On error, set to false
        setModelExists(false)
      }
    } catch (error) {
      console.error("Error checking embedding model:", error)
      setModelExists(false)
    } finally {
      setIsChecking(false)
    }
  }, [currentModel])

  useEffect(() => {
    checkModel()
  }, [checkModel])

  // Re-check model status when download completes
  useEffect(() => {
    // When download completes (progress is success, was downloading, but no longer downloading)
    if (
      progress === "✅ Success" &&
      wasDownloading &&
      !isDownloading &&
      pullingModel === null
    ) {
      console.log(
        "[Embedding Settings] Download completed, re-checking model status..."
      )
      // Wait a bit for Ollama to register the model
      setTimeout(() => {
        checkModel()
        // Mark as auto-downloaded
        plasmoGlobalStorage.set(STORAGE_KEYS.EMBEDDINGS.AUTO_DOWNLOADED, true)
        setAutoDownloaded(true)
        // Reset tracking
        setWasDownloading(false)
      }, 1500)
    }
  }, [progress, isDownloading, pullingModel, wasDownloading, checkModel])

  const handleDownload = () => {
    pullModel(currentModel)
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">
              {t("settings.embeddings.model_label")}
            </p>
            <p className="text-xs text-muted-foreground">{currentModel}</p>
          </div>
          {modelExists === true && (
            <Badge variant="default" className="gap-1">
              <CheckCircle className="h-3 w-3" />
              {t("settings.embeddings.status.installed")}
            </Badge>
          )}
          {modelExists === false && (
            <Badge variant="secondary" className="gap-1">
              <AlertCircle className="h-3 w-3" />
              {t("settings.embeddings.status.not_found")}
            </Badge>
          )}
        </div>

        {/* Show download prompt when model is not found */}
        {modelExists === false && !isDownloading && (
          <StatusAlert
            variant="warning"
            icon={AlertCircle}
            title={t("settings.embeddings.not_loaded.title")}
            description={t("settings.embeddings.not_loaded.description")}
            actions={
              <Button
                onClick={handleDownload}
                size="sm"
                className="w-full sm:w-auto mt-2">
                <Download className="h-4 w-4 mr-2" />
                {t("settings.embeddings.not_loaded.download_button", {
                  model: currentModel
                })}
              </Button>
            }
          />
        )}

        {/* Show download progress when downloading */}
        {isDownloading && (
          <StatusAlert
            variant="default"
            icon={Loader2}
            title={t("settings.embeddings.downloading.title", {
              model: currentModel
            })}
            description={
              <div className="space-y-2">
                {progress && (
                  <p className="text-xs text-muted-foreground">{progress}</p>
                )}
                <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full bg-primary animate-pulse"
                    style={{ width: "100%" }}
                  />
                </div>
              </div>
            }
          />
        )}

        {/* Show success message when download completes */}
        {progress === "✅ Success" && modelExists === true && (
          <StatusAlert
            variant="success"
            icon={CheckCircle}
            title={t("settings.embeddings.success.title")}
            description={t("settings.embeddings.success.description")}
          />
        )}

        {autoDownloaded && modelExists === true && (
          <StatusAlert
            variant="default"
            icon={Download}
            title={t("settings.embeddings.auto_downloaded.title")}
            description={t("settings.embeddings.auto_downloaded.description")}
          />
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={checkModel}
            disabled={isChecking || isDownloading}
            className="flex-1">
            {isChecking ? (
              <>
                <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                {t("settings.embeddings.status.checking")}
              </>
            ) : (
              t("settings.embeddings.status.check_button")
            )}
          </Button>
          {modelExists === false && !isDownloading && (
            <Button onClick={handleDownload} size="sm" className="flex-1">
              <Download className="h-3 w-3 mr-2" />
              {t("model.embedding_status.download_button")}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
