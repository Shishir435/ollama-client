import { Zap } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  SettingsCard,
  SettingsFormField,
  SettingsSwitch
} from "@/components/settings"
import { Input } from "@/components/ui/input"
import type { EmbeddingConfig } from "@/lib/constants"

interface EmbeddingGenerationConfigProps {
  config: EmbeddingConfig
  updateConfig: (updates: Partial<EmbeddingConfig>) => void
}

export const EmbeddingGenerationConfig = ({
  config,
  updateConfig
}: EmbeddingGenerationConfigProps) => {
  const { t } = useTranslation()

  return (
    <SettingsCard
      icon={Zap}
      title={t("model.embedding_config.embedding_gen_title")}
      description={t("model.embedding_config.embedding_gen_description")}>
      <div className="space-y-4">
        <SettingsFormField
          htmlFor="batchSize"
          label={t("model.embedding_config.batch_size_label")}
          description={t("model.embedding_config.batch_size_description")}>
          <Input
            id="batchSize"
            type="number"
            value={config.batchSize}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10)
              if (!Number.isNaN(val) && val >= 1 && val <= 20) {
                updateConfig({ batchSize: val })
              }
            }}
            min={1}
            max={20}
          />
        </SettingsFormField>

        <SettingsSwitch
          id="enableCaching"
          label={t("model.embedding_config.enable_caching_label")}
          description={t("model.embedding_config.enable_caching_description")}
          checked={config.enableCaching}
          onCheckedChange={(checked) =>
            updateConfig({ enableCaching: checked })
          }
        />

        <SettingsSwitch
          id="useWebWorker"
          label={t("model.embedding_config.use_webworker_label")}
          description={t("model.embedding_config.use_webworker_description")}
          checked={config.useWebWorker}
          onCheckedChange={(checked) => updateConfig({ useWebWorker: checked })}
        />
      </div>
    </SettingsCard>
  )
}
