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
import { SettingsFormField } from "@/components/settings"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MiniBadge } from "@/components/ui/mini-badge"
import { Switch } from "@/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { toast } from "@/hooks/use-toast"
import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
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

  // Track health status for ALL providers
  const [providerHealth, setProviderHealth] = useState<
    Record<
      string,
      {
        success: boolean
        lastChecked: number
      }
    >
  >({})

  const loadProviders = useCallback(async () => {
    setLoading(true)
    try {
      const data = await ProviderManager.getProviders()
      setProviders(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadProviders()
  }, [loadProviders])

  // Auto health check for all enabled providers every 10 seconds
  useEffect(() => {
    const checkHealth = async () => {
      for (const provider of providers) {
        if (!provider.enabled) continue

        try {
          const instance = await ProviderFactory.getProviderWithConfig(provider)
          const models = await instance.getModels()

          if (models.length > 0) {
            setProviderHealth((prev) => ({
              ...prev,
              [provider.id]: { success: true, lastChecked: Date.now() }
            }))
          } else {
            setProviderHealth((prev) => ({
              ...prev,
              [provider.id]: { success: false, lastChecked: Date.now() }
            }))
          }
        } catch (_error) {
          setProviderHealth((prev) => ({
            ...prev,
            [provider.id]: { success: false, lastChecked: Date.now() }
          }))
        }
      }
    }

    // Initial check
    checkHealth()

    // Set up interval
    const interval = setInterval(checkHealth, 10000)

    return () => clearInterval(interval)
  }, [providers])

  // Reset status when switching providers
  // biome-ignore lint/correctness/useExhaustiveDependencies: We want to reset status whenever the selected provider changes
  useEffect(() => {
    setConnectionStatus(null)
    setHasUnsavedChanges(false)
  }, [selectedId])

  const activeConfig = providers.find((p) => p.id === selectedId)
  const cspCompatibilityHint = getCspCompatibilityHint(activeConfig?.baseUrl)

  const handleTestConnection = async () => {
    if (!activeConfig) return

    console.log("[ProviderSettings] Testing connection with config:", {
      id: activeConfig.id,
      name: activeConfig.name,
      baseUrl: activeConfig.baseUrl,
      enabled: activeConfig.enabled
    })

    setTestingConnection(true)
    setConnectionStatus(null)

    try {
      const provider = await ProviderFactory.getProviderWithConfig(activeConfig)
      console.log(
        "[ProviderSettings] Provider instance created, calling getModels()"
      )
      const models = await provider.getModels()
      console.log(
        "[ProviderSettings] getModels() succeeded, found models:",
        models.length
      )

      // Treat 0 models as a connection failure - likely wrong URL or service not running
      if (models.length === 0) {
        setConnectionStatus({
          success: false,
          message: `Connected to ${activeConfig.baseUrl || "default URL"} but found 0 models. Is the service running?`
        })

        toast({
          title: "No Models Found",
          description: `Connected to ${activeConfig.baseUrl} but no models were found. Check if the service is running correctly.`,
          variant: "destructive"
        })
        return
      }

      setConnectionStatus({
        success: true,
        message: `Successfully connected to ${activeConfig.baseUrl || "default URL"} (found ${models.length} models)`
      })

      toast({
        title: t("settings.providers.test_connection.success_title"),
        description: t(
          "settings.providers.test_connection.success_description",
          {
            name: activeConfig.name,
            url: activeConfig.baseUrl,
            count: models.length
          }
        ),
        variant: "default"
      })
    } catch (error: unknown) {
      console.error("[ProviderSettings] Connection test failed:", error)
      const errorMessage =
        error instanceof Error ? error.message : "Failed to connect"
      const shouldShowCspHint =
        errorMessage.toLowerCase().includes("failed to fetch") &&
        Boolean(cspCompatibilityHint)
      const failureMessage = shouldShowCspHint
        ? `Failed to connect to ${activeConfig.baseUrl || "default URL"}: ${errorMessage}. ${cspCompatibilityHint}`
        : `Failed to connect to ${activeConfig.baseUrl || "default URL"}: ${errorMessage}`

      setConnectionStatus({
        success: false,
        message: failureMessage
      })

      toast({
        title: t("settings.providers.test_connection.failed_title"),
        description: t(
          "settings.providers.test_connection.failed_description",
          {
            url: activeConfig.baseUrl,
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
        console.log(
          "[ProviderSettings] Auto-saved configuration for",
          activeConfig.name
        )
      } catch (e) {
        console.error("[ProviderSettings] Auto-save failed", e)
      }
    }, 2000)

    return () => clearTimeout(timeoutId)
  }, [activeConfig, hasUnsavedChanges])

  const isLocalProvider = [
    ProviderId.OLLAMA,
    ProviderId.LM_STUDIO,
    ProviderId.LLAMA_CPP,
    ProviderId.VLLM,
    ProviderId.LOCALAI,
    ProviderId.KOBOLDCPP
  ].includes(activeConfig?.id as ProviderId)
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

  const dotStatusRules = [
    { test: (e: boolean) => !e, cls: "bg-muted-foreground/40" },
    {
      test: (_e: boolean, h: boolean | undefined) => h,
      cls: "bg-status-danger"
    },
    {
      test: (_e: boolean, _h: boolean | undefined, c: boolean | undefined) => c,
      cls: "bg-status-success"
    }
  ] as const
  const getStatusDotClass = (
    enabled: boolean,
    hasFailed: boolean | undefined,
    isConnected: boolean | undefined
  ) =>
    dotStatusRules.find((r) => r.test(enabled, hasFailed, isConnected))?.cls ??
    "bg-status-warning"

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

  const bannerTheme = ["success", "error"] as const
  const bannerConfigs: Record<
    (typeof bannerTheme)[number],
    {
      Icon: typeof CheckCircle2 | typeof XCircle
      bgClass: string
      iconClass: string
      title: string
    }
  > = {
    success: {
      Icon: CheckCircle2,
      bgClass: "bg-status-success/10 border-status-success/20",
      iconClass: "text-status-success",
      title: t("settings.providers.test_connection.success_title")
    },
    error: {
      Icon: XCircle,
      bgClass: "bg-destructive/10 border-destructive/20",
      iconClass: "text-destructive",
      title: t("settings.providers.test_connection.failed_title")
    }
  } as const
  const connectionBanner = connectionStatus
    ? bannerConfigs[bannerTheme[connectionStatus.success ? 0 : 1]]
    : null

  const betaNoticeText =
    "This provider is in beta. If you face any issue, please report it or open an issue on the repo."

  return (
    <div className="space-y-6">
      {/* Provider Selector with Status Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {providers.map((provider) => {
          // Use auto health check status or manual test status
          const isSelected = selectedId === provider.id
          const autoHealth = providerHealth[provider.id]
          const manualTest = isSelected ? connectionStatus : null

          // Prefer manual test if available, otherwise use auto health
          const healthStatus =
            manualTest ||
            (autoHealth
              ? {
                  success: autoHealth.success,
                  message: autoHealth.success ? "Healthy" : "Unhealthy"
                }
              : null)

          const isConnected = healthStatus?.success === true
          const hasFailed = healthStatus?.success === false

          return (
            <Button
              key={provider.id}
              type="button"
              onClick={() => setSelectedId(provider.id)}
              className={cn(
                "h-11 justify-start px-3 transition-colors",
                isSelected
                  ? "border-primary/40 bg-accent/20"
                  : "border-border bg-card hover:bg-accent/10"
              )}>
              <span className="flex items-center gap-2 min-w-0">
                <span
                  className={cn(
                    "inline-block h-2.5 w-2.5 shrink-0 rounded-full",
                    getStatusDotClass(provider.enabled, hasFailed, isConnected)
                  )}
                />

                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="font-medium truncate">{provider.name}</span>

                  {isBetaProvider(provider.id) && (
                    <>
                      <MiniBadge text="Beta" />

                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <span className="inline-flex text-muted-foreground/60 transition-colors hover:text-foreground" />
                          }>
                          <Info className="h-3 w-3" />
                        </TooltipTrigger>

                        <TooltipContent>
                          <p className="max-w-xs text-xs">{betaNoticeText}</p>
                        </TooltipContent>
                      </Tooltip>
                    </>
                  )}

                  {provider.id === DEFAULT_PROVIDER_ID && (
                    <MiniBadge text={t("settings.providers.default")} />
                  )}
                </span>
              </span>
            </Button>
          )
        })}
      </div>

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
                      <MiniBadge text="Beta" />
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <span className="inline-flex text-muted-foreground hover:text-foreground" />
                          }>
                          <Info className="h-3.5 w-3.5" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="max-w-xs">{betaNoticeText}</p>
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

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Label htmlFor="enabled-switch" className="text-sm font-medium">
                  {activeConfig.enabled
                    ? t("settings.providers.enabled")
                    : t("settings.providers.disabled")}
                </Label>
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
                      console.error("Failed to auto-save toggle", e)
                    }
                  }}
                />
              </div>

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
            </div>
          </CardHeader>

          {/* Connection Status Banner */}
          {connectionBanner && (
            <div
              className={cn(
                "flex items-center gap-3 border-y px-4 py-3",
                connectionBanner.bgClass
              )}>
              <connectionBanner.Icon
                className={cn("h-5 w-5 shrink-0", connectionBanner.iconClass)}
              />
              <div>
                <p
                  className={cn(
                    "font-medium text-sm",
                    connectionBanner.iconClass
                  )}>
                  {connectionBanner.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {connectionStatus.message}
                </p>
              </div>
            </div>
          )}

          <CardContent>
            <SettingsFormField
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
              <div className="flex gap-2">
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
              </div>
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
            </SettingsFormField>

            {!isLocalProvider && (
              <SettingsFormField label={t("settings.providers.api_key")}>
                <Input
                  type="password"
                  value={activeConfig.apiKey || ""}
                  onChange={(e) => updateConfig({ apiKey: e.target.value })}
                  placeholder="sk-..."
                />
              </SettingsFormField>
            )}

            {!isLocalProvider && (
              <SettingsFormField
                label={t("settings.providers.custom_models")}
                description={t("settings.providers.custom_models_description")}>
                <div className="space-y-3">
                  <div className="flex gap-2">
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
                        if (val && !activeConfig.customModels?.includes(val)) {
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
                  </div>

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
                </div>
              </SettingsFormField>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
