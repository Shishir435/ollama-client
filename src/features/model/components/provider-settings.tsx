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
import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { ProviderGrid } from "@/features/model/components/provider-grid"
import { useProviderHealth } from "@/features/model/hooks/use-provider-health"
import { toast } from "@/hooks/use-toast"
import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
import { getDisplayErrorMessage } from "@/lib/error-display"
import { logger } from "@/lib/logger"
import { ProviderFactory } from "@/lib/providers/factory"
import { DEFAULT_PROVIDERS, ProviderManager } from "@/lib/providers/manager"
import { isBetaProvider } from "@/lib/providers/registry"
import { type ProviderConfig, ProviderId } from "@/lib/providers/types"
import { cn } from "@/lib/utils"

const getCspCompatibilityHint = (baseUrl?: string) => {
  const trimmedUrl = baseUrl?.trim()
  if (!trimmedUrl) return null

  try {
    const parsed = new URL(trimmedUrl)
    const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(
      parsed.hostname
    )

    if (isLocalhost) return null

    return 'If you are on an older extension build and see "Failed to fetch" with Content Security Policy errors, update/reload the extension to apply LAN endpoint support.'
  } catch {
    return null
  }
}

export const ProviderSettings = () => {
  const { t } = useTranslation()
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string>(DEFAULT_PROVIDER_ID)
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<{
    success: boolean
    message: string
  } | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  const providerHealth = useProviderHealth(providers)

  const loadProviders = useCallback(async () => {
    setLoading(true)
    try {
      const data = await ProviderManager.getProviders()
      setProviders(data)
    } catch (e) {
      logger.error("Failed to load providers", "ProviderSettings", { error: e })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadProviders()
  }, [loadProviders])

  // Reset status when switching providers
  // biome-ignore lint/correctness/useExhaustiveDependencies: We want to reset status whenever the selected provider changes
  useEffect(() => {
    setConnectionStatus(null)
    setHasUnsavedChanges(false)
  }, [selectedId])

  const activeConfig = providers.find((p) => p.id === selectedId)
  const cspCompatibilityHint = getCspCompatibilityHint(activeConfig?.baseUrl)
  const displayUrl =
    activeConfig?.baseUrl || t("settings.providers.test_connection.default_url")

  const isLocalProvider = [
    ProviderId.OLLAMA,
    ProviderId.LM_STUDIO,
    ProviderId.LLAMA_CPP,
    ProviderId.VLLM,
    ProviderId.LOCALAI,
    ProviderId.KOBOLDCPP
  ].includes(activeConfig?.id as ProviderId)

  const handleTestConnection = async () => {
    if (!activeConfig) return

    logger.info("Testing connection with config", "ProviderSettings", {
      id: activeConfig.id,
      name: activeConfig.name,
      baseUrl: activeConfig.baseUrl,
      enabled: activeConfig.enabled
    })

    setTestingConnection(true)
    setConnectionStatus(null)

    if (!isLocalProvider && !activeConfig.apiKey?.trim()) {
      const message = t("settings.providers.test_connection.api_key_required", {
        name: activeConfig.name
      })

      setConnectionStatus({
        success: false,
        message
      })

      toast({
        title: t("settings.providers.test_connection.api_key_required_title"),
        description: message,
        variant: "destructive"
      })
      setTestingConnection(false)
      return
    }

    try {
      const provider = await ProviderFactory.getProviderWithConfig(activeConfig)
      logger.debug(
        "Provider instance created, calling getModels()",
        "ProviderSettings"
      )
      const models = await provider.getModels()
      logger.debug("getModels() succeeded", "ProviderSettings", {
        count: models.length
      })

      // Treat 0 models as a connection failure: the URL may be wrong, the
      // service may be offline, auth may have failed, or no models are loaded.
      if (models.length === 0) {
        setConnectionStatus({
          success: false,
          message: t("settings.providers.test_connection.inline_no_models", {
            url: displayUrl
          })
        })

        toast({
          title: t("settings.providers.test_connection.no_models_title"),
          description: t(
            "settings.providers.test_connection.no_models_description",
            { url: displayUrl }
          ),
          variant: "destructive"
        })
        return
      }

      setConnectionStatus({
        success: true,
        message: t("settings.providers.test_connection.inline_success", {
          url: displayUrl,
          count: models.length
        })
      })

      toast({
        title: t("settings.providers.test_connection.success_title"),
        description: t(
          "settings.providers.test_connection.success_description",
          {
            name: activeConfig.name,
            url: displayUrl,
            count: models.length
          }
        ),
        variant: "default"
      })
    } catch (error: unknown) {
      logger.error("Connection test failed", "ProviderSettings", { error })
      const errorMessage = getDisplayErrorMessage(error, "Failed to connect")
      const shouldShowCspHint =
        errorMessage.toLowerCase().includes("failed to fetch") &&
        Boolean(cspCompatibilityHint)
      const failureMessage = t(
        "settings.providers.test_connection.inline_failed",
        {
          url: displayUrl,
          error: shouldShowCspHint
            ? `${errorMessage}. ${cspCompatibilityHint}`
            : errorMessage
        }
      )

      setConnectionStatus({
        success: false,
        message: failureMessage
      })

      toast({
        title: t("settings.providers.test_connection.failed_title"),
        description: t(
          "settings.providers.test_connection.failed_description",
          {
            url: displayUrl,
            error: shouldShowCspHint
              ? `${errorMessage}. ${cspCompatibilityHint}`
              : errorMessage
          }
        ),
        variant: "destructive"
      })
    } finally {
      setTestingConnection(false)
    }
  }

  const handleSave = async (config: ProviderConfig) => {
    try {
      await ProviderManager.updateProviderConfig(config.id, config)
      setProviders((prev) => prev.map((p) => (p.id === config.id ? config : p)))
      setHasUnsavedChanges(false)
      toast({
        title: t("settings.saved"),
        description: `Configuration for ${config.name} saved.`
      })
    } catch (_e) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to save configuration."
      })
    }
  }

  const updateConfig = (updates: Partial<ProviderConfig>) => {
    if (!activeConfig) return
    const updated = { ...activeConfig, ...updates }
    setProviders((prev) =>
      prev.map((p) => (p.id === activeConfig.id ? updated : p))
    )
    setHasUnsavedChanges(true)
    setConnectionStatus(null)
  }

  // Auto-save base URL changes after 2 seconds of inactivity
  useEffect(() => {
    if (!hasUnsavedChanges || !activeConfig) return

    const timeoutId = setTimeout(async () => {
      try {
        await ProviderManager.updateProviderConfig(
          activeConfig.id,
          activeConfig
        )
        setHasUnsavedChanges(false)
        logger.debug(
          `Auto-saved configuration for ${activeConfig.name}`,
          "ProviderSettings"
        )
      } catch (e) {
        logger.error("Auto-save failed", "ProviderSettings", { error: e })
      }
    }, 2000)

    return () => clearTimeout(timeoutId)
  }, [activeConfig, hasUnsavedChanges])

  const isRemoteEndpoint = (() => {
    const url = activeConfig?.baseUrl?.trim()
    if (!url) return false
    try {
      const parsed = new URL(url)
      return !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
    } catch {
      return false
    }
  })()

  if (loading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="animate-spin h-6 w-6" />
      </div>
    )
  }

  const headerStatusConfigs = [
    {
      test: () => !activeConfig?.enabled,
      dot: "bg-muted-foreground/40 ring-muted-foreground/20",
      label: "inactive"
    },
    {
      test: () =>
        connectionStatus?.success ?? providerHealth[activeConfig.id]?.success,
      dot: "bg-status-success ring-status-success/30",
      label: "connected"
    },
    {
      test: () =>
        connectionStatus?.success === false ||
        providerHealth[activeConfig.id]?.success === false,
      dot: "bg-status-danger ring-status-danger/30",
      label: "connection_failed"
    }
  ] as const
  const headerStatus = headerStatusConfigs.find((c) => c.test()) ?? {
    dot: "bg-status-warning ring-status-warning/30",
    label: "not_tested"
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
                  "size-3 shrink-0 rounded-full ring-2 ring-offset-2 ring-offset-background transition-colors",
                  headerStatus.dot
                )}
              />
              <div>
                <CardTitle className="flex items-center gap-2">
                  {activeConfig.name}
                  {isBetaProvider(activeConfig.id) && (
                    <>
                      <MiniBadge text={t("settings.providers.beta_badge")} />
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <span className="inline-flex text-muted-foreground hover:text-foreground" />
                          }>
                          <Info className="h-3.5 w-3.5" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="max-w-xs">
                            {t("settings.providers.beta_notice")}
                          </p>
                        </TooltipContent>
                      </Tooltip>
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
                  onCheckedChange={async (checked) => {
                    const updated = { ...activeConfig, enabled: checked }
                    setProviders((prev) =>
                      prev.map((p) => (p.id === activeConfig.id ? updated : p))
                    )
                    try {
                      await ProviderManager.updateProviderConfig(
                        activeConfig.id,
                        { enabled: checked }
                      )
                    } catch (e) {
                      logger.error(
                        "Failed to auto-save toggle",
                        "ProviderSettings",
                        { error: e }
                      )
                    }
                  }}
                />
              </SettingsInlineControl>

              <Button
                variant="outline"
                size="sm"
                onClick={handleTestConnection}
                disabled={testingConnection}>
                {testingConnection ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Zap className="w-4 h-4 mr-2" />
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
                    <Save className="w-4 h-4 mr-2" />
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
                      <Button
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
                        }}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </SettingsActionRow>

                    {activeConfig.customModels &&
                      activeConfig.customModels.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {activeConfig.customModels.map((m) => (
                            <div
                              key={m}
                              className="flex items-center gap-2 bg-secondary text-secondary-foreground px-3 py-1.5 rounded-md text-sm">
                              <span>{m}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  updateConfig({
                                    customModels:
                                      activeConfig.customModels?.filter(
                                        (cm) => cm !== m
                                      )
                                  })
                                }}
                                className="hover:text-destructive transition-colors">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
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
