import { useStorage } from "@plasmohq/storage/hook"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { SettingsFormField, SettingsSwitch } from "@/components/settings"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { knowledgeConfig } from "@/lib/config/knowledge-config"
import {
  DEFAULT_EMBEDDING_CONFIG,
  type EmbeddingConfig,
  STORAGE_KEYS
} from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

export const RAGSettings = () => {
  const { t } = useTranslation()

  const [config, setConfig] = useStorage<EmbeddingConfig>(
    {
      key: STORAGE_KEYS.EMBEDDINGS.CONFIG,
      instance: plasmoGlobalStorage
    },
    DEFAULT_EMBEDDING_CONFIG
  )

  const [systemPrompt, setSystemPrompt] = useState("")
  const [topK, setTopK] = useState(config.defaultSearchLimit)

  // Load initial values
  useEffect(() => {
    const loadSettings = async () => {
      const prompt = await knowledgeConfig.getSystemPrompt()
      setSystemPrompt(prompt)
    }
    loadSettings()
    setTopK(config.defaultSearchLimit)
  }, [config.defaultSearchLimit])

  const handleTopKChange = (value: number[]) => {
    const k = value[0]
    setTopK(k)
    setConfig((prev) => ({ ...prev, defaultSearchLimit: k }))
    knowledgeConfig.setRetrievalTopK(k)
  }

  const handleSystemPromptChange = (
    e: React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    const value = e.target.value
    setSystemPrompt(value)
    knowledgeConfig.setSystemPrompt(value)
  }

  const handleRAGToggle = async (checked: boolean) => {
    await plasmoGlobalStorage.set(STORAGE_KEYS.EMBEDDINGS.USE_RAG, checked)
  }

  const [useRAG] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.EMBEDDINGS.USE_RAG,
      instance: plasmoGlobalStorage
    },
    true
  )

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <SettingsSwitch
          label={t("model.embedding_config.rag_enable_label")}
          description={t("model.embedding_config.rag_enable_description")}
          checked={useRAG}
          onCheckedChange={handleRAGToggle}
        />
      </div>

      <SettingsFormField
        label={`${t("model.embedding_config.search_limit_label")} (Top-K: ${topK})`}
        description={t("model.embedding_config.search_limit_description")}>
        <Slider
          value={[topK]}
          min={1}
          max={20}
          step={1}
          onValueChange={handleTopKChange}
        />
      </SettingsFormField>

      <SettingsFormField
        label={t("model.embedding_config.rag_system_prompt_label")}
        description={t("model.embedding_config.rag_system_prompt_description")}>
        <Textarea
          value={systemPrompt}
          onChange={handleSystemPromptChange}
          placeholder="Enter system prompt..."
          className="min-h-[150px] font-mono text-sm"
        />
      </SettingsFormField>
    </div>
  )
}
