import { Plus, RefreshCw, Server, X } from "lucide-react"
import { useCallback, useState } from "react"
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
import type { McpServer } from "@/lib/tools/mcp/types"
import { mcpSlug } from "@/lib/tools/mcp/types"

type ServerStatus = "ok" | "error"

/**
 * User-configured MCP servers (streamable-HTTP endpoints). Adding or removing
 * a server writes to `STORAGE_KEYS.MCP.SERVERS`; the background invalidates the
 * tool registry on that change, so the next chat turn picks up the new list.
 */
export const McpServersCard = () => {
  const { t } = useTranslation()
  const [servers, setServers] = useSetting(SETTINGS.MCP_SERVERS)
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [status, setStatus] = useState<Record<string, ServerStatus>>({})

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
    setServers([...servers, server])
    setName("")
    setUrl("")
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

  const testServer = useCallback(async (server: McpServer) => {
    setStatus((prev) => ({ ...prev, [server.id]: "error" }))
    try {
      await new McpClient(server, 15_000).initialize()
      setStatus((prev) => ({ ...prev, [server.id]: "ok" }))
    } catch {
      // Unreachable or misconfigured endpoint; the row shows it as unreachable.
    }
  }, [])

  return (
    <SettingsCard
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
        servers.map((server) => (
          <ListRow
            key={server.id}
            trailingKind="control"
            leading={<Server className="icon-md text-muted-foreground" />}
            description={<ListRowDescription>{server.url}</ListRowDescription>}
            below={
              <div className="flex w-full items-center justify-between">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={server.enabled}
                    onCheckedChange={() => toggleEnabled(server)}
                  />
                  {status[server.id] && (
                    <span
                      className={`text-2xs ${
                        status[server.id] === "ok"
                          ? "text-green-500"
                          : "text-red-500"
                      }`}>
                      {status[server.id] === "ok"
                        ? t("settings.model.mcp.connected")
                        : t("settings.model.mcp.unreachable")}
                    </span>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeServer(server.id)}>
                  <X className="icon-xs" />
                </Button>
              </div>
            }
            trailing={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title={t("settings.model.mcp.test")}
                onClick={() => testServer(server)}>
                <RefreshCw className="icon-xs" />
              </Button>
            }>
            <ListRowTitle>{server.name}</ListRowTitle>
          </ListRow>
        ))
      )}
    </SettingsCard>
  )
}
