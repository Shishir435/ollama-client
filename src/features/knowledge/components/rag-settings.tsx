import { useStorage } from "@plasmohq/storage/hook"
import { useEffect, useState } from "react"
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
            <Label className="text-base">Enable RAG</Label>
            <p className="text-sm text-muted-foreground">
              Use retrieved context to answer questions about your files
            </p>
          </div>
          <Switch checked={useRAG} onCheckedChange={handleRAGToggle} />
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex justify-between">
          <Label>Retrieval Count (Top-K: {topK})</Label>
        </div>
        <Slider
          value={[topK]}
          min={1}
          max={20}
          step={1}
          onValueChange={handleTopKChange}
        />
        <p className="text-xs text-muted-foreground">
          Number of relevant chunks to retrieve. Higher values provide more
          context but use more tokens.
        </p>
      </div>

      <div className="space-y-2">
        <Label>RAG System Prompt</Label>
        <Textarea
          value={systemPrompt}
          onChange={handleSystemPromptChange}
          placeholder="Enter system prompt..."
          className="min-h-[150px] font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Template for the system prompt. Use {"{context}"} for retrieved text
          and {"{question}"} for the user query.
        </p>
      </div>
    </div>
  )
}
