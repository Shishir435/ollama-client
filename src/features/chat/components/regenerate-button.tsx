import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { ModelMenu } from "@/features/model/components/model-menu"
import { ChevronDown, RefreshCcw } from "@/lib/lucide-icon"

interface RegenerateButtonProps {
  model: string
  onSelectModel: (model: string) => void
}

export const RegenerateButton = ({
  model: _model,
  onSelectModel
}: RegenerateButtonProps) => {
  const { t } = useTranslation()

  return (
    <ModelMenu
      trigger={
        <Button
          size="icon"
          variant="ghost"
          className="group relative flex size-7 items-center justify-center bg-transparent hover:bg-muted/60">
          <RefreshCcw size={14} />
          <ChevronDown
            size={8}
            className="absolute -bottom-0.5 right-0.5 text-muted-foreground opacity-70 transition-opacity group-hover:opacity-0"
          />
        </Button>
      }
      onSelectModel={onSelectModel}
      tooltipTextContent={t("chat.actions.switch_model_tooltip")}
    />
  )
}
