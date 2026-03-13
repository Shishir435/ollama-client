import {
  CheckCircle2,
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MiniBadge } from "@/components/ui/mini-badge"

import { Switch } from "@/components/ui/switch"
import { toast } from "@/hooks/use-toast"
import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
import { ProviderFactory } from "@/lib/providers/factory"
import { DEFAULT_PROVIDERS, ProviderManager } from "@/lib/providers/manager"
import { type ProviderConfig, ProviderId } from "@/lib/providers/types"
import { cn } from "@/lib/utils"

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

      setConnectionStatus({
        success: false,
        message: `Failed to connect to ${activeConfig.baseUrl || "default URL"}: ${errorMessage}`
      })

      toast({
        title: t("settings.providers.test_connection.failed_title"),
        description: t(
          "settings.providers.test_connection.failed_description",
          { url: activeConfig.baseUrl, error: errorMessage }
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
    ProviderId.LLAMA_CPP
  ].includes(activeConfig?.id as ProviderId)

  if (loading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="animate-spin h-6 w-6" />
      </div>
    )
  }

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
            <button
              key={provider.id}
              type="button"
              onClick={() => setSelectedId(provider.id)}
              className={cn(
                "relative p-4 rounded-lg border-2 transition-all text-left",
                "hover:border-primary/50 hover:shadow-xs",
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card"
              )}>
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "h-2 w-2 rounded-full",
                      !provider.enabled
                        ? "bg-muted-foreground/40"
                        : hasFailed
                          ? "bg-red-500"
                          : isConnected
                            ? "bg-green-500"
                            : "bg-yellow-500"
                    )}
                  />
                  <h4 className="font-medium">{provider.name}</h4>
                </div>
                {provider.id === DEFAULT_PROVIDER_ID && (
                  <MiniBadge text={t("settings.providers.default")} />
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {provider.baseUrl ||
                  DEFAULT_PROVIDERS.find((p) => p.id === provider.id)?.baseUrl}
              </p>
            </button>
          )
        })}
      </div>

      {/* Configuration Panel */}
      {activeConfig && (
        <div className="border rounded-lg overflow-hidden bg-card">
          {/* Header with Quick Actions */}
          <div className="bg-muted/50 px-5 py-4 border-b flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "h-3 w-3 rounded-full ring-2 ring-offset-2 ring-offset-background transition-colors",
                  !activeConfig.enabled
                    ? "bg-muted-foreground/40 ring-muted-foreground/20"
                    : (connectionStatus?.success ??
                        providerHealth[activeConfig.id]?.success)
                      ? "bg-green-500 ring-green-500/30"
                      : connectionStatus?.success === false ||
                          providerHealth[activeConfig.id]?.success === false
                        ? "bg-red-500 ring-red-500/30"
                        : "bg-yellow-500 ring-yellow-500/30"
                )}
              />
              <div>
                <h3 className="font-semibold text-lg">{activeConfig.name}</h3>
                <p className="text-xs text-muted-foreground">
                  {!activeConfig.enabled
                    ? t("settings.providers.inactive")
                    : (connectionStatus?.success ??
                        providerHealth[activeConfig.id]?.success)
                      ? t("settings.providers.connected")
                      : connectionStatus?.success === false ||
                          providerHealth[activeConfig.id]?.success === false
                        ? t("settings.providers.connection_failed")
                        : t("settings.providers.not_tested")}
                </p>
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
          </div>

          {/* Connection Status Banner */}
          {connectionStatus && (
            <div
              className={cn(
                "px-5 py-3 border-b flex items-center gap-3",
                connectionStatus.success
                  ? "bg-green-500/10 border-green-500/20"
                  : "bg-destructive/10 border-destructive/20"
              )}>
              {connectionStatus.success ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
              ) : (
                <XCircle className="h-5 w-5 shrink-0 text-destructive" />
              )}
              <div>
                <p
                  className={cn(
                    "font-medium text-sm",
                    connectionStatus.success
                      ? "text-green-700 dark:text-green-400"
                      : "text-destructive"
                  )}>
                  {connectionStatus.success
                    ? t("settings.providers.test_connection.success_title")
                    : t("settings.providers.test_connection.failed_title")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {connectionStatus.message}
                </p>
              </div>
            </div>
          )}

          {/* Configuration Form */}
          <div className="p-5 space-y-5">
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
                  {hasUnsavedChanges
                    ? t("settings.providers.save")
                    : t("settings.providers.saved")}
                </Button>
              </div>
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
          </div>
        </div>
      )}
    </div>
  )
}
