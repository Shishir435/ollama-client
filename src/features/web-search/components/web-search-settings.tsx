import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  SettingsFormField,
  SettingsSliderField,
  SettingsSwitch,
  StatusAlert
} from "@/components/settings"
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
import { useToast } from "@/hooks/use-toast"
import { CheckCircle, Loader2, Search, TriangleAlert } from "@/lib/lucide-icon"
import {
  BRAVE_SEARCH_ENDPOINT,
  getWebSearchBackend,
  listWebSearchBackends,
  TAVILY_SEARCH_ENDPOINT,
  type WebSearchProviderConfig,
  type WebSearchProviderId,
  type WebSearchSafeSearch
} from "@/lib/tools/web-search"
import { useWebSearchConfig } from "../stores/web-search-config-store"

const TEST_QUERY = "web search test"

const providerFields: Record<
  WebSearchProviderId,
  Array<"endpoint" | "apiKey">
> = {
  searxng: ["endpoint"],
  brave: ["apiKey"],
  tavily: ["apiKey"]
}

const safeSearchValues: WebSearchSafeSearch[] = ["off", "moderate", "strict"]

const providerBaseUrls: Partial<Record<WebSearchProviderId, string>> = {
  brave: BRAVE_SEARCH_ENDPOINT,
  tavily: TAVILY_SEARCH_ENDPOINT
}

export const WebSearchSettings = () => {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { config, updateConfig } = useWebSearchConfig()
  const [isTesting, setIsTesting] = useState(false)
  const [testState, setTestState] = useState<"success" | "error" | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const backend = getWebSearchBackend(config.provider)
  const visibleFields = providerFields[config.provider] ?? []
  const providerBaseUrl = providerBaseUrls[config.provider]

  const update = (updates: Partial<WebSearchProviderConfig>) => {
    setTestState(null)
    updateConfig(updates)
  }

  const testSearch = async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const { signal } = controller

    setIsTesting(true)
    setTestState(null)
    try {
      const activeBackend = getWebSearchBackend(config.provider)
      if (!activeBackend) {
        setTestState("error")
        toast({
          title: t("settings.web_search.test.error"),
          variant: "destructive"
        })
        return
      }
      const validation = activeBackend.validateConfig(config)
      if (!validation.ok) {
        setTestState("error")
        toast({
          title: t(validation.errorKey ?? "settings.web_search.test.error"),
          variant: "destructive"
        })
        return
      }
      const results = await activeBackend.search(
        {
          query: TEST_QUERY,
          count: 1,
          safeSearch: config.safeSearch
        },
        config,
        signal
      )
      if (signal.aborted) return
      setTestState("success")
      toast({
        title: t("settings.web_search.test.success", {
          count: results.length
        })
      })
    } catch {
      if (signal.aborted) return
      setTestState("error")
      toast({
        title: t("settings.web_search.test.error"),
        variant: "destructive"
      })
    } finally {
      if (!signal.aborted) setIsTesting(false)
    }
  }

  return (
    <div className="space-y-4">
      <SettingsSwitch
        id="web-search-enabled"
        label={t("settings.web_search.enable.label")}
        description={t("settings.web_search.enable.description")}
        checked={!!config.enabled}
        onCheckedChange={(enabled) => update({ enabled })}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <SettingsFormField
          htmlFor="web-search-provider"
          label={t("settings.web_search.provider.label")}
          description={t("settings.web_search.provider.description")}
          className="min-w-0"
          data-settings-focus-id="web-search-provider">
          <Select
            value={config.provider}
            onValueChange={(provider) =>
              update({ provider: provider as WebSearchProviderId })
            }>
            <SelectTrigger id="web-search-provider" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {listWebSearchBackends().map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {t(item.labelKey)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </SettingsFormField>

        <SettingsFormField
          htmlFor="web-search-safe-search"
          label={t("settings.web_search.safe_search.label")}
          description={t("settings.web_search.safe_search.description")}
          className="min-w-0"
          data-settings-focus-id="web-search-safe-search">
          <Select
            value={config.safeSearch}
            onValueChange={(safeSearch) =>
              update({ safeSearch: safeSearch as WebSearchSafeSearch })
            }>
            <SelectTrigger id="web-search-safe-search" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {safeSearchValues.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`settings.web_search.safe_search.${value}`)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </SettingsFormField>
      </div>

      {visibleFields.includes("endpoint") && (
        <SettingsFormField
          htmlFor="web-search-endpoint"
          label={t("settings.web_search.endpoint.label")}
          description={t("settings.web_search.endpoint.description")}
          data-settings-focus-id="web-search-endpoint">
          <Input
            id="web-search-endpoint"
            type="url"
            value={config.endpoint ?? ""}
            placeholder="http://localhost:8080"
            onChange={(event) => update({ endpoint: event.target.value })}
          />
        </SettingsFormField>
      )}

      {providerBaseUrl && (
        <SettingsFormField
          label={t("settings.web_search.base_url.label")}
          description={t("settings.web_search.base_url.description")}>
          <div className="rounded-md border border-border bg-muted/20 px-3 py-2 font-mono text-xs text-muted-foreground">
            {providerBaseUrl}
          </div>
        </SettingsFormField>
      )}

      {visibleFields.includes("apiKey") && (
        <SettingsFormField
          htmlFor="web-search-api-key"
          label={t("settings.web_search.api_key.label")}
          description={t("settings.web_search.api_key.description")}
          data-settings-focus-id="web-search-api-key">
          <Input
            id="web-search-api-key"
            type="password"
            autoComplete="off"
            value={config.apiKey ?? ""}
            onChange={(event) => update({ apiKey: event.target.value })}
          />
        </SettingsFormField>
      )}

      {config.provider === "searxng" && (
        <SettingsSliderField
          label={t("settings.web_search.searxng_pages.label")}
          description={t("settings.web_search.searxng_pages.description")}
          value={config.searxngPages ?? 1}
          min={1}
          max={3}
          step={1}
          onValueChange={(searxngPages) => update({ searxngPages })}
          valueLabel={t("settings.web_search.searxng_pages.value", {
            count: config.searxngPages ?? 1
          })}
        />
      )}

      <SettingsSliderField
        label={t("settings.web_search.result_count.label")}
        description={t("settings.web_search.result_count.description")}
        value={config.count ?? 5}
        min={1}
        max={10}
        step={1}
        onValueChange={(count) => update({ count })}
        valueLabel={t("settings.web_search.result_count.value", {
          count: config.count ?? 5
        })}
      />

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={testSearch}
          disabled={isTesting || !backend}>
          {isTesting ? (
            <Loader2 className="icon-md animate-spin" />
          ) : (
            <Search className="icon-md" />
          )}
          {t("settings.web_search.test.button")}
        </Button>
      </div>

      {testState === "success" && (
        <StatusAlert
          variant="success"
          icon={CheckCircle}
          title={t("settings.web_search.test.success_title")}
        />
      )}
      {testState === "error" && (
        <StatusAlert
          variant="destructive"
          icon={TriangleAlert}
          title={t("settings.web_search.test.error_title")}
        />
      )}
    </div>
  )
}
