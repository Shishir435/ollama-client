import { Settings } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  SettingsCard,
  SettingsFormField,
  SettingsSwitch
} from "@/components/settings"
import { Input } from "@/components/ui/input"
import type { EmbeddingConfig } from "@/lib/constants"

interface EmbeddingLimitsConfigProps {
  config: EmbeddingConfig
  updateConfig: (updates: Partial<EmbeddingConfig>) => void
}

export const EmbeddingLimitsConfig = ({
  config,
  updateConfig
}: EmbeddingLimitsConfigProps) => {
  const { t } = useTranslation()

  return (
    <SettingsCard
      icon={Settings}
      title={t("model.embedding_config.limits_title")}
      description={t("model.embedding_config.limits_description")}>
      <div className="space-y-4">
        <SettingsFormField
          htmlFor="maxEmbeddingsPerFile"
          label={t("model.embedding_config.max_embeddings_label")}
          description={t("model.embedding_config.max_embeddings_description")}>
          <Input
            id="maxEmbeddingsPerFile"
            type="number"
            value={config.maxEmbeddingsPerFile}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10)
              if (!Number.isNaN(val) && val >= 0) {
                updateConfig({
                  maxEmbeddingsPerFile: val
                })
              }
            }}
            min={0}
          />
        </SettingsFormField>

        <SettingsFormField
          htmlFor="maxStorageSize"
          label={t("model.embedding_config.max_storage_label")}
          description={t("model.embedding_config.max_storage_description")}>
          <Input
            id="maxStorageSize"
            type="number"
            value={config.maxStorageSize}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10)
              if (!Number.isNaN(val) && val >= 0) {
                updateConfig({
                  maxStorageSize: val
                })
              }
            }}
            min={0}
          />
        </SettingsFormField>

        <SettingsSwitch
          id="autoCleanup"
          label={t("model.embedding_config.auto_cleanup_label")}
          description={t("model.embedding_config.auto_cleanup_description")}
          checked={config.autoCleanup}
          onCheckedChange={(checked) => updateConfig({ autoCleanup: checked })}
        />

        {config.autoCleanup && (
          <SettingsFormField
            htmlFor="cleanupDaysOld"
            label={t("model.embedding_config.cleanup_age_label")}
            description={t("model.embedding_config.cleanup_age_description")}>
            <Input
              id="cleanupDaysOld"
              type="number"
              value={config.cleanupDaysOld}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10)
                if (!Number.isNaN(val) && val >= 1) {
                  updateConfig({
                    cleanupDaysOld: val
                  })
                }
              }}
              min={1}
            />
          </SettingsFormField>
        )}
      </div>
    </SettingsCard>
  )
}
