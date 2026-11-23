import type { ConnectorDraft } from "@ollama-client/contracts/connector-rpc"
import {
  Copy,
  Download,
  ExternalLink,
  FileInput,
  Loader2,
  Plug,
  Plus,
  Search,
  ShieldAlert,
  Trash2
} from "lucide-react"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { SecretKeyField } from "@/components/forms"
import { SettingsFormField, StatusAlert } from "@/components/settings"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import {
  type CatalogEntry,
  catalogEntryReady,
  MCP_CATALOG
} from "@/lib/connectors/catalog"
import { OLC_MCP_DEFAULT_PORT } from "@/lib/connectors/connector-types"
import {
  buildBridgeConfig,
  type LocalServerEntry,
  parseMcpConfig,
  remoteEntryToDraft
} from "@/lib/connectors/mcp-config"
import {
  MCP_REGISTRY_ORIGIN,
  type RegistryResult,
  searchMcpRegistry
} from "@/lib/connectors/registry-search"

export interface BridgePlan {
  entries: LocalServerEntry[]
  add: (entry: LocalServerEntry) => void
  remove: (name: string) => void
}

type SaveDraft = (draft: ConnectorDraft) => Promise<unknown>

/** Paste any README's `mcpServers` snippet. */
export const ImportConfigPanel = ({
  plan,
  onSaveRemote
}: {
  plan: BridgePlan
  onSaveRemote: SaveDraft
}) => {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [text, setText] = useState("")
  const [working, setWorking] = useState(false)
  const [notes, setNotes] = useState<string[]>([])

  const importConfig = async () => {
    const parsed = parseMcpConfig(text)
    if ("error" in parsed) {
      setNotes([t(`settings.connectors.import.errors.${parsed.error}`)])
      return
    }
    setWorking(true)
    const next: string[] = []
    try {
      for (const entry of parsed.local) plan.add(entry)
      for (const entry of parsed.remote) {
        const converted = remoteEntryToDraft(entry)
        if ("error" in converted) {
          next.push(
            t("settings.connectors.import.skipped", {
              name: entry.name,
              reason: t(`settings.connectors.import.reasons.${converted.error}`)
            })
          )
          continue
        }
        await onSaveRemote(converted.draft)
      }
      for (const skipped of parsed.skipped) {
        next.push(
          t("settings.connectors.import.skipped", {
            name: skipped.name,
            reason: t(`settings.connectors.import.reasons.${skipped.reason}`)
          })
        )
      }
      toast({
        title: t("settings.connectors.import.done", {
          local: parsed.local.length,
          remote: parsed.remote.length
        })
      })
      if (parsed.local.length + parsed.remote.length > 0) setText("")
    } finally {
      setNotes(next)
      setWorking(false)
    }
  }

  return (
    <div className="grid gap-3">
      <SettingsFormField
        htmlFor="connector-import-text"
        label={t("settings.connectors.import.label")}
        description={t("settings.connectors.import.description")}>
        <Textarea
          id="connector-import-text"
          className="min-h-40 font-mono text-xs"
          spellCheck={false}
          value={text}
          placeholder={
            '{\n  "mcpServers": {\n    "memory": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"] }\n  }\n}'
          }
          onChange={(event) => setText(event.target.value)}
        />
      </SettingsFormField>
      {notes.length > 0 && (
        <StatusAlert
          variant="warning"
          title={t("settings.connectors.import.notes_title")}
          description={
            <ul className="list-disc pl-4">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          }
        />
      )}
      <div className="flex justify-end">
        <Button
          type="button"
          onClick={importConfig}
          disabled={!text.trim() || working}>
          {working ? (
            <Loader2 className="icon-md animate-spin" />
          ) : (
            <FileInput className="icon-md" />
          )}
          {t("settings.connectors.import.button")}
        </Button>
      </div>
    </div>
  )
}

