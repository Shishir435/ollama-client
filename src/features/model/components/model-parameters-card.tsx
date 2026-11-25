import { Brain, Target } from "lucide-react"
import { useTranslation } from "react-i18next"
import { ControlledNumberInput, ControlledSlider } from "@/components/forms"
import { DenseFormGrid, SectionStack, TwoColumnGrid } from "@/components/layout"
import { SettingsCard } from "@/components/settings"
import {
  getNumberInputConfigs,
  getSliderConfigs
} from "@/features/model/lib/model-form-config"
import { AUTO_CONTEXT_CAP_TOKENS } from "@/lib/constants"
import type { ReasoningEffort, ReasoningEffortSupport } from "@/types/model"
import { ReasoningEffortField } from "./reasoning-effort-field"

export const ModelParametersCard = ({
  reasoningEffort,
  reasoningSupport,
  onReasoningEffortChange,
  effectiveContext,
  contextAuto = false,
  contextCapped = false
}: {
  reasoningEffort: ReasoningEffort
  reasoningSupport?: ReasoningEffortSupport
  onReasoningEffortChange: (value: ReasoningEffort) => void
  /** The window a request actually asks for, given Auto or the model's limit. */
  effectiveContext?: number
  /** The window is left on Auto; only then does the Auto explanation apply. */
  contextAuto?: boolean
  /** An explicit window the model's own reported limit holds down. */
  contextCapped?: boolean
}) => {
  const { t } = useTranslation()

  const sliderConfigs = getSliderConfigs(t)
  const numberInputConfigs = getNumberInputConfigs(t, { effectiveContext })

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
          {reasoningSupport && (
            <ReasoningEffortField
              value={reasoningEffort}
              support={reasoningSupport}
              onChange={onReasoningEffortChange}
            />
          )}
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
          {/* An explicit window that fits needs no note: it is what is sent. */}
          {effectiveContext !== undefined && (contextAuto || contextCapped) && (
            <p className="text-xs text-muted-foreground">
              {t(
                contextAuto
                  ? "settings.model.parameters.num_ctx.effective"
                  : "settings.model.parameters.num_ctx.capped",
                {
                  value: effectiveContext.toLocaleString(),
                  cap: AUTO_CONTEXT_CAP_TOKENS.toLocaleString()
                }
              )}
            </p>
          )}
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
