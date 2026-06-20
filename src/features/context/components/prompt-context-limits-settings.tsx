import { useStorage } from "@plasmohq/storage/hook"
import { useTranslation } from "react-i18next"
import { FormGrid } from "@/components/layout"
import {
  SectionResetButton,
  SettingsCard,
  SettingsFormField,
  SettingsSwitch
} from "@/components/settings"
import { Input } from "@/components/ui/input"
import {
  DEFAULT_AUTO_REFRESH_TAB_CONTEXT,
  DEFAULT_MAX_RAG_CONTEXT_CHARS,
  DEFAULT_MAX_TAB_CONTEXT_CHARS,
  DEFAULT_MAX_TOOL_RESULT_CHARS,
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
  const { t } = useTranslation()
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
  const [maxToolResultChars, setMaxToolResultChars] = useStorage<number>(
    {
      key: STORAGE_KEYS.CHAT.MAX_TOOL_RESULT_CHARS,
      instance: plasmoGlobalStorage
    },
    DEFAULT_MAX_TOOL_RESULT_CHARS
  )
  const [autoRefreshTabContext, setAutoRefreshTabContext] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.CHAT.AUTO_REFRESH_TAB_CONTEXT,
      instance: plasmoGlobalStorage
    },
    DEFAULT_AUTO_REFRESH_TAB_CONTEXT
  )

  return (
    <SettingsCard
      title={t("settings.prompt_context_limits.title")}
      description={t("settings.prompt_context_limits.description")}>
      <FormGrid>
        <SettingsFormField
          htmlFor="max-tab-context-chars"
          focusId="max-tab-context-chars"
          label={t("settings.prompt_context_limits.max_tab_context_chars")}>
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
          focusId="max-rag-context-chars"
          label={t("settings.prompt_context_limits.max_rag_context_chars")}>
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

        <div
          data-settings-focus="true"
          data-settings-focus-id="max-tool-result-chars"
          className="rounded-control">
          <SettingsFormField
            htmlFor="max-tool-result-chars"
            label={t("settings.prompt_context_limits.max_tool_result_chars")}
            description={t(
              "settings.prompt_context_limits.max_tool_result_chars_hint"
            )}>
            <Input
              id="max-tool-result-chars"
              type="number"
              min={MIN_LIMIT}
              max={MAX_LIMIT}
              step={500}
              value={maxToolResultChars}
              onChange={(e) => {
                const next = parseInt(e.target.value, 10)
                setMaxToolResultChars(
                  normalizeLimit(next, DEFAULT_MAX_TOOL_RESULT_CHARS)
                )
              }}
            />
          </SettingsFormField>
        </div>
      </FormGrid>

      <SettingsSwitch
        id="auto-refresh-tab-context"
        className="mt-4"
        label={t("settings.prompt_context_limits.auto_refresh_label")}
        description={t(
          "settings.prompt_context_limits.auto_refresh_description"
        )}
        checked={autoRefreshTabContext}
        onCheckedChange={setAutoRefreshTabContext}
      />

      <div className="mt-4 flex justify-end">
        <SectionResetButton sectionId="prompt-budget" />
      </div>
    </SettingsCard>
  )
}
