import { Plus, RefreshCw, Server, X } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import {
  ListRow,
  ListRowDescription,
  ListRowTitle
} from "@/components/layout/list-row"
import { SettingsCard } from "@/components/settings"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useSetting } from "@/hooks/use-setting"
import { SETTINGS } from "@/lib/storage/settings"
import { McpClient } from "@/lib/tools/mcp/mcp-client"
import type { McpServer, McpTool, McpToolEntry } from "@/lib/tools/mcp/types"
import { McpServersSchema, mcpSlug } from "@/lib/tools/mcp/types"

type ServerStatus = "ok" | "error"

/** Merge live-discovered tools into a server's stored per-tool state. Existing
 * entries keep the user's toggle (and description); new ones default ON; tools
 * that are no longer on the server drop out. */
const mergeDiscovered = (
  stored: McpToolEntry[] | undefined,
  live: McpTool[]
): McpToolEntry[] => {
  const byName = new Map((stored ?? []).map((e) => [e.name, e]))
  return live.map((t) => {
    const existing = byName.get(t.name)
    if (existing) return { ...existing }
    return { name: t.name, description: t.description ?? "", enabled: true }
  })
}

export const McpServersCard = () => {
  const { t } = useTranslation()
  const [servers, setServers] = useSetting(SETTINGS.MCP_SERVERS)
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [status, setStatus] = useState<Record<string, ServerStatus>>({})
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({})

  // Discover a server's tools and fold them into the stored per-tool state.
  // A failed discovery keeps whatever was stored (never wipes user config).
  const discoverServer = useCallback(
    async (server: McpServer) => {
      setRefreshing((prev) => ({ ...prev, [server.id]: true }))
      setStatus((prev) => ({ ...prev, [server.id]: "error" }))
      try {
        const client = new McpClient(server, 15_000)
        await client.initialize()
        const liveTools = await client.listTools()
        setServers((prev) =>
          prev.map((s) =>
            s.id === server.id
              ? { ...s, tools: mergeDiscovered(s.tools, liveTools) }
              : s
          )
        )
        setStatus((prev) => ({ ...prev, [server.id]: "ok" }))
      } catch {
        // Unreachable or misconfigured endpoint; keep stored tools, show unreachable.
      } finally {
        setRefreshing((prev) => ({ ...prev, [server.id]: false }))
      }
    },
    [setServers]
  )

  const addServer = () => {
    const trimmedName = name.trim()
    const trimmedUrl = url.trim()
    if (!trimmedName || !trimmedUrl) return
    try {
      new URL(trimmedUrl)
    } catch {
      toast.error(t("settings.model.mcp.invalid_url"), { duration: 3000 })
      return
    }
    const server: McpServer = {
      id: `mcp-${mcpSlug(trimmedName)}-${Date.now()}`,
      name: trimmedName,
      url: trimmedUrl,
      enabled: true
    }
    const nextServers = [...servers, server]
    try {
      McpServersSchema.parse(nextServers)
    } catch {
      toast.error(t("settings.model.mcp.invalid_server"), { duration: 3000 })
      return
    }
    setServers(nextServers)
    setName("")
    setUrl("")
    // Populate the new server's tools immediately so they show under it.
    void discoverServer(server)
  }

  const removeServer = (id: string) => {
    setStatus((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setServers(servers.filter((s) => s.id !== id))
  }

  const toggleEnabled = (server: McpServer) => {
    setServers(
      servers.map((s) =>
        s.id === server.id ? { ...s, enabled: !s.enabled } : s
      )
    )
  }

  // Re-discover one server on demand. Existing toggles are preserved; only new
  // tools get added (default ON), and removed ones drop out.
  const refreshServer = useCallback(
    (serverId: string) => {
      const server = servers.find((s) => s.id === serverId)
      if (!server?.enabled) return
      void discoverServer(server)
    },
    [servers, discoverServer]
  )

  const toggleTool = (serverId: string, toolName: string) => {
    setServers(
      servers.map((s) =>
        s.id === serverId
          ? {
              ...s,
              tools: (s.tools ?? []).map((e) =>
                e.name === toolName ? { ...e, enabled: !e.enabled } : e
              )
            }
          : s
      )
    )
  }

  const removeTool = (serverId: string, toolName: string) => {
    setServers(
      servers.map((s) =>
        s.id === serverId
          ? { ...s, tools: (s.tools ?? []).filter((e) => e.name !== toolName) }
          : s
      )
    )
  }

  // First time the Models tab opens, populate any server that has no stored
  // tool list yet. After that, only an explicit refresh rescans.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once on mount to populate missing servers; reads initial state only, no re-run needed
  useEffect(() => {
    const missing = servers.filter((s) => !s.tools)
    if (missing.length === 0) return
    let cancelled = false
    Promise.all(
      missing.map(async (server) => {
        if (!cancelled) await discoverServer(server)
      })
    )
    return () => {
      cancelled = true
    }
  }, [])

  const statusLabel = (
    id: string
  ): { text: string; className: string } | null => {
    if (refreshing[id]) return null // spinner on the refresh button covers this
    if (!status[id] || !servers.find((s) => s.id === id)?.enabled) return null
    const ok = status[id] === "ok"
    return {
      text: ok
        ? t("settings.model.mcp.connected")
        : t("settings.model.mcp.unreachable"),
      className: ok ? "text-green-500" : "text-red-500"
    }
  }

  return (
    <SettingsCard
      focusId="mcp-servers"
      icon={Server}
      title={t("settings.model.mcp.title")}
      description={t("settings.model.mcp.description")}
      contentClassName="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Input
          id="mcp-name"
          placeholder={t("settings.model.mcp.name_placeholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1"
        />
        <Input
          id="mcp-url"
          placeholder={t("settings.model.mcp.url_placeholder")}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1"
        />
        <Button onClick={addServer}>
          <Plus className="icon-xs mr-0.5" />
          {t("settings.model.mcp.add_button")}
        </Button>
      </div>

      {servers.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("settings.model.mcp.empty")}
        </p>
      ) : (
        servers.map((server) => {
          const st = statusLabel(server.id)
          return (
            <ListRow
              key={server.id}
              trailingKind="control"
              leading={<Server className="icon-md text-muted-foreground" />}
              description={
                <ListRowDescription>{server.url}</ListRowDescription>
              }
              below={
                <div className="flex flex-col gap-1">
                  {st && (
                    <p className={`pl-4 text-xs ${st.className}`}>{st.text}</p>
                  )}
                  {server.tools && server.tools.length > 0 ? (
                    <div className="flex flex-col gap-1 pl-4">
                      {server.tools.map((tool) => (
                        <div
                          key={tool.name}
                          className="flex items-center justify-between py-1 text-sm">
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={tool.enabled}
                              onCheckedChange={() =>
                                toggleTool(server.id, tool.name)
                              }
                            />
                            <span className="text-muted-foreground">
                              {tool.name}
                            </span>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            title={t("settings.model.mcp.test")}
                            onClick={() => removeTool(server.id, tool.name)}>
                            <X className="icon-xs" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="pl-4 text-xs text-muted-foreground">
                      {t("settings.model.mcp.no_tools")}
                    </p>
                  )}
                </div>
              }
              trailing={
                <div className="flex items-center gap-1">
                  <Switch
                    checked={server.enabled}
                    onCheckedChange={() => toggleEnabled(server)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={refreshing[server.id]}
                    onClick={() => refreshServer(server.id)}
                    title={t("settings.model.mcp.test")}>
                    <RefreshCw
                      className={`icon-xs ${refreshing[server.id] ? "animate-spin" : ""}`}
                    />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeServer(server.id)}>
                    <X className="icon-xs" />
                  </Button>
                </div>
              }>
              <ListRowTitle>{server.name}</ListRowTitle>
            </ListRow>
          )
        })
      )}
    </SettingsCard>
  )
}
