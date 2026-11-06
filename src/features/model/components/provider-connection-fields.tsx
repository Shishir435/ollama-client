import { TriangleAlert } from "lucide-react"
import { useTranslation } from "react-i18next"
import { StatusCallout } from "@/components/feedback"
import { SecretKeyField } from "@/components/forms"
import { SettingsFormField } from "@/components/settings"
import { Input } from "@/components/ui/input"
import {
  type ProviderDraft,
  type ProviderDraftUpdate,
  providerDraftApiKeyValue
} from "@/features/model/types/provider-draft"
import { DEFAULT_PROVIDERS } from "@/lib/providers/manager"

interface ProviderConnectionFieldsProps {
  activeConfig: ProviderDraft
  cspCompatibilityHint: string | null
  isLocalProvider: boolean
  isRemoteEndpoint: boolean
  isLocalNetworkEndpoint?: boolean
  updateConfig: (updates: ProviderDraftUpdate) => void
}

export const ProviderConnectionFields = ({
  activeConfig,
  cspCompatibilityHint,
  isLocalProvider,
  isRemoteEndpoint,
  isLocalNetworkEndpoint = false,
  updateConfig
}: ProviderConnectionFieldsProps) => {
  const { t } = useTranslation()
  // Custom providers have no shipped default URL — omit the description.
  const defaultBaseUrl = DEFAULT_PROVIDERS.find(
    (p) => p.id === activeConfig.id
  )?.baseUrl

  return (
    <>
      <SettingsFormField
        focusId="provider-base-url"
        htmlFor="provider-base-url-input"
        label={t("settings.providers.base_url")}
        description={
          defaultBaseUrl ? (
            <>
              {t("settings.providers.base_url_default")}: {defaultBaseUrl}
            </>
          ) : undefined
        }>
        <Input
          id="provider-base-url-input"
          value={activeConfig.baseUrl || ""}
          onChange={(e) => updateConfig({ baseUrl: e.target.value })}
          placeholder="https://api.example.com/v1"
        />
        {isRemoteEndpoint && (
          <StatusCallout
            variant="warning"
            icon={TriangleAlert}
            className="mt-2 text-foreground"
            title={t("settings.providers.add.remote_notice")}
          />
        )}
        {isLocalNetworkEndpoint && (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("settings.providers.add.local_network_notice")}
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
          htmlFor="provider-api-key-input"
          label={t("settings.providers.api_key")}>
          <SecretKeyField
            id="provider-api-key-input"
            stored={activeConfig.hasApiKey}
            value={providerDraftApiKeyValue(activeConfig)}
            onChange={(apiKey) => updateConfig({ apiKey })}
            onRemove={() => updateConfig({ clearApiKey: true })}
            removePending={activeConfig.apiKey.state === "cleared"}
            onUndoRemove={() => updateConfig({ apiKey: "" })}
            onCancelReplace={() => updateConfig({ apiKey: "" })}
            placeholder="sk-..."
          />
        </SettingsFormField>
      )}
    </>
  )
}
