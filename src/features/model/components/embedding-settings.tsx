import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { SettingsCard, SettingsFormField } from "@/components/settings"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { DataMigrationSettings } from "@/features/knowledge/components/data-migration-settings"
import { FeedbackSettings } from "@/features/knowledge/components/feedback-settings"
import { useProviderModels } from "@/features/model/hooks/use-provider-models"
import { browser } from "@/lib/browser-api"
import {
  DEFAULT_EMBEDDING_CONFIG,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_PROVIDER_ID,
  type EmbeddingConfig,
  MESSAGE_KEYS,
  normalizeEmbeddingModelName,
  RECOMMENDED_EMBEDDING_MODELS,
  STORAGE_KEYS
} from "@/lib/constants"
import { Database } from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { getProviderDisplayName } from "@/lib/providers/registry"
import type { ChromeResponse } from "@/types"
import { EmbeddingGenerationConfig } from "./embedding-config/embedding-generation-config"
import { EmbeddingInfo } from "./embedding-info"
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
  const { models } = useProviderModels()
  const [config, setConfig] = useStorage<EmbeddingConfig>(
    {
      key: STORAGE_KEYS.EMBEDDINGS.CONFIG,
      instance: plasmoGlobalStorage
    },
    DEFAULT_EMBEDDING_CONFIG
  )

  const [modelExists, setModelExists] = useState<boolean>(false)
  const autoSwitchRef = useRef(false)
  const lastCheckedModelRef = useRef<string | null>(null)

  const recommendedModelSet = useMemo(
    () => new Set(RECOMMENDED_EMBEDDING_MODELS.map((m) => m.toLowerCase())),
    []
  )
  const recommendedBaseSet = useMemo(
    () =>
      new Set(
        RECOMMENDED_EMBEDDING_MODELS.map((m) => m.toLowerCase().split(":")[0])
      ),
    []
  )

  const isLikelyEmbeddingModelName = useCallback(
    (name: string) => {
      const normalized = name.toLowerCase()
      const base = normalized.split(":")[0] || normalized

      if (recommendedModelSet.has(normalized) || recommendedBaseSet.has(base)) {
        return true
      }

      if (normalized.includes("embed") || normalized.includes("embedding")) {
        return true
      }

      if (normalized.includes("bge") || normalized.includes("e5")) {
        return true
      }

      if (normalized.includes("gte") || normalized.includes("jina")) {
        return true
      }

      if (
        normalized.includes("minilm") ||
        normalized.includes("sentence-transformers")
      ) {
        return true
      }

      return false
    },
    [recommendedBaseSet, recommendedModelSet]
  )

  const embeddingModels = useMemo(
    () => models.filter((model) => isLikelyEmbeddingModelName(model.name)),
    [isLikelyEmbeddingModelName, models]
  )

  // We need to check model existence here to pass to children
  useEffect(() => {
    const normalized = normalizeEmbeddingModelName(selectedModel)
    if (normalized !== selectedModel) {
      setSelectedModel(normalized)
      return
    }

    if (selectedModel !== lastCheckedModelRef.current) {
      autoSwitchRef.current = false
      lastCheckedModelRef.current = selectedModel
    }

    const checkModel = async () => {
      try {
        const currentModel = selectedModel || DEFAULT_EMBEDDING_MODEL
        const isEmbeddingModel = isLikelyEmbeddingModelName(currentModel)
        const response = (await browser.runtime.sendMessage({
          type: MESSAGE_KEYS.PROVIDER.CHECK_EMBEDDING_MODEL,
          payload: currentModel
        })) as ChromeResponse & { data?: { exists?: boolean; debug?: object } }

        if (response?.data?.debug) {
          console.log(
            `[EmbeddingSettings] Check debug for ${currentModel}:`,
            response.data.debug
          )
        }

        if (
          isEmbeddingModel &&
          response?.success === true &&
          response.data?.exists === true
        ) {
          setModelExists(true)
        } else {
          setModelExists(false)
          if (!autoSwitchRef.current) {
            const providerModels = embeddingModels.filter(
              (m) => m.providerId === DEFAULT_PROVIDER_ID
            )
            const candidates =
              providerModels.length > 0 ? providerModels : embeddingModels

            const matchByRecommended = candidates.find((m) =>
              recommendedBaseSet.has(m.name.toLowerCase().split(":")[0])
            )
            const matchByEmbedName = candidates.find((m) => {
              const modelName = m.name.toLowerCase()
              return (
                modelName.includes("embed") || modelName.includes("embedding")
              )
            })

            const nextModel = matchByRecommended?.name || matchByEmbedName?.name

            if (nextModel && nextModel !== currentModel) {
              autoSwitchRef.current = true
              setSelectedModel(nextModel)
            }
          }
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
  }, [
    embeddingModels,
    isLikelyEmbeddingModelName,
    recommendedBaseSet,
    selectedModel,
    setSelectedModel
  ])

  const updateConfig = useCallback(
    (updates: Partial<EmbeddingConfig>) => {
      setConfig((prev) => ({
        ...DEFAULT_EMBEDDING_CONFIG,
        ...prev,
        ...updates
      }))
    },
    [setConfig]
  )

  return (
    <div className="space-y-6">
      {(() => {
        const labelMap = new Map<string, string>()
        RECOMMENDED_EMBEDDING_MODELS.forEach((modelName) => {
          const label =
            modelName === DEFAULT_EMBEDDING_MODEL
              ? `${modelName} (${t(
                  "settings.content_extraction.badges.recommended"
                )})`
              : modelName
          labelMap.set(modelName, label)
        })
        embeddingModels.forEach((model) => {
          const label = `${model.name} (${
            model.providerName || getProviderDisplayName(DEFAULT_PROVIDER_ID)
          })`
          labelMap.set(model.name, label)
        })
        return (
          <>
            <SettingsCard
              icon={Database}
              title={t("settings.embeddings.title")}
              description={t("settings.embeddings.description")}
              badge="Beta">
              <div className="space-y-4">
                <EmbeddingInfo />

                <div className="rounded-lg border p-4 space-y-4">
                  <SettingsFormField
                    label={t("settings.embeddings.model_select.label")}
                    description={t(
                      "settings.embeddings.model_select.description"
                    )}>
                    <Select
                      value={selectedModel}
                      onValueChange={(value) => setSelectedModel(value)}>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={t(
                            "settings.embeddings.model_select.placeholder"
                          )}>
                          {(value) =>
                            value
                              ? labelMap.get(String(value)) || String(value)
                              : null
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>
                            {t(
                              "settings.embeddings.model_select.recommended_group"
                            )}
                          </SelectLabel>
                          {RECOMMENDED_EMBEDDING_MODELS.map((modelName) => (
                            <SelectItem key={modelName} value={modelName}>
                              {modelName}
                              {modelName === DEFAULT_EMBEDDING_MODEL
                                ? ` (${t("settings.content_extraction.badges.recommended")})`
                                : ""}
                            </SelectItem>
                          ))}
                        </SelectGroup>

                        {embeddingModels.length > 0 && (
                          <SelectGroup>
                            <SelectLabel>
                              {t(
                                "settings.embeddings.model_select.all_models_group"
                              )}
                            </SelectLabel>
                            {embeddingModels
                              .filter(
                                (m) =>
                                  !recommendedBaseSet.has(
                                    m.name.toLowerCase().split(":")[0]
                                  )
                              )
                              .map((model) => (
                                <SelectItem
                                  key={`${model.providerId}-${model.name}`}
                                  value={model.name}>
                                  {model.name} (
                                  {model.providerName ||
                                    getProviderDisplayName(DEFAULT_PROVIDER_ID)}
                                  )
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

            {modelExists && <EmbeddingTestTools modelExists={modelExists} />}

            <EmbeddingGenerationConfig
              config={config || DEFAULT_EMBEDDING_CONFIG}
              updateConfig={updateConfig}
            />

            <FeedbackSettings />

            <DataMigrationSettings />
          </>
        )
      })()}
    </div>
  )
}
