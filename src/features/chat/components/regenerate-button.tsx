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
  return (
    <ModelMenu
      trigger={
        <Button
          size="sm"
          variant="ghost"
          className="group relative flex h-6 items-center gap-1 bg-transparent px-4 hover:bg-transparent">
          <RefreshCcw size={16} />
          <span className="relative w-auto">
            <span className="absolute inset-0 flex items-center justify-start transition-opacity group-hover:opacity-0">
              <ChevronDown size={8} />
            </span>
          </span>
        </Button>
      }
      onSelectModel={onSelectModel}
      tooltipTextContent="Switch model"
    />
  )
}