const CatalogItem = ({
  entry,
  plan
}: {
  entry: CatalogEntry
  plan: BridgePlan
}) => {
  const { t } = useTranslation()
  const [values, setValues] = useState<Record<string, string>>({})
  const added = plan.entries.some(
    (item) => item.name === entry.build(values).name
  )
  const ready = catalogEntryReady(entry, values)

  return (
    <div className="grid gap-2 rounded-control border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{entry.name}</span>
        <Badge variant="outline">{entry.runtime}</Badge>
        <a
          className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          href={entry.homepage}
          target="_blank"
          rel="noreferrer">
          {t("settings.connectors.catalog.docs")}
          <ExternalLink className="icon-xs" />
        </a>
      </div>
      <p className="text-sm text-muted-foreground">{t(entry.descriptionKey)}</p>
      {entry.params.map((param) => {
        const id = `connector-catalog-${entry.id}-${param.id}`
        return (
          <SettingsFormField
            key={param.id}
            htmlFor={id}
            label={t(param.labelKey)}>
            {param.secret ? (
              <SecretKeyField
                id={id}
                stored={false}
                value={values[param.id] ?? ""}
                placeholder={param.placeholder}
                onChange={(next) =>
                  setValues((current) => ({ ...current, [param.id]: next }))
                }
                onRemove={() =>
                  setValues((current) => ({ ...current, [param.id]: "" }))
                }
              />
            ) : (
              <Input
                id={id}
                value={values[param.id] ?? ""}
                placeholder={param.placeholder}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [param.id]: event.target.value
                  }))
                }
              />
            )}
          </SettingsFormField>
        )
      })}
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!ready}
          onClick={() => plan.add(entry.build(values))}>
          <Plus className="icon-sm" />
          {t(
            added
              ? "settings.connectors.catalog.update"
              : "settings.connectors.catalog.add"
          )}
        </Button>
      </div>
    </div>
  )
}

/** Popular local servers, added to the bridge config. */
export const CatalogPanel = ({ plan }: { plan: BridgePlan }) => {
  const { t } = useTranslation()
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        {t("settings.connectors.catalog.description")}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {MCP_CATALOG.map((entry) => (
          <CatalogItem key={entry.id} entry={entry} plan={plan} />
        ))}
      </div>
    </div>
  )
}

