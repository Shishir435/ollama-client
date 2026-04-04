import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { useProviderModels } from "@/features/model/hooks/use-provider-models"

export const ProviderVersion = () => {
  const { t } = useTranslation()
  const { version, versionError, selectedProviderCapabilities } =
    useProviderModels()
  if (!selectedProviderCapabilities?.providerVersion) return null
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
          <p>{t("model.version.tooltip", { version })}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
