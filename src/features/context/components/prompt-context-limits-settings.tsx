import { useStorage } from "@plasmohq/storage/hook"
import {
  SettingsCard,
  SettingsFormField,
  SettingsSwitch
} from "@/components/settings"
import { Input } from "@/components/ui/input"
import {
  DEFAULT_MAX_RAG_CONTEXT_CHARS,
  DEFAULT_MAX_TAB_CONTEXT_CHARS,
  STORAGE_KEYS
} from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

const MIN_LIMIT = 2000
const MAX_LIMIT = 120000

const normalizeLimit = (value: number, fallback: number) => {
  if (!Number.isFinite(value)) return fallback
  return Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, Math.round(value)))
}

export const PromptContextLimitsSettings = () => {
  const [maxTabContextChars, setMaxTabContextChars] = useStorage<number>(
    {
      key: STORAGE_KEYS.CHAT.MAX_TAB_CONTEXT_CHARS,
      instance: plasmoGlobalStorage
    },
    DEFAULT_MAX_TAB_CONTEXT_CHARS
  )
  const [maxRagContextChars, setMaxRagContextChars] = useStorage<number>(
    {
      key: STORAGE_KEYS.CHAT.MAX_RAG_CONTEXT_CHARS,
      instance: plasmoGlobalStorage
    },
    DEFAULT_MAX_RAG_CONTEXT_CHARS
  )
  const [autoRefreshTabContext, setAutoRefreshTabContext] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.CHAT.AUTO_REFRESH_TAB_CONTEXT,
      instance: plasmoGlobalStorage
    },
    false
  )

  return (
    <SettingsCard
      title="Prompt Context Limits"
      description="Control how much tab and RAG context is injected into each request.">
      <div className="grid gap-4 sm:grid-cols-2">
        <SettingsFormField
          htmlFor="max-tab-context-chars"
          label="Max tab context chars">
          <Input
            id="max-tab-context-chars"
            type="number"
            min={MIN_LIMIT}
            max={MAX_LIMIT}
            step={500}
            value={maxTabContextChars}
            onChange={(e) => {
              const next = parseInt(e.target.value, 10)
              setMaxTabContextChars(
                normalizeLimit(next, DEFAULT_MAX_TAB_CONTEXT_CHARS)
              )
            }}
          />
        </SettingsFormField>

        <SettingsFormField
          htmlFor="max-rag-context-chars"
          label="Max RAG context chars">
          <Input
            id="max-rag-context-chars"
            type="number"
            min={MIN_LIMIT}
            max={MAX_LIMIT}
            step={500}
            value={maxRagContextChars}
            onChange={(e) => {
              const next = parseInt(e.target.value, 10)
              setMaxRagContextChars(
                normalizeLimit(next, DEFAULT_MAX_RAG_CONTEXT_CHARS)
              )
            }}
          />
        </SettingsFormField>
      </div>

      <SettingsSwitch
        id="auto-refresh-tab-context"
        className="mt-4"
        label="Auto-refresh selected tab context"
        description="When enabled, selected tabs are re-checked periodically for changes."
        checked={autoRefreshTabContext}
        onCheckedChange={setAutoRefreshTabContext}
      />
    </SettingsCard>
  )
}