/** Opt-in search of the official MCP Registry. */
export const RegistryPanel = ({
  plan,
  onSaveRemote
}: {
  plan: BridgePlan
  onSaveRemote: SaveDraft
}) => {
  const { t } = useTranslation()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<RegistryResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [failed, setFailed] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const search = async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setSearching(true)
    setFailed(false)
    try {
      setResults(await searchMcpRegistry(query, controller.signal))
    } catch {
      if (!controller.signal.aborted) setFailed(true)
    } finally {
      if (!controller.signal.aborted) setSearching(false)
    }
  }

  const add = async (result: RegistryResult) => {
    if (result.install.kind === "local") plan.add(result.install.entry)
    if (result.install.kind === "remote") {
      const converted = remoteEntryToDraft(result.install.entry)
      if ("draft" in converted) {
        const needsToken = result.install.headers.some(
          (header) => header.required
        )
        await onSaveRemote({
          ...converted.draft,
          ...(needsToken ? { enabled: false } : {})
        })
      }
    }
  }

  return (
    <div className="grid gap-3">
      <StatusAlert
        variant="info"
        icon={ShieldAlert}
        title={t("settings.connectors.registry.privacy_title")}
        description={
          <span className="grid gap-1">
            <span>
              {t("settings.connectors.registry.privacy", {
                host: new URL(MCP_REGISTRY_ORIGIN).host
              })}
            </span>
            <span>{t("settings.connectors.registry.trust")}</span>
          </span>
        }
      />
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (query.trim()) void search()
        }}>
        <label className="sr-only" htmlFor="connector-registry-query">
          {t("settings.connectors.registry.label")}
        </label>
        <Input
          id="connector-registry-query"
          value={query}
          maxLength={100}
          placeholder={t("settings.connectors.registry.placeholder")}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button type="submit" disabled={!query.trim() || searching}>
          {searching ? (
            <Loader2 className="icon-md animate-spin" />
          ) : (
            <Search className="icon-md" />
          )}
          {t("settings.connectors.registry.search")}
        </Button>
      </form>
      {failed && (
        <StatusAlert
          variant="destructive"
          title={t("settings.connectors.registry.failed")}
        />
      )}
      {results?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t("settings.connectors.registry.empty")}
        </p>
      )}
      {results && results.length > 0 && (
        <div className="grid gap-2">
          {results.map((result) => (
            <div
              key={result.name}
              className="grid gap-1 rounded-control border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {result.title ?? result.name}
                </span>
                {result.version && (
                  <Badge variant="outline">{result.version}</Badge>
                )}
                <Badge variant="secondary">
                  {t(
                    `settings.connectors.registry.kind.${result.install.kind}`
                  )}
                </Badge>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  disabled={result.install.kind === "unsupported"}
                  onClick={() => void add(result)}>
                  <Plus className="icon-sm" />
                  {t("settings.connectors.registry.add")}
                </Button>
              </div>
              <span className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
                {result.name}
                {result.repository && (
                  <a
                    className="inline-flex items-center gap-1 font-sans hover:text-foreground"
                    href={result.repository}
                    target="_blank"
                    rel="noreferrer">
                    {t("settings.connectors.registry.repository")}
                    <ExternalLink className="icon-xs" />
                  </a>
                )}
              </span>
              {result.description && (
                <p className="line-clamp-2 text-sm text-muted-foreground">
                  {result.description}
                </p>
              )}
              {result.install.kind === "local" &&
                result.install.env.some((variable) => variable.required) && (
                  <p className="text-xs text-muted-foreground">
                    {t("settings.connectors.registry.needs_env", {
                      names: result.install.env
                        .filter((variable) => variable.required)
                        .map((variable) => variable.name)
                        .join(", ")
                    })}
                  </p>
                )}
              {result.install.kind === "remote" &&
                result.install.headers.some((header) => header.required) && (
                  <p className="text-xs text-muted-foreground">
                    {t("settings.connectors.registry.needs_token")}
                  </p>
                )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const downloadText = (text: string, fileName: string) => {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" })
  )
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

const BRIDGE_COMMAND = "olc mcp -c mcp.json"

/**
 * The local half: the servers picked so far as one `mcp.json`, how to run it,
 * and one form to connect the running bridge. Any bridge that speaks
 * Streamable HTTP works per server; `olc mcp` adds the token and the
 * single-connection sync.
 */
export const BridgePanel = ({
  plan,
  connecting,
  onConnect
}: {
  plan: BridgePlan
  connecting: boolean
  onConnect: (baseUrl: string, token?: string) => Promise<boolean | undefined>
}) => {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [baseUrl, setBaseUrl] = useState(
    `http://127.0.0.1:${OLC_MCP_DEFAULT_PORT}`
  )
  const [token, setToken] = useState("")
  const config = buildBridgeConfig(plan.entries)

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast({ title: t("settings.connectors.bridge.copied") })
    } catch {
      toast({
        variant: "destructive",
        title: t("settings.connectors.bridge.copy_failed")
      })
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <h4 className="text-sm font-medium">
          {t("settings.connectors.bridge.step_config")}
        </h4>
        {plan.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("settings.connectors.bridge.empty_plan")}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {plan.entries.map((entry) => (
                <span
                  key={entry.name}
                  className="inline-flex items-center gap-1 rounded-control border border-border px-2 py-0.5 text-xs">
                  {entry.name}
                  <TooltipActionButton
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    ariaLabel={t("settings.connectors.bridge.remove_entry", {
                      name: entry.name
                    })}
                    icon={Trash2}
                    onClick={() => plan.remove(entry.name)}
                  />
                </span>
              ))}
            </div>
            <pre className="max-h-64 overflow-auto rounded-control border border-border bg-surface-sunken p-3 font-mono text-xs">
              {config}
            </pre>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => downloadText(config, "mcp.json")}>
                <Download className="icon-sm" />
                {t("settings.connectors.bridge.download")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void copy(config)}>
                <Copy className="icon-sm" />
                {t("settings.connectors.bridge.copy_config")}
              </Button>
            </div>
          </>
        )}
      </div>

      <div className="grid gap-2">
        <h4 className="text-sm font-medium">
          {t("settings.connectors.bridge.step_run")}
        </h4>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-control border border-border bg-surface-sunken px-3 py-2 font-mono text-xs">
            {BRIDGE_COMMAND}
          </code>
          <TooltipActionButton
            type="button"
            variant="outline"
            size="icon"
            ariaLabel={t("settings.connectors.bridge.copy_command")}
            icon={Copy}
            onClick={() => void copy(BRIDGE_COMMAND)}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {t("settings.connectors.bridge.run_hint")}
        </p>
      </div>

      <div className="grid gap-2">
        <h4 className="text-sm font-medium">
          {t("settings.connectors.bridge.step_connect")}
        </h4>
        <div className="grid gap-3 md:grid-cols-2">
          <SettingsFormField
            htmlFor="connector-bridge-url"
            label={t("settings.connectors.bridge.url_label")}
            className="min-w-0">
            <Input
              id="connector-bridge-url"
              type="url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </SettingsFormField>
          <SettingsFormField
            htmlFor="connector-bridge-token"
            label={t("settings.connectors.fields.secret.label_local")}
            description={t("settings.connectors.bridge.token_hint")}
            className="min-w-0">
            <SecretKeyField
              id="connector-bridge-token"
              stored={false}
              value={token}
              onChange={setToken}
              onRemove={() => setToken("")}
            />
          </SettingsFormField>
        </div>
        <div className="flex justify-end">
          <Button
            type="button"
            disabled={!baseUrl.trim() || connecting}
            onClick={async () => {
              if (await onConnect(baseUrl.trim(), token.trim() || undefined)) {
                setToken("")
              }
            }}>
            {connecting ? (
              <Loader2 className="icon-md animate-spin" />
            ) : (
              <Plug className="icon-md" />
            )}
            {t("settings.connectors.bridge.connect")}
          </Button>
        </div>
      </div>
    </div>
  )
}
