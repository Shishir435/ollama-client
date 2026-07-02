import { Save } from "lucide-react"
import { useTranslation } from "react-i18next"
import { SettingsActionRow, SettingsFormField } from "@/components/settings"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DEFAULT_PROVIDERS } from "@/lib/providers/manager"
import type { ProviderConfig } from "@/lib/providers/types"

interface ProviderConnectionPanelProps {
  activeConfig: ProviderConfig
  cspCompatibilityHint: string | null
  isLocalProvider: boolean
  isRemoteEndpoint: boolean
  hasUnsavedChanges: boolean
  onSave: (config: ProviderConfig) => void
  updateConfig: (updates: Partial<ProviderConfig>) => void
}

export const ProviderConnectionPanel = ({
  activeConfig,
  cspCompatibilityHint,
  isLocalProvider,
  isRemoteEndpoint,
  hasUnsavedChanges,
  onSave,
  updateConfig
}: ProviderConnectionPanelProps) => {
  const { t } = useTranslation()
  // Custom providers have no shipped default URL — omit the description.
  const defaultBaseUrl = DEFAULT_PROVIDERS.find(
    (p) => p.id === activeConfig.id
  )?.baseUrl

  return (
    <>
      <SettingsFormField
        focusId="provider-base-url"
        label={t("settings.providers.base_url")}
        description={
          defaultBaseUrl ? (
            <>
              {t("settings.providers.base_url_default")}: {defaultBaseUrl}
            </>
          ) : undefined
        }>
        <SettingsActionRow>
          <Input
            value={activeConfig.baseUrl || ""}
            onChange={(e) => updateConfig({ baseUrl: e.target.value })}
            placeholder="https://api.example.com/v1"
            className="flex-1"
          />
          <Button
            onClick={() => onSave(activeConfig)}
            disabled={!hasUnsavedChanges}>
            <Save className="icon-md mr-2" />
            {t("settings.providers.save")}
          </Button>
        </SettingsActionRow>
        {isRemoteEndpoint && (
          <p className="mt-2 text-xs text-status-warning">
            This endpoint is remote. Prompts and responses will be sent outside
            your local machine.
          </p>
        )}
        {cspCompatibilityHint && (
          <p className="mt-2 text-xs text-muted-foreground">
            {cspCompatibilityHint}
          </p>
        )}
      </SettingsFormField>

      {!isLocalProvider && (
        <SettingsFormField
          focusId="provider-api-key"
          label={t("settings.providers.api_key")}>
          <Input
            type="password"
            value={activeConfig.apiKey || ""}
            onChange={(e) => updateConfig({ apiKey: e.target.value })}
            placeholder="sk-..."
          />
        </SettingsFormField>
      )}
    </>
  )
}
