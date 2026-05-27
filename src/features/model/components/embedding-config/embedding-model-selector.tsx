import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import {
  SettingsCard,
  SettingsField,
  SettingsSwitch,
  StatusAlert
} from "@/components/settings"
import { Card } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import type { RebuildProgress } from "@/features/model/hooks/use-embedding-rebuild"
import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_PROVIDER_ID,
  type EmbeddingConfig,
  normalizeEmbeddingModelName,
  RECOMMENDED_EMBEDDING_MODELS
} from "@/lib/constants"
import { recommendedEmbeddingBaseSet } from "@/lib/embeddings/model-name-filter"
import { Database, RefreshCw } from "@/lib/lucide-icon"
import { getProviderDisplayName } from "@/lib/providers/registry"
import type { ProviderModel } from "@/types"

import { EmbeddingInfo } from "../embedding-info"

export interface EmbeddingModelSelectorProps {
  selectedModel: string
  config: EmbeddingConfig
  embeddingModels: ProviderModel[]
  hasAdvancedModels: boolean
  isRebuilding: boolean
  rebuildProgress: RebuildProgress | null
  resolveProviderForModel: (modelName: string) => string
  onModelSelected: (model: string, providerId: string) => void
  onToggleShowAdvanced: (checked: boolean) => void
}

/**
 * The "Embedding model" settings card.
 *
 * Renders the model dropdown (recommended models always shown, all
 * other detected embedding-named models behind a "show advanced"
 * switch). Selecting a different model fires `onModelSelected` so the
 * parent can open its switch-or-rebuild confirmation dialog.
 *
 * Also embeds the model-status indicator (`EmbeddingInfo`) and an
 * in-progress rebuild notice. Both are inert when nothing is happening.
 */
export const EmbeddingModelSelector = ({
  selectedModel,
  config,
  embeddingModels,
  hasAdvancedModels,
  isRebuilding,
  rebuildProgress,
  resolveProviderForModel,
  onModelSelected,
  onToggleShowAdvanced
}: EmbeddingModelSelectorProps) => {
  const { t } = useTranslation()

  const showAdvancedModels = config.showAdvancedEmbeddingModels ?? false

  // Pre-compute a name -> display-label map so the SelectValue render
  // function can look up the right label without re-iterating arrays.
  const labelMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const modelName of RECOMMENDED_EMBEDDING_MODELS) {
      const label =
        modelName === DEFAULT_EMBEDDING_MODEL
          ? `${modelName} (${t("settings.content_extraction.badges.recommended")})`
          : modelName
      map.set(modelName, label)
    }
    for (const model of embeddingModels) {
      const label = `${model.name} (${
        model.providerName || getProviderDisplayName(DEFAULT_PROVIDER_ID)
      })`
      map.set(model.name, label)
    }
    return map
  }, [embeddingModels, t])

  const rebuildPercentage =
    rebuildProgress && rebuildProgress.total > 0
      ? (rebuildProgress.current / rebuildProgress.total) * 100
      : 0

  const handleValueChange = (value: string) => {
    const normalized = normalizeEmbeddingModelName(value)
    if (normalized === selectedModel) return
    onModelSelected(normalized, resolveProviderForModel(normalized))
  }

  return (
    <SettingsCard
      icon={Database}
      title={t("settings.embeddings.title")}
      description={t("settings.embeddings.description")}
      badge="Beta">
      <div className="space-y-4">
        <EmbeddingInfo />

        {isRebuilding && (
          <div className="space-y-3">
            <StatusAlert
              variant="info"
              icon={RefreshCw}
              title={t("settings.context.embedding_health.action_rebuilding")}
              description={
                rebuildProgress && rebuildProgress.total > 0
                  ? t("settings.context.embedding_health.progress", {
                      current: rebuildProgress.current,
                      total: rebuildProgress.total
                    })
                  : t("settings.context.embedding_health.status_starting")
              }
            />
            {rebuildProgress && rebuildProgress.total > 0 && (
              <Progress value={rebuildPercentage} />
            )}
          </div>
        )}

        <Card className="p-4 space-y-4">
          <SettingsField
            label={t("settings.embeddings.model_select.label")}
            description={t("settings.embeddings.model_select.description")}>
            <Select value={selectedModel} onValueChange={handleValueChange}>
              <SelectTrigger>
                <SelectValue
                  placeholder={t(
                    "settings.embeddings.model_select.placeholder"
                  )}>
                  {(value) =>
                    value ? labelMap.get(String(value)) || String(value) : null
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>
                    {t("settings.embeddings.model_select.recommended_group")}
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

                {showAdvancedModels && hasAdvancedModels && (
                  <SelectGroup>
                    <SelectLabel>
                      {t("settings.embeddings.model_select.all_models_group")}
                    </SelectLabel>
                    {embeddingModels
                      .filter(
                        (m) =>
                          !recommendedEmbeddingBaseSet.has(
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
          </SettingsField>

          {hasAdvancedModels && (
            <SettingsSwitch
              label={t("settings.embeddings.model_select.show_advanced_label")}
              description={t(
                "settings.embeddings.model_select.show_advanced_description"
              )}
              checked={showAdvancedModels}
              onCheckedChange={onToggleShowAdvanced}
            />
          )}
        </Card>
      </div>
    </SettingsCard>
  )
}
