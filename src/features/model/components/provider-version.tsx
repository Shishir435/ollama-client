import { useTranslation } from "react-i18next"

import { TooltipActionButton } from "@/components/actions"
import { Badge } from "@/components/ui/badge"
import { useProviderModels } from "@/features/model/hooks/use-provider-models"

export const ProviderVersion = () => {
  const { t } = useTranslation()
  const { version, versionError, selectedProviderCapabilities } =
    useProviderModels()
  if (!selectedProviderCapabilities?.providerVersion) return null
  if (versionError || !version) return null
  return (
    <div>
      <TooltipActionButton
        trigger={<div />}
        tooltip={<p>{t("model.version.tooltip", { version })}</p>}
        icon={
          <Badge variant="outline" className="cursor-default px-4 py-2">
            {version}
          </Badge>
        }
      />
    </div>
  )
}
