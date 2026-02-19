import { Settings } from "lucide-react"
import { useTranslation } from "react-i18next"
import { SettingsCard, SettingsFormField } from "@/components/settings"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import type { EmbeddingConfig } from "@/lib/constants"

interface EmbeddingSearchConfigProps {
  config: EmbeddingConfig
  updateConfig: (updates: Partial<EmbeddingConfig>) => void
}

export const EmbeddingSearchConfig = ({
  config,
  updateConfig
}: EmbeddingSearchConfigProps) => {
  const { t } = useTranslation()

  return (
    <SettingsCard
      icon={Settings}
      title={t("model.embedding_config.search_settings_title")}
      description={t("model.embedding_config.search_settings_description")}>
      <div className="space-y-4">
        <SettingsFormField
          htmlFor="defaultSearchLimit"
          label={t("model.embedding_config.search_limit_label")}
          description={t("model.embedding_config.search_limit_description")}>
          <Input
            id="defaultSearchLimit"
            type="number"
            value={config.defaultSearchLimit}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10)
              if (!Number.isNaN(val) && val >= 1 && val <= 100) {
                updateConfig({
                  defaultSearchLimit: val
                })
              }
            }}
            min={1}
            max={100}
          />
        </SettingsFormField>

        <SettingsFormField
          label={t("model.embedding_config.min_similarity_label")}
          description={t("model.embedding_config.min_similarity_description")}>
          <div className="flex items-center gap-4">
            <Slider
              value={[config.defaultMinSimilarity]}
              onValueChange={([value]) =>
                updateConfig({ defaultMinSimilarity: value })
              }
              min={0}
              max={1}
              step={0.05}
              className="flex-1"
            />
            <Input
              id="defaultMinSimilarity"
              type="number"
              value={config.defaultMinSimilarity.toFixed(2)}
              onChange={(e) => {
                const val = parseFloat(e.target.value)
                if (!Number.isNaN(val) && val >= 0 && val <= 1) {
                  updateConfig({
                    defaultMinSimilarity: val
                  })
                }
              }}
              className="w-24"
              min={0}
              max={1}
              step={0.05}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0</span>
            <span>1</span>
          </div>
        </SettingsFormField>

        <SettingsFormField
          htmlFor="searchCacheTTL"
          label={t("model.embedding_config.cache_ttl_label")}
          description={t("model.embedding_config.cache_ttl_description")}
          className="pt-2 border-t">
          <Input
            id="searchCacheTTL"
            type="number"
            value={config.searchCacheTTL}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10)
              if (!Number.isNaN(val) && val >= 1 && val <= 60) {
                updateConfig({
                  searchCacheTTL: val
                })
              }
            }}
            min={1}
            max={60}
          />
        </SettingsFormField>

        <SettingsFormField
          htmlFor="searchCacheMaxSize"
          label={t("model.embedding_config.cache_max_size_label")}
          description={t("model.embedding_config.cache_max_size_description")}>
          <Input
            id="searchCacheMaxSize"
            type="number"
            value={config.searchCacheMaxSize}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10)
              if (!Number.isNaN(val) && val >= 10 && val <= 200) {
                updateConfig({
                  searchCacheMaxSize: val
                })
              }
            }}
            min={10}
            max={200}
          />
        </SettingsFormField>

        <SettingsFormField
          label={t("model.embedding_config.ann_backend_label")}
          description={t("model.embedding_config.ann_backend_description")}
          className="pt-2 border-t">
          <Select
            value={config.annBackend}
            onValueChange={(value) =>
              updateConfig({
                annBackend: value as EmbeddingConfig["annBackend"]
              })
            }>
            <SelectTrigger>
              <SelectValue
                placeholder={t("model.embedding_config.ann_backend_placeholder")}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>
                  {t("model.embedding_config.ann_backend_group")}
                </SelectLabel>
                <SelectItem value="wasm-hnsw">
                  {t("model.embedding_config.ann_backend_wasm")}
                </SelectItem>
                <SelectItem value="ts-hnsw">
                  {t("model.embedding_config.ann_backend_ts")}
                </SelectItem>
                <SelectItem value="bruteforce">
                  {t("model.embedding_config.ann_backend_bruteforce")}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </SettingsFormField>

        <SettingsFormField
          htmlFor="annMinVectors"
          label={t("model.embedding_config.ann_min_vectors_label")}
          description={t("model.embedding_config.ann_min_vectors_description")}>
          <Input
            id="annMinVectors"
            type="number"
            value={config.annMinVectors}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10)
              if (!Number.isNaN(val) && val >= 0) {
                updateConfig({
                  annMinVectors: val
                })
              }
            }}
            min={0}
          />
        </SettingsFormField>
      </div>
    </SettingsCard>
  )
}
