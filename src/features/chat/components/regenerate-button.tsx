import { ChevronDown } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { ModelMenu } from "@/features/model/components/model-menu"

export interface RegenerateButtonProps {
  model: string
  onSelectModel: (model: string) => void
}

/**
 * The model picker beside the Regenerate button: a chevron that opens the
 * model menu and regenerates the reply with whichever model is chosen. Plain
 * Regenerate is the button next to it.
 */
export const RegenerateButton = ({
  model: _model,
  onSelectModel
}: RegenerateButtonProps) => {
  const { t } = useTranslation()
  const label = t("chat.actions.regenerate_with_model")

  return (
    <ModelMenu
      trigger={
        <Button
          size="icon"
          variant="ghost"
          aria-label={label}
          className="group relative flex h-6 w-4 items-center justify-center rounded-control bg-transparent text-muted-foreground hover:bg-state-hover hover:text-foreground">
          <ChevronDown className="icon-xs" />
        </Button>
      }
      onSelectModel={onSelectModel}
      tooltipTextContent={label}
    />
  )
}
