import { Button } from "@/components/ui/button"
import { ChevronDown, RefreshCcw } from "lucide-react"

import ModelMenu from "./model-menu"

interface RegenerateButtonProps {
  model: string
  onSelectModel: (model: string) => void
}

function RegenerateButton({ model, onSelectModel }: RegenerateButtonProps) {
  return (
    <ModelMenu
      trigger={
        <Button
          size="sm"
          variant="ghost"
          className="group relative flex h-6 items-center gap-1 px-2">
          <RefreshCcw size={16} />
          <span className="relative w-[40px]">
            <span className="absolute inset-0 flex items-center justify-start transition-opacity group-hover:opacity-0">
              <ChevronDown size={8} />
            </span>
            <span className="absolute inset-0 flex items-center justify-start text-xs opacity-0 transition-opacity group-hover:opacity-100">
              {model}
            </span>
          </span>
        </Button>
      }
      onSelectModel={onSelectModel}
      tooltipTextContent="Switch model"
    />
  )
}

export default RegenerateButton
