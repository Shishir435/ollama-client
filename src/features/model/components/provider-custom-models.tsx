import { useTranslation } from "react-i18next"

import { SettingsFormField } from "@/components/settings"
import { ModelIdListEditor } from "@/features/model/components/model-id-list-editor"
import type { ProviderConfig } from "@/lib/providers/types"

interface ProviderCustomModelsProps {
  activeConfig: ProviderConfig
  updateConfig: (updates: Partial<ProviderConfig>) => void
}

export const ProviderCustomModels = ({
  activeConfig,
  updateConfig
}: ProviderCustomModelsProps) => {
  const { t } = useTranslation()

  return (
    <SettingsFormField
      focusId="provider-custom-models"
      label={t("settings.providers.custom_models")}
      description={t("settings.providers.custom_models_description")}>
      <ModelIdListEditor
        models={activeConfig.customModels ?? []}
        onChange={(customModels) => updateConfig({ customModels })}
        addLabel={t("settings.providers.models.add")}
        removeLabel={t("settings.providers.models.remove")}
        placeholder={t("settings.providers.models.placeholder")}
      />
    </SettingsFormField>
  )
}
