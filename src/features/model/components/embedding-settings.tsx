import { useStorage } from "@plasmohq/storage/hook"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  SettingsCard,
  SettingsFormField,
  SettingsSwitch
} from "@/components/settings"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { FileUploadSettings } from "@/features/file-upload/components/file-upload-settings"
import { useOllamaModels } from "@/features/model/hooks/use-ollama-models"
import { browser } from "@/lib/browser-api"
import {
  DEFAULT_EMBEDDING_MODEL,
  MESSAGE_KEYS,
  STORAGE_KEYS
} from "@/lib/constants"
import { Database } from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ChromeResponse } from "@/types"
import { EmbeddingConfigSettings } from "./embedding-config-settings"
import { EmbeddingIndexControls } from "./embedding-index-controls"
import { EmbeddingInfo } from "./embedding-info"
import { EmbeddingModelStatus } from "./embedding-model-status"
import { EmbeddingTestTools } from "./embedding-test-tools"

export const EmbeddingSettings = () => {
  const { t } = useTranslation()
  const [selectedModel, setSelectedModel] = useStorage<string>(
    {
      key: STORAGE_KEYS.EMBEDDINGS.SELECTED_MODEL,
      instance: plasmoGlobalStorage
    },
    DEFAULT_EMBEDDING_MODEL
  )
  const { models } = useOllamaModels()

  const [useRag, setUseRag] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.EMBEDDINGS.USE_RAG,
      instance: plasmoGlobalStorage
    },
    true
  )

  const [modelExists, setModelExists] = useState<boolean>(false)

  // We need to check model existence here to pass to children
  // This duplicates some logic from EmbeddingModelStatus but is cleaner than lifting all state
  useEffect(() => {
    const checkModel = async () => {
      try {
        const currentModel = selectedModel || DEFAULT_EMBEDDING_MODEL
        const response = (await browser.runtime.sendMessage({
          type: MESSAGE_KEYS.OLLAMA.CHECK_EMBEDDING_MODEL,
          payload: currentModel
        })) as ChromeResponse & { data?: { exists?: boolean; debug?: any } }

        if (response?.data?.debug) {
          console.log(
            `[EmbeddingSettings] Check debug for ${currentModel}:`,
            response.data.debug
          )
        }

        if (response?.success === true && response.data?.exists === true) {
          setModelExists(true)
        } else {
          setModelExists(false)
        }
      } catch (error) {
        console.error("Error checking embedding model in parent:", error)
        setModelExists(false)
      }
    }

    checkModel()
    // Poll occasionally or when model changes
    const interval = setInterval(checkModel, 5000)
    return () => clearInterval(interval)
  }, [selectedModel])

  return (
    <div className="space-y-6">
      <SettingsCard
        icon={Database}
        title={t("settings.embeddings.title")}
        description={t("settings.embeddings.description")}
        badge="Beta">
        <div className="space-y-4">
          <EmbeddingModelStatus selectedModel={selectedModel} />

          {modelExists && (
            <>
              <EmbeddingTestTools modelExists={modelExists} />
              <EmbeddingIndexControls modelExists={modelExists} />
            </>
          )}

          <EmbeddingInfo />

          <div className="rounded-lg border p-4 space-y-4">
            <SettingsSwitch
              id="rag-mode"
              label={t("settings.embeddings.rag_mode.label")}
              description={t("settings.embeddings.rag_mode.description")}
              checked={useRag}
              onCheckedChange={setUseRag}
            />

            <Separator />

            <FileUploadSettings />

            <Separator />

            <SettingsFormField
              label={t("settings.embeddings.model_select.label")}
              description={t("settings.embeddings.model_select.description")}>
              <Select
                value={selectedModel}
                onValueChange={(value) => setSelectedModel(value)}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={t(
                      "settings.embeddings.model_select.placeholder"
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>
                      {t("settings.embeddings.model_select.recommended_group")}
                    </SelectLabel>
                    <SelectItem value="mxbai-embed-large">
                      mxbai-embed-large (
                      {t("settings.content_extraction.badges.recommended")})
                    </SelectItem>
                    <SelectItem value="nomic-embed-text">
                      nomic-embed-text
                    </SelectItem>
                  </SelectGroup>

                  {models.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>
                        {t("settings.embeddings.model_select.all_models_group")}
                      </SelectLabel>
                      {models
                        .filter(
                          (m) =>
                            !["mxbai-embed-large", "nomic-embed-text"].includes(
                              m.name
                            )
                        )
                        .map((model) => (
                          <SelectItem
                            key={`${model.providerId}-${model.name}`}
                            value={model.name}>
                            {model.name} ({model.providerName || "Ollama"})
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
            </SettingsFormField>
          </div>
        </div>
      </SettingsCard>

      <Separator />

      {/* Configuration Settings */}
      <EmbeddingConfigSettings />
    </div>
  )
}
