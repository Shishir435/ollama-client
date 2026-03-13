import { useStorage } from "@plasmohq/storage/hook"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { SettingsFormField, SettingsSwitch } from "@/components/settings"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { knowledgeConfig } from "@/lib/config/knowledge-config"
import {
  DEFAULT_EMBEDDING_CONFIG,
  type EmbeddingConfig,
  STORAGE_KEYS
} from "@/lib/constants"
import {
  createKnowledgeSet,
  DEFAULT_KNOWLEDGE_SET_ID,
  DEFAULT_RAG_PROMPT,
  deleteKnowledgeSet,
  getActiveKnowledgeSetId,
  listKnowledgeSets,
  setActiveKnowledgeSetId,
  updateKnowledgeSet
} from "@/lib/knowledge/knowledge-sets"
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

  const [topK, setTopK] = useState(config.defaultSearchLimit)
  const [knowledgeSets, setKnowledgeSets] = useState<
    Array<{
      id: string
      name: string
      ragPrompt?: string
      questionPrompt?: string
      retrieval?: {
        topK?: number
        minSimilarity?: number
        minRerankScore?: number
      }
    }>
  >([])
  const [activeKnowledgeSetId, setActiveKnowledgeSetIdState] = useState("")
  const [newSetName, setNewSetName] = useState("")
  const [knowledgePrompt, setKnowledgePrompt] = useState(DEFAULT_RAG_PROMPT)
  const [knowledgeQuestionPrompt, setKnowledgeQuestionPrompt] = useState("")
  const [defaultQuestionPrompt, setDefaultQuestionPrompt] = useState("")
  const [knowledgeTopK, setKnowledgeTopK] = useState(topK)
  const [knowledgeMinSimilarity, setKnowledgeMinSimilarity] = useState(
    DEFAULT_EMBEDDING_CONFIG.defaultMinSimilarity
  )
  const [knowledgeSetName, setKnowledgeSetName] = useState("")
  const [minRerankScore, setMinRerankScore] = useState(
    config.minRerankScore ?? DEFAULT_EMBEDDING_CONFIG.minRerankScore
  )

  // Load initial values
  useEffect(() => {
    const loadSettings = async () => {
      const questionPrompt = await knowledgeConfig.getQuestionPrompt()
      setDefaultQuestionPrompt(questionPrompt)
      const sets = await listKnowledgeSets()
      const activeId = await getActiveKnowledgeSetId()
      setKnowledgeSets(sets)
      setActiveKnowledgeSetIdState(activeId)
    }
    loadSettings()
    setTopK(config.defaultSearchLimit)
  }, [config.defaultSearchLimit])

  const activeSet = knowledgeSets.find((set) => set.id === activeKnowledgeSetId)

  useEffect(() => {
    if (!activeSet) return
    setKnowledgePrompt(activeSet.ragPrompt || DEFAULT_RAG_PROMPT)
    setKnowledgeQuestionPrompt(
      activeSet.questionPrompt || defaultQuestionPrompt
    )
    setKnowledgeTopK(activeSet.retrieval?.topK ?? topK)
    setKnowledgeMinSimilarity(
      activeSet.retrieval?.minSimilarity ??
        DEFAULT_EMBEDDING_CONFIG.defaultMinSimilarity
    )
    setKnowledgeSetName(activeSet.name)
  }, [activeSet, topK, defaultQuestionPrompt])

  useEffect(() => {
    setMinRerankScore(
      config.minRerankScore ?? DEFAULT_EMBEDDING_CONFIG.minRerankScore
    )
  }, [config.minRerankScore])

  const refreshKnowledgeSets = async () => {
    const sets = await listKnowledgeSets()
    setKnowledgeSets(sets)
  }

  const handleCreateKnowledgeSet = async () => {
    const name = newSetName.trim()
    if (!name) return
    const created = await createKnowledgeSet({ name })
    await setActiveKnowledgeSetId(created.id)
    setActiveKnowledgeSetIdState(created.id)
    setNewSetName("")
    await refreshKnowledgeSets()
  }

  const handleKnowledgeSetChange = async (value: string) => {
    await setActiveKnowledgeSetId(value)
    setActiveKnowledgeSetIdState(value)
  }

  const updateKnowledgeRetrieval = async (updates: {
    topK?: number
    minSimilarity?: number
    minRerankScore?: number
  }) => {
    if (!activeSet) return
    await updateKnowledgeSet(activeSet.id, {
      retrieval: {
        ...activeSet.retrieval,
        ...updates
      }
    })
    await refreshKnowledgeSets()
  }

  const handleTopKChange = (value: number[]) => {
    const k = value[0]
    setTopK(k)
    setConfig((prev) => ({ ...prev, defaultSearchLimit: k }))
    knowledgeConfig.setRetrievalTopK(k)
  }

  const handleKnowledgePromptChange = async (
    e: React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    const value = e.target.value
    setKnowledgePrompt(value)
    if (!activeSet) return
    await updateKnowledgeSet(activeSet.id, { ragPrompt: value })
    await refreshKnowledgeSets()
  }

  const handleKnowledgeQuestionPromptChange = async (
    e: React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    const value = e.target.value
    setKnowledgeQuestionPrompt(value)
    if (!activeSet) return
    await updateKnowledgeSet(activeSet.id, { questionPrompt: value })
    await refreshKnowledgeSets()
  }

  const handleRenameKnowledgeSet = async () => {
    if (!activeSet) return
    const name = knowledgeSetName.trim()
    if (!name) return
    await updateKnowledgeSet(activeSet.id, { name })
    await refreshKnowledgeSets()
  }

  const handleDeleteKnowledgeSet = async () => {
    if (!activeSet || activeSet.id === DEFAULT_KNOWLEDGE_SET_ID) return
    const confirmed = window.confirm(
      t("knowledge_sets.delete_confirm", { name: activeSet.name })
    )
    if (!confirmed) return
    await deleteKnowledgeSet(activeSet.id)
    const activeId = await getActiveKnowledgeSetId()
    setActiveKnowledgeSetIdState(activeId)
    await refreshKnowledgeSets()
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

        <SettingsSwitch
          label={t("model.embedding_config.reranking_label")}
          description={t("model.embedding_config.reranking_description")}
          checked={config.useReranking ?? false}
          onCheckedChange={(checked) =>
            setConfig((prev) => ({
              ...prev,
              useReranking: checked,
              rerankerBackend: checked ? "cosine" : "none"
            }))
          }
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
        label={`${t("knowledge_sets.min_rerank_label")} (${minRerankScore.toFixed(2)})`}
        description={t("knowledge_sets.min_rerank_description")}>
        <Slider
          value={[minRerankScore]}
          min={0}
          max={1}
          step={0.05}
          onValueChange={([value]) => {
            setMinRerankScore(value)
            setConfig((prev) => ({
              ...prev,
              minRerankScore: value
            }))
          }}
        />
      </SettingsFormField>

      <Accordion type="single" collapsible className="w-full">
        <AccordionItem value="knowledge-sets">
          <AccordionTrigger>{t("knowledge_sets.title")}</AccordionTrigger>
          <AccordionContent className="space-y-6 pt-4">
            <SettingsFormField
              label={t("knowledge_sets.active_label")}
              description={t("knowledge_sets.active_description")}>
              <Select
                value={activeKnowledgeSetId}
                onValueChange={handleKnowledgeSetChange}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={t("knowledge_sets.active_placeholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {knowledgeSets.map((set) => (
                      <SelectItem key={set.id} value={set.id}>
                        {set.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </SettingsFormField>

            <SettingsFormField
              label={t("knowledge_sets.create_label")}
              description={t("knowledge_sets.create_description")}>
              <div className="flex gap-2">
                <Input
                  value={newSetName}
                  placeholder={t("knowledge_sets.create_placeholder")}
                  onChange={(e) => setNewSetName(e.target.value)}
                />
                <Button type="button" onClick={handleCreateKnowledgeSet}>
                  {t("knowledge_sets.create_button")}
                </Button>
              </div>
            </SettingsFormField>

            {activeSet && (
              <>
                <SettingsFormField
                  label={t("knowledge_sets.rename_label")}
                  description={t("knowledge_sets.rename_description")}>
                  <div className="flex gap-2">
                    <Input
                      value={knowledgeSetName}
                      placeholder={t("knowledge_sets.rename_placeholder")}
                      onChange={(e) => setKnowledgeSetName(e.target.value)}
                      disabled={activeSet.id === DEFAULT_KNOWLEDGE_SET_ID}
                    />
                    <Button
                      type="button"
                      onClick={handleRenameKnowledgeSet}
                      disabled={
                        activeSet.id === DEFAULT_KNOWLEDGE_SET_ID ||
                        !knowledgeSetName.trim()
                      }>
                      {t("knowledge_sets.rename_button")}
                    </Button>
                  </div>
                </SettingsFormField>

                <SettingsFormField
                  label={t("knowledge_sets.delete_label")}
                  description={t("knowledge_sets.delete_description")}>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={handleDeleteKnowledgeSet}
                    disabled={activeSet.id === DEFAULT_KNOWLEDGE_SET_ID}>
                    {t("knowledge_sets.delete_button")}
                  </Button>
                </SettingsFormField>

                <SettingsFormField
                  label={t("knowledge_sets.prompt_label")}
                  description={t("knowledge_sets.prompt_description")}>
                  <Textarea
                    value={knowledgePrompt}
                    onChange={handleKnowledgePromptChange}
                    className="min-h-[160px]"
                  />
                </SettingsFormField>

                <SettingsFormField
                  label={t("knowledge_sets.question_prompt_label")}
                  description={t("knowledge_sets.question_prompt_description")}>
                  <Textarea
                    value={knowledgeQuestionPrompt}
                    onChange={handleKnowledgeQuestionPromptChange}
                    className="min-h-[140px]"
                  />
                </SettingsFormField>

                <SettingsFormField
                  label={`${t("knowledge_sets.topk_label")} (${knowledgeTopK})`}
                  description={t("knowledge_sets.topk_description")}>
                  <Slider
                    value={[knowledgeTopK]}
                    min={1}
                    max={20}
                    step={1}
                    onValueChange={([val]) => {
                      setKnowledgeTopK(val)
                      updateKnowledgeRetrieval({ topK: val })
                    }}
                  />
                </SettingsFormField>

                <SettingsFormField
                  label={`${t("knowledge_sets.min_similarity_label")} (${knowledgeMinSimilarity.toFixed(2)})`}
                  description={t("knowledge_sets.min_similarity_description")}>
                  <Slider
                    value={[knowledgeMinSimilarity]}
                    min={0}
                    max={1}
                    step={0.05}
                    onValueChange={([val]) => {
                      setKnowledgeMinSimilarity(val)
                      updateKnowledgeRetrieval({ minSimilarity: val })
                    }}
                  />
                </SettingsFormField>
              </>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}
