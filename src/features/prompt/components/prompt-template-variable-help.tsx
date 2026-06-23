import { useTranslation } from "react-i18next"
import { BUILT_IN_PROMPT_TEMPLATE_VARIABLES } from "@/features/prompt/lib/prompt-template-variables"
import { PromptTemplateVariableBadges } from "./prompt-template-variable-badges"

export const PromptTemplateVariableHelp = () => {
  const { t } = useTranslation()

  return (
    <div className="rounded-control border border-border/35 bg-background/45 p-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">
        {t("settings.prompts.variables.title")}
      </div>
      <div className="mb-2">
        <PromptTemplateVariableBadges
          names={[...BUILT_IN_PROMPT_TEMPLATE_VARIABLES]}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {t("settings.prompts.variables.description")}
      </p>
    </div>
  )
}
