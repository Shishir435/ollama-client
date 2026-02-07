import {
  CheckCircle2,
  Loader2,
  Plus,
  Save,
  Trash2,
  XCircle
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

import { toast } from "@/hooks/use-toast"
import { ProviderFactory } from "@/lib/providers/factory"
import { DEFAULT_PROVIDERS, ProviderManager } from "@/lib/providers/manager"
import { type ProviderConfig, ProviderId } from "@/lib/providers/types"

export const ProviderSettings = () => {
  const { t } = useTranslation()
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string>(ProviderId.OLLAMA)
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<{
    success: boolean
    message: string
  } | null>(null)

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

  // Reset status when switching providers
  // biome-ignore lint/correctness/useExhaustiveDependencies: We want to reset status whenever the selected provider changes
  useEffect(() => {
    setConnectionStatus(null)
  }, [selectedId])

  const activeConfig = providers.find((p) => p.id === selectedId)

  const handleTestConnection = async () => {
    if (!activeConfig) return

    setTestingConnection(true)
    setConnectionStatus(null)

    try {
      // Create a temporary provider instance with CURRENT UI state (even if unsaved)
      // This ensures we test what's on the screen
      const provider = await ProviderFactory.getProviderWithConfig(activeConfig)

      await provider.getModels()

      setConnectionStatus({
        success: true,
        message: "Connection successful"
      })

      toast({
        title: "Connection Successful",
        description: `Successfully connected to ${activeConfig.name}`,
        variant: "default"
      })
    } catch (error: unknown) {
      console.error("Connection failed", error)
      const errorMessage =
        error instanceof Error ? error.message : "Failed to connect"

      setConnectionStatus({
        success: false,
        message: errorMessage
      })

      toast({
        title: "Connection Failed",
        description: errorMessage,
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

  if (loading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="animate-spin h-6 w-6" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-2">
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Select Provider" />
          </SelectTrigger>
          <SelectContent>
            {providers.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name} {p.enabled ? " (On)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {activeConfig && (
        <div className="border rounded-md p-4 space-y-4 bg-card">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-lg">
              {activeConfig.name} Configuration
            </h3>
            <div className="flex items-center space-x-2">
              <Label htmlFor="enabled-switch">Enable</Label>
              <Switch
                id="enabled-switch"
                checked={activeConfig.enabled}
                onCheckedChange={async (checked) => {
                  const updated = { ...activeConfig, enabled: checked }
                  setProviders((prev) =>
                    prev.map((p) => (p.id === activeConfig.id ? updated : p))
                  )
                  // Auto-save toggle for better UX
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
          </div>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Base URL</Label>
              <Input
                value={activeConfig.baseUrl || ""}
                onChange={(e) => {
                  const updated = { ...activeConfig, baseUrl: e.target.value }
                  setProviders((prev) =>
                    prev.map((p) => (p.id === activeConfig.id ? updated : p))
                  )
                  setConnectionStatus(null) // Reset status on change
                }}
                placeholder="https://api.example.com/v1"
              />
              <p className="text-xs text-muted-foreground">
                Default:{" "}
                {
                  DEFAULT_PROVIDERS.find((p) => p.id === activeConfig.id)
                    ?.baseUrl
                }
              </p>
            </div>

            {![
              ProviderId.OLLAMA,
              ProviderId.LM_STUDIO,
              ProviderId.LLAMA_CPP
            ].includes(activeConfig.id as ProviderId) && (
              <div className="grid gap-2">
                <Label>API Key</Label>
                <Input
                  type="password"
                  value={activeConfig.apiKey || ""}
                  onChange={(e) => {
                    const updated = { ...activeConfig, apiKey: e.target.value }
                    setProviders((prev) =>
                      prev.map((p) => (p.id === activeConfig.id ? updated : p))
                    )
                  }}
                  placeholder="sk-..."
                />
              </div>
            )}

            {![
              ProviderId.OLLAMA,
              ProviderId.LM_STUDIO,
              ProviderId.LLAMA_CPP
            ].includes(activeConfig.id as ProviderId) && (
              <div className="grid gap-2 pt-2">
                <Label>Custom Models</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="e.g. google/gemini-pro"
                    id="custom-model-input"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const input = e.currentTarget
                        const val = input.value.trim()
                        if (val && !activeConfig.customModels?.includes(val)) {
                          const updated = {
                            ...activeConfig,
                            customModels: [
                              ...(activeConfig.customModels || []),
                              val
                            ]
                          }
                          setProviders((prev) =>
                            prev.map((p) =>
                              p.id === activeConfig.id ? updated : p
                            )
                          )
                          input.value = ""
                        }
                      }
                    }}
                  />
                  <Button
                    variant="outline"
                    onClick={() => {
                      const input = document.getElementById(
                        "custom-model-input"
                      ) as HTMLInputElement
                      const val = input.value.trim()
                      if (val && !activeConfig.customModels?.includes(val)) {
                        const updated = {
                          ...activeConfig,
                          customModels: [
                            ...(activeConfig.customModels || []),
                            val
                          ]
                        }
                        setProviders((prev) =>
                          prev.map((p) =>
                            p.id === activeConfig.id ? updated : p
                          )
                        )
                        input.value = ""
                      }
                    }}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {activeConfig.customModels?.map((m) => (
                    <div
                      key={m}
                      className="flex items-center gap-1 bg-secondary text-secondary-foreground px-2 py-1 rounded-md text-xs">
                      <span>{m}</span>
                      <button
                        type="button"
                        onClick={() => {
                          const updated = {
                            ...activeConfig,
                            customModels: activeConfig.customModels?.filter(
                              (cm) => cm !== m
                            )
                          }
                          setProviders((prev) =>
                            prev.map((p) =>
                              p.id === activeConfig.id ? updated : p
                            )
                          )
                        }}
                        className="hover:text-destructive">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Add models manually if they don't appear in the
                  auto-discovered list.
                </p>
              </div>
            )}
          </div>

          {connectionStatus && (
            <div
              className={`text-sm flex items-center gap-2 ${connectionStatus.success ? "text-green-600" : "text-destructive"}`}>
              {connectionStatus.success ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              {connectionStatus.message}
            </div>
          )}

          <div className="flex justify-between pt-2">
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={testingConnection}>
              {testingConnection ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              Test Connection
            </Button>

            <Button onClick={() => handleSave(activeConfig)}>
              <Save className="w-4 h-4 mr-2" />
              Save Changes
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
