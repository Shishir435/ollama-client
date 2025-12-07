import { useStorage } from "@plasmohq/storage/hook"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
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
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-base">
              {t("model.embedding_config.rag_enable_label")}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t("model.embedding_config.rag_enable_description")}
            </p>
          </div>
          <Switch checked={useRAG} onCheckedChange={handleRAGToggle} />
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex justify-between">
          <Label>
            {t("model.embedding_config.search_limit_label")} (Top-K: {topK})
          </Label>
        </div>
        <Slider
          value={[topK]}
          min={1}
          max={20}
          step={1}
          onValueChange={handleTopKChange}
        />
        <p className="text-xs text-muted-foreground">
          {t("model.embedding_config.search_limit_description")}
        </p>
      </div>

      <div className="space-y-2">
        <Label>{t("model.embedding_config.rag_system_prompt_label")}</Label>
        <Textarea
          value={systemPrompt}
          onChange={handleSystemPromptChange}
          placeholder="Enter system prompt..."
          className="min-h-[150px] font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground">
          {t("model.embedding_config.rag_system_prompt_description")}
        </p>
      </div>
    </div>
  )
}
