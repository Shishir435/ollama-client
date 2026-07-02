import { useTranslation } from "react-i18next"
import { ControlledNumberInput, ControlledSlider } from "@/components/forms"
import { DenseFormGrid, SectionStack, TwoColumnGrid } from "@/components/layout"
import { SettingsCard } from "@/components/settings"
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
    <TwoColumnGrid>
      <SettingsCard
        title={t("settings.model.sampling.title")}
        description={t("settings.model.sampling.description")}
        icon={Target}>
        <SectionStack>
          {sliderConfigs.map((slider) => (
            <ControlledSlider {...slider} key={slider.name} />
          ))}
          <DenseFormGrid>
            {samplingNumberInputs.map((input) => (
              <ControlledNumberInput {...input} key={input.name} />
            ))}
          </DenseFormGrid>
        </SectionStack>
      </SettingsCard>

      <SettingsCard
        title={t("settings.model.context.title")}
        description={t("settings.model.context.description")}
        icon={Brain}>
        <SectionStack className="space-y-4">
          <DenseFormGrid>
            {contextNumberInputsRow1.map((input) => (
              <ControlledNumberInput {...input} key={input.name} />
            ))}
          </DenseFormGrid>
          <DenseFormGrid>
            {contextNumberInputsRow2.map((input) => (
              <ControlledNumberInput {...input} key={input.name} />
            ))}
          </DenseFormGrid>
          {contextNumberInputsRow3.map((input) => (
            <ControlledNumberInput {...input} key={input.name} />
          ))}
        </SectionStack>
      </SettingsCard>
    </TwoColumnGrid>
  )
}
