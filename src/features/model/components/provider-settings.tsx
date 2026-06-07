import {
  CheckCircle2,
  Info,
  Loader2,
  Plus,
  Save,
  Trash2,
  XCircle,
  Zap
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { StatusCallout } from "@/components/feedback"
import { FieldStack, InlineActions, SectionStack } from "@/components/layout"
import {
  SettingsActionRow,
  SettingsField,
  SettingsInlineControl
} from "@/components/settings"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { MiniBadge } from "@/components/ui/mini-badge"
import { Switch } from "@/components/ui/switch"
import { ProviderGrid } from "@/features/model/components/provider-grid"
import { useProviderSettingsState } from "@/features/model/hooks/use-provider-settings-state"
import { DEFAULT_PROVIDERS } from "@/lib/providers/manager"
import { isBetaProvider } from "@/lib/providers/registry"
import { cn } from "@/lib/utils"

export const ProviderSettings = () => {
  const { t } = useTranslation()
  const {
    providers,
    loading,
    selectedId,
    setSelectedId,
    activeConfig,
    cspCompatibilityHint,
    isLocalProvider,
    isRemoteEndpoint,
    testingConnection,
    connectionStatus,
    hasUnsavedChanges,
    providerHealth,
    headerStatus,
    handleTestConnection,
    handleSave,
    updateConfig,
    setProviderEnabled
  } = useProviderSettingsState()

  if (loading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="animate-spin size-6" />
      </div>
    )
  }

  return (
    <SectionStack>
      <ProviderGrid
        providers={providers}
        selectedId={selectedId}
        providerHealth={providerHealth}
        manualTestStatus={connectionStatus}
        onSelect={setSelectedId}
      />

      {/* Configuration Panel */}
      {activeConfig && (
        <Card>
          <CardHeader className="flex-row items-center justify-between border-b [&>div]:w-full">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "icon-xs shrink-0 rounded-full ring-2 ring-offset-2 ring-offset-background transition-colors",
                  headerStatus.dot
                )}
              />
              <div>
                <CardTitle className="flex items-center gap-2">
                  {activeConfig.name}
                  {isBetaProvider(activeConfig.id) && (
                    <>
                      <MiniBadge text={t("settings.providers.beta_badge")} />
                      <TooltipActionButton
                        trigger={
                          <span className="inline-flex text-muted-foreground hover:text-foreground" />
                        }
                        icon={Info}
                        iconClassName="icon-sm"
                        label={t("settings.providers.beta_notice")}
                        tooltipClassName="max-w-xs"
                      />
                    </>
                  )}
                </CardTitle>
                <CardDescription>
                  {t(`settings.providers.${headerStatus.label}`)}
                </CardDescription>
              </div>
            </div>

            <InlineActions className="gap-4">
              <SettingsInlineControl
                htmlFor="enabled-switch"
                label={
                  activeConfig.enabled
                    ? t("settings.providers.enabled")
                    : t("settings.providers.disabled")
                }>
                <Switch
                  id="enabled-switch"
                  checked={activeConfig.enabled}
                  onCheckedChange={setProviderEnabled}
                />
              </SettingsInlineControl>

              <Button
                variant="outline"
                size="sm"
                onClick={handleTestConnection}
                disabled={testingConnection}>
                {testingConnection ? (
                  <Loader2 className="icon-md mr-2 animate-spin" />
                ) : (
                  <Zap className="icon-md mr-2" />
                )}
                {t("settings.providers.test")}
              </Button>
            </InlineActions>
          </CardHeader>

          {/* Connection Status Banner */}
          {connectionStatus && (
            <StatusCallout
              className="rounded-none border-x-0"
              variant={connectionStatus.success ? "success" : "danger"}
              icon={connectionStatus.success ? CheckCircle2 : XCircle}
              title={
                connectionStatus.success
                  ? t("settings.providers.test_connection.success_title")
                  : t("settings.providers.test_connection.failed_title")
              }
              description={connectionStatus.message}
            />
          )}

          <CardContent>
            <FieldStack>
              <SettingsField
                label={t("settings.providers.base_url")}
                description={
                  <>
                    {t("settings.providers.base_url_default")}:{" "}
                    {
                      DEFAULT_PROVIDERS.find((p) => p.id === activeConfig.id)
                        ?.baseUrl
                    }
                  </>
                }>
                <SettingsActionRow>
                  <Input
                    value={activeConfig.baseUrl || ""}
                    onChange={(e) => updateConfig({ baseUrl: e.target.value })}
                    placeholder="https://api.example.com/v1"
                    className="flex-1"
                  />
                  <Button
                    onClick={() => handleSave(activeConfig)}
                    disabled={!hasUnsavedChanges}>
                    <Save className="icon-md mr-2" />
                    {t("settings.providers.save")}
                  </Button>
                </SettingsActionRow>
                {isRemoteEndpoint && (
                  <p className="mt-2 text-xs text-status-warning">
                    This endpoint is remote. Prompts and responses will be sent
                    outside your local machine.
                  </p>
                )}
                {cspCompatibilityHint && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {cspCompatibilityHint}
                  </p>
                )}
              </SettingsField>

              {!isLocalProvider && (
                <SettingsField label={t("settings.providers.api_key")}>
                  <Input
                    type="password"
                    value={activeConfig.apiKey || ""}
                    onChange={(e) => updateConfig({ apiKey: e.target.value })}
                    placeholder="sk-..."
                  />
                </SettingsField>
              )}

              {!isLocalProvider && (
                <SettingsField
                  label={t("settings.providers.custom_models")}
                  description={t(
                    "settings.providers.custom_models_description"
                  )}>
                  <FieldStack className="space-y-3">
                    <SettingsActionRow>
                      <Input
                        placeholder="e.g. google/gemini-pro"
                        id="custom-model-input"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const input = e.currentTarget
                            const val = input.value.trim()
                            if (
                              val &&
                              !activeConfig.customModels?.includes(val)
                            ) {
                              updateConfig({
                                customModels: [
                                  ...(activeConfig.customModels || []),
                                  val
                                ]
                              })
                              input.value = ""
                            }
                          }
                        }}
                      />
                      <TooltipActionButton
                        variant="outline"
                        size="icon"
                        onClick={() => {
                          const input = document.getElementById(
                            "custom-model-input"
                          ) as HTMLInputElement
                          const val = input.value.trim()
                          if (
                            val &&
                            !activeConfig.customModels?.includes(val)
                          ) {
                            updateConfig({
                              customModels: [
                                ...(activeConfig.customModels || []),
                                val
                              ]
                            })
                            input.value = ""
                          }
                        }}
                        icon={Plus}
                        iconClassName="icon-md"
                        label={t("settings.model.system.add_button")}
                      />
                    </SettingsActionRow>

                    {activeConfig.customModels &&
                      activeConfig.customModels.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {activeConfig.customModels.map((m) => (
                            <div
                              key={m}
                              className="flex items-center gap-2 bg-secondary text-secondary-foreground px-3 py-1.5 rounded-md text-sm">
                              <span>{m}</span>
                              <TooltipActionButton
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="size-5 hover:text-destructive"
                                onClick={() => {
                                  updateConfig({
                                    customModels:
                                      activeConfig.customModels?.filter(
                                        (cm) => cm !== m
                                      )
                                  })
                                }}
                                icon={Trash2}
                                iconClassName="icon-sm"
                                label={t("common.close")}
                                ariaLabel={`${t("common.close")} ${m}`}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                  </FieldStack>
                </SettingsField>
              )}
            </FieldStack>
          </CardContent>
        </Card>
      )}
    </SectionStack>
  )
}
