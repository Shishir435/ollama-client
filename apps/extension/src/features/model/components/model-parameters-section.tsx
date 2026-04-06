import { useTranslation } from "react-i18next"
import { SettingsCard } from "@/components/settings"
import { FormNumberInput } from "@/features/model/components/form-number-input"
import { FormSlider } from "@/features/model/components/form-slider"
import {
  getNumberInputConfigs,
  getSliderConfigs
} from "@/features/model/lib/model-form-config"
import { Brain, Target } from "@/lib/lucide-icon"

export const ModelParametersSection = () => {
  const { t } = useTranslation()

  const sliderConfigs = getSliderConfigs(t)
  const numberInputConfigs = getNumberInputConfigs(t)

  const samplingNumberInputs = numberInputConfigs.filter(
    (f) => f.group === "sampling"
  )
  const contextNumberInputsRow1 = numberInputConfigs.filter(
    (f) => f.group === "context-row1"
  )
  const contextNumberInputsRow2 = numberInputConfigs.filter(
    (f) => f.group === "context-row2"
  )
  const contextNumberInputsRow3 = numberInputConfigs.filter(
    (f) => f.group === "context-row3"
  )

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <SettingsCard
        title={t("settings.model.sampling.title")}
        description={t("settings.model.sampling.description")}
        icon={Target}>
        <div className="space-y-6">
          {sliderConfigs.map((slider) => (
            <FormSlider key={slider.name} {...slider} />
          ))}
          <div className="grid grid-cols-2 gap-4">
            {samplingNumberInputs.map((input) => (
              <FormNumberInput key={input.name} {...input} />
            ))}
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title={t("settings.model.context.title")}
        description={t("settings.model.context.description")}
        icon={Brain}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {contextNumberInputsRow1.map((input) => (
              <FormNumberInput key={input.name} {...input} />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {contextNumberInputsRow2.map((input) => (
              <FormNumberInput key={input.name} {...input} />
            ))}
          </div>
          {contextNumberInputsRow3.map((input) => (
            <FormNumberInput key={input.name} {...input} />
          ))}
        </div>
      </SettingsCard>
    </div>
  )
}
