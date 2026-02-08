import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { DEFAULT_PROVIDER_ID, STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { ProviderFactory } from "@/lib/providers/factory"
import { ProviderManager } from "@/lib/providers/manager"
import { type ProviderConfig, ProviderStorageKey } from "@/lib/providers/types"
import type { ProviderModel } from "@/types"

export const useProviderModels = () => {
  const { t } = useTranslation()
  const [selectedModel, setSelectedModel] = useStorage<string>(
    {
      key: STORAGE_KEYS.PROVIDER.SELECTED_MODEL,
      instance: plasmoGlobalStorage
    },
    ""
  )

  const [providerConfig] = useStorage<ProviderConfig[]>(
    {
      key: ProviderStorageKey.CONFIG,
      instance: plasmoGlobalStorage
    },
    []
  )

  const [models, setModels] = useState<ProviderModel[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  const [versionError, setVersionError] = useState<string | null>(null)

  const fetchModels = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const providers = await ProviderManager.getProviders()
      const enabledProviders = providers.filter((p) => p.enabled)
      console.log(
        `[useProviderModels] Enabled providers:`,
        enabledProviders.map((p) => p.id)
      )

      const allModels: ProviderModel[] = []

      await Promise.all(
        enabledProviders.map(async (config) => {
          try {
            console.log(`[useProviderModels] Fetching for ${config.id}...`)
            // Get provider instance (might trigger creation)
            const provider = await ProviderFactory.getProvider(config.id)
            const providerModels = await provider.getModels() // ProviderModel[]

            // Add custom models if any
            const customs = config.customModels || []

            // Create a map of existing models for easy lookup/merging
            const modelMap = new Map<string, ProviderModel>()
            providerModels.forEach((m) => {
              modelMap.set(m.name, m)
            })

            // Add/Merge custom models
            customs.forEach((name) => {
              if (!modelMap.has(name)) {
                modelMap.set(name, {
                  name: name,
                  model: name,
                  modified_at: new Date().toISOString(),
                  size: 0,
                  digest: config.id,
                  providerId: config.id,
                  providerName: config.name,
                  details: {
                    parent_model: "",
                    format: "gguf",
                    family: config.type,
                    families: [],
                    parameter_size: "",
                    quantization_level: ""
                  }
                })
              }
            })

            modelMap.forEach((model) => {
              // Ensure provider info is set correctly
              if (!model.providerId) model.providerId = config.id
              if (!model.providerName) model.providerName = config.name
              allModels.push(model)
            })
          } catch (e) {
            console.error(`Failed to fetch models for ${config.id}`, e)
          }
        })
      )

      // Persist mappings for background script (critical for routing)
      const mappings: Record<string, string> = {}
      allModels.forEach((m) => {
        if (m.providerId && m.providerId !== DEFAULT_PROVIDER_ID) {
          mappings[m.name] = m.providerId
        }
      })

      if (Object.keys(mappings).length > 0) {
        await ProviderManager.saveModelMappings(mappings)
      }

      // Sort: stable alpha (default provider still tends to be first by mapping)
      allModels.sort((a, b) => a.name.localeCompare(b.name))

      setModels(allModels)

      // Removed auto-select logic to prevent overwriting stored selection during race conditions
    } catch (err) {
      setError(t("errors.failed_to_fetch_models"))
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }, [t])

  const fetchVersion = useCallback(async () => {
    try {
      const config =
        await ProviderManager.getProviderConfig(DEFAULT_PROVIDER_ID)
      const baseUrl = config?.baseUrl || "http://localhost:11434"

      const response = await fetch(`${baseUrl}/api/version`)
      if (response.ok) {
        const data = await response.json()
        setVersion(data.version)
        setVersionError(null)
      } else {
        setVersionError("Failed to fetch version")
      }
    } catch (err) {
      setVersionError("Failed to connect to provider")
      console.error(err)
    }
  }, [])

  const deleteModel = useCallback(
    async (modelName: string) => {
      try {
        const config =
          await ProviderManager.getProviderConfig(DEFAULT_PROVIDER_ID)
        const baseUrl = config?.baseUrl || "http://localhost:11434"

        const response = await fetch(`${baseUrl}/api/delete`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: modelName })
        })

        if (response.ok) {
          await fetchModels() // Refresh the list
        } else {
          throw new Error("Failed to delete model")
        }
      } catch (err) {
        console.error("Error deleting model:", err)
        setError(t("errors.failed_to_delete_model"))
      }
    },
    [fetchModels, t]
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: We want to refetch models/version whenever the provider configuration changes
  useEffect(() => {
    fetchModels()
    fetchVersion()
  }, [providerConfig, fetchModels, fetchVersion])

  // Compute status from current state
  const status = isLoading
    ? "loading"
    : error
      ? "error"
      : models.length === 0
        ? "empty"
        : "ready"

  // Only show version if the selected model is from Ollama (or if no model is selected yet, defaulting to Ollama context)
  const selectedModelData = models.find((m) => m.name === selectedModel)
  const isOllama =
    !selectedModel ||
    !selectedModelData ||
    selectedModelData.providerId === DEFAULT_PROVIDER_ID

  return {
    models,
    selectedModel,
    setSelectedModel,
    isLoading,
    error,
    refresh: fetchModels,
    status,
    version: isOllama ? version : null,
    versionError,
    deleteModel
  }
}
