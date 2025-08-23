import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { useOllamaModels } from "@/features/model/hooks/use-ollama-models"

export const OllamaVersion = () => {
  const { version, versionError } = useOllamaModels()
  if (versionError || !version) return null
  return (
    <div>
      <Tooltip>
        <TooltipTrigger asChild>
          <div>
            <Badge variant="outline" className="cursor-default px-4 py-2">
              {version}
            </Badge>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>Ollama version: {version}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
