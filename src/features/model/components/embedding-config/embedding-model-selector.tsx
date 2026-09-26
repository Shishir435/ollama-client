import { Brain, RefreshCw } from "lucide-react"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import {
  SettingsCard,
  SettingsFormField,
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
  DEFAULT_PROVIDER_ID,
  type EmbeddingConfig,
  RECOMMENDED_EMBEDDING_MODELS
} from "@/lib/constants"
import { recommendedEmbeddingBaseSet } from "@/lib/embeddings/model-name-filter"
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
  onModelSelected,
  onToggleShowAdvanced
}: EmbeddingModelSelectorProps) => {
  const { t } = useTranslation()

  const showAdvancedModels = config.showAdvancedEmbeddingModels ?? false

  const selectedProvider =
    config.sharedEmbeddingProviderId || DEFAULT_PROVIDER_ID
  const selectedValue = JSON.stringify([selectedProvider, selectedModel])
  const options = useMemo(() => {
    const rows = new Map<
      string,
      { model: string; providerId: string; label: string; recommended: boolean }
    >()
    for (const model of embeddingModels) {
      const providerId = model.providerId || DEFAULT_PROVIDER_ID
      rows.set(JSON.stringify([providerId, model.name]), {
        model: model.name,
        providerId,
        label: `${model.name} (${model.providerName || getProviderDisplayName(providerId)})`,
        recommended: recommendedEmbeddingBaseSet.has(
          model.name.toLowerCase().split(":")[0]
        )
      })
    }
    for (const model of RECOMMENDED_EMBEDDING_MODELS) {
      const key = JSON.stringify([DEFAULT_PROVIDER_ID, model])
      if (!rows.has(key))
        rows.set(key, {
          model,
          providerId: DEFAULT_PROVIDER_ID,
          label: `${model} (${getProviderDisplayName(DEFAULT_PROVIDER_ID)})`,
          recommended: true
        })
    }
    if (!rows.has(selectedValue))
      rows.set(selectedValue, {
        model: selectedModel,
        providerId: selectedProvider,
        label: `${selectedModel} (${getProviderDisplayName(selectedProvider)})`,
        recommended: false
      })
    return rows
  }, [embeddingModels, selectedModel, selectedProvider, selectedValue])

  const rebuildPercentage =
    rebuildProgress && rebuildProgress.total > 0
      ? (rebuildProgress.current / rebuildProgress.total) * 100
      : 0

  const handleValueChange = (value: string) => {
    const option = options.get(value)
    if (!option || value === selectedValue) return
    onModelSelected(option.model, option.providerId)
  }

  return (
    <SettingsCard
      icon={Brain}
      focusId="embeddings-model-select"
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
                  : t("settings.embeddings.rebuild_index.status_starting")
              }
            />
            {rebuildProgress && rebuildProgress.total > 0 && (
              <Progress value={rebuildPercentage} />
            )}
          </div>
        )}

        <Card className="p-4 space-y-4">
          <SettingsFormField
            label={t("settings.embeddings.model_select.label")}
            description={t("settings.embeddings.model_select.description")}>
            <Select
              disabled={isRebuilding}
              value={selectedValue}
              onValueChange={(value) => {
                if (value !== null) handleValueChange(value)
              }}>
              <SelectTrigger>
                <SelectValue
                  placeholder={t(
                    "settings.embeddings.model_select.placeholder"
                  )}>
                  {(value) =>
                    value
                      ? options.get(String(value))?.label || selectedModel
                      : null
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>
                    {t("settings.embeddings.model_select.recommended_group")}
                  </SelectLabel>
                  {Array.from(options.entries())
                    .filter(([, option]) => option.recommended)
                    .map(([value, option]) => (
                      <SelectItem key={value} value={value}>
                        {option.label}
                      </SelectItem>
                    ))}
                </SelectGroup>

                {(showAdvancedModels ||
                  !options.get(selectedValue)?.recommended) && (
                  <SelectGroup>
                    <SelectLabel>
                      {t("settings.embeddings.model_select.all_models_group")}
                    </SelectLabel>
                    {Array.from(options.entries())
                      .filter(
                        ([value, option]) =>
                          !option.recommended &&
                          (showAdvancedModels || value === selectedValue)
                      )
                      .map(([value, option]) => (
                        <SelectItem key={value} value={value}>
                          {option.label}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </SettingsFormField>

          {hasAdvancedModels && (
            <SettingsSwitch
              id="embeddings-show-advanced-models"
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
