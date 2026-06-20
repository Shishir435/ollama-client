import { Plus, Trash2 } from "lucide-react"
import { useRef } from "react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { FieldStack } from "@/components/layout"
import { SettingsActionRow, SettingsFormField } from "@/components/settings"
import { Input } from "@/components/ui/input"
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
  const inputRef = useRef<HTMLInputElement>(null)

  const addCustomModel = () => {
    const input = inputRef.current
    const value = input?.value.trim()
    if (!input || !value || activeConfig.customModels?.includes(value)) return

    updateConfig({
      customModels: [...(activeConfig.customModels || []), value]
    })
    input.value = ""
  }

  const removeCustomModel = (model: string) => {
    updateConfig({
      customModels: activeConfig.customModels?.filter((item) => item !== model)
    })
  }

  return (
    <SettingsFormField
      focusId="provider-custom-models"
      label={t("settings.providers.custom_models")}
      description={t("settings.providers.custom_models_description")}>
      <FieldStack className="space-y-3">
        <SettingsActionRow>
          <Input
            ref={inputRef}
            placeholder="e.g. google/gemini-pro"
            id="custom-model-input"
            onKeyDown={(event) => {
              if (event.key === "Enter") addCustomModel()
            }}
          />
          <TooltipActionButton
            variant="outline"
            size="icon"
            onClick={addCustomModel}
            icon={Plus}
            iconClassName="icon-md"
            label={t("settings.model.system.add_button")}
          />
        </SettingsActionRow>

        {activeConfig.customModels && activeConfig.customModels.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {activeConfig.customModels.map((model) => (
              <div
                key={model}
                className="flex items-center gap-2 bg-secondary text-secondary-foreground px-3 py-1.5 rounded-md text-sm">
                <span>{model}</span>
                <TooltipActionButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-5 hover:text-destructive"
                  onClick={() => removeCustomModel(model)}
                  icon={Trash2}
                  iconClassName="icon-sm"
                  label={t("common.close")}
                  ariaLabel={`${t("common.close")} ${model}`}
                />
              </div>
            ))}
          </div>
        )}
      </FieldStack>
    </SettingsFormField>
  )
}
