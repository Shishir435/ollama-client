import type {
  ConnectorToolRisk,
  PublicConnector,
  PublicConnectorTool
} from "@ollama-client/contracts/connector-rpc"
import {
  ChevronDown,
  ChevronRight,
  Info,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2
} from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import {
  ConfirmActionDialog,
  SettingsSwitch,
  StatusAlert
} from "@/components/settings"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { getConnectorType } from "@/lib/connectors/connector-types"
import { useConnectors } from "../hooks/use-connectors"
import { ConnectorEditor } from "./connector-editor"

const RISKS: ConnectorToolRisk[] = ["low", "medium", "high", "critical"]
const SUGGESTED = "suggested"

type ConnectorActions = ReturnType<typeof useConnectors>

const ToolRow = ({
  connector,
  tool,
  busy,
  setTool
}: {
  connector: PublicConnector
  tool: PublicConnectorTool
  busy: boolean
  setTool: ConnectorActions["setTool"]
}) => {
  const { t } = useTranslation()
  const riskValue = tool.riskOverride ?? SUGGESTED
  const riskLabel = (value: string) =>
    value === SUGGESTED
      ? t("settings.connectors.tools.risk_suggested", {
          risk: t(`settings.connectors.tools.risk.${tool.suggestedRisk}`)
        })
      : t(`settings.connectors.tools.risk.${value}`)
  const selectId = `connector-${connector.id}-tool-${tool.name}-risk`

  return (
    <div className="grid gap-2 border-t border-border py-3 first:border-t-0 md:grid-cols-[1fr_auto] md:items-start">
      <SettingsSwitch
        id={`connector-${connector.id}-tool-${tool.name}`}
        label={
          <span className="flex flex-wrap items-center gap-2">
            <span>{tool.title ?? tool.name}</span>
            {tool.readOnly && (
              <Badge variant="outline">
                {t("settings.connectors.tools.read_only")}
              </Badge>
            )}
            {tool.destructive && (
              <Badge variant="destructive">
                {t("settings.connectors.tools.may_change_data")}
              </Badge>
            )}
          </span>
        }
        description={
          <span className="grid gap-1">
            {tool.description && (
              <span className="line-clamp-3">{tool.description}</span>
            )}
            {tool.modelName && (
              <span className="font-mono text-xs">{tool.modelName}</span>
            )}
          </span>
        }
        checked={tool.enabled}
        disabled={busy}
        onCheckedChange={(enabled) =>
          void setTool(connector.id, tool.name, { enabled })
        }
      />
      <label className="sr-only" htmlFor={selectId}>
        {t("settings.connectors.tools.risk_label")}
      </label>
      <Select
        value={riskValue}
        disabled={busy}
        onValueChange={(value) =>
          void setTool(connector.id, tool.name, {
            riskOverride:
              value === SUGGESTED ? null : (value as ConnectorToolRisk)
          })
        }>
        <SelectTrigger id={selectId} className="w-full md:w-52">
          <SelectValue>{() => riskLabel(riskValue)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {[SUGGESTED, ...RISKS].map((value) => (
              <SelectItem key={value} value={value}>
                <span className="flex flex-col items-start gap-0.5">
                  <span>{riskLabel(value)}</span>
                  <span className="text-xs text-muted-foreground">
                    {t(
                      `settings.connectors.tools.risk_hint.${value === SUGGESTED ? tool.suggestedRisk : value}`
                    )}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}

const ConnectorRow = ({
  connector,
  actions
}: {
  connector: PublicConnector
  actions: ConnectorActions
}) => {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const busy = actions.busy.has(connector.id)
  const enabledTools = connector.tools.filter((tool) => tool.enabled).length
  const statusOk = connector.status === "ok"

  if (editing) {
    return (
      <ConnectorEditor
        connector={connector}
        onCancel={() => setEditing(false)}
        onSave={async (draft) => {
          if (await actions.save(draft)) setEditing(false)
        }}
      />
    )
  }

  return (
    <div className="rounded-control border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <TooltipActionButton
          type="button"
          variant="ghost"
          size="icon"
          aria-expanded={expanded}
          ariaLabel={t(
            expanded
              ? "settings.connectors.actions.hide_tools"
              : "settings.connectors.actions.show_tools"
          )}
          icon={expanded ? ChevronDown : ChevronRight}
          onClick={() => setExpanded((current) => !current)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex flex-wrap items-center gap-2 font-medium">
            <span className="truncate">{connector.name}</span>
            <Badge variant="outline">
              {t(getConnectorType(connector.type).labelKey)}
            </Badge>
            <Badge variant={statusOk ? "secondary" : "destructive"}>
              {t(`settings.connectors.status_short.${connector.status}`)}
            </Badge>
          </span>
          <span className="truncate font-mono text-xs text-muted-foreground">
            {connector.url}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("settings.connectors.tools.count", {
              enabled: enabledTools,
              count: connector.tools.length
            })}
          </span>
        </div>
        <SettingsSwitch
          id={`connector-${connector.id}-enabled`}
          label={t("settings.connectors.fields.enabled.label")}
          checked={connector.enabled}
          disabled={busy}
          onCheckedChange={(enabled) =>
            void actions.save({
              id: connector.id,
              type: connector.type,
              name: connector.name,
              url: connector.url,
              enabled,
              auth: connector.auth,
              secret: { state: "unchanged" }
            })
          }
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void actions.refresh(connector.id)}>
          {busy ? (
            <Loader2 className="icon-sm animate-spin" />
          ) : (
            <RefreshCw className="icon-sm" />
          )}
          {t("settings.connectors.actions.refresh")}
        </Button>
        <TooltipActionButton
          type="button"
          variant="ghost"
          size="icon"
          ariaLabel={t("settings.connectors.actions.edit")}
          icon={Pencil}
          disabled={busy}
          onClick={() => setEditing(true)}
        />
        <TooltipActionButton
          type="button"
          variant="ghost"
          size="icon"
          ariaLabel={t("settings.connectors.actions.remove")}
          icon={Trash2}
          disabled={busy}
          onClick={() => setConfirmRemove(true)}
        />
      </div>

      {!statusOk && connector.status !== "unknown" && (
        <StatusAlert
          className="mt-3"
          variant="warning"
          title={t(`settings.connectors.status.${connector.status}`)}
        />
      )}

      {expanded && (
        <div className="mt-3 pl-2">
          {connector.tools.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("settings.connectors.tools.empty")}
            </p>
          ) : (
            connector.tools.map((tool) => (
              <ToolRow
                key={tool.name}
                connector={connector}
                tool={tool}
                busy={busy}
                setTool={actions.setTool}
              />
            ))
          )}
        </div>
      )}

      <ConfirmActionDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={t("settings.connectors.remove_dialog.title", {
          name: connector.name
        })}
        description={t("settings.connectors.remove_dialog.description")}
        confirmLabel={t("settings.connectors.actions.remove")}
        destructive
        onConfirm={async () => {
          await actions.remove(connector.id)
          setConfirmRemove(false)
        }}
      />
    </div>
  )
}

/**
 * Connectors card: MCP servers the chat model may call through. Every call
 * still passes the tool approval policy; the risk picker only chooses how
 * often to ask.
 */
export const ConnectorsSettings = () => {
  const { t } = useTranslation()
  const actions = useConnectors()
  const [adding, setAdding] = useState(false)

  return (
    <div className="space-y-4">
      <StatusAlert
        variant="info"
        icon={Info}
        title={t("settings.connectors.bridge_hint.title")}
        description={t("settings.connectors.bridge_hint.description")}
      />

      {actions.loading ? (
        <Loader2 className="icon-md animate-spin text-muted-foreground" />
      ) : (
        actions.connectors.length === 0 &&
        !adding && (
          <p className="text-sm text-muted-foreground">
            {t("settings.connectors.empty")}
          </p>
        )
      )}

      <div className="grid gap-3">
        {actions.connectors.map((connector) => (
          <ConnectorRow
            key={connector.id}
            connector={connector}
            actions={actions}
          />
        ))}
      </div>

      {adding ? (
        <ConnectorEditor
          onCancel={() => setAdding(false)}
          onSave={async (draft) => {
            if (await actions.save(draft)) setAdding(false)
          }}
        />
      ) : (
        <Button
          type="button"
          variant="outline"
          disabled={actions.loading}
          onClick={() => setAdding(true)}>
          <Plus className="icon-md" />
          {t("settings.connectors.actions.add")}
        </Button>
      )}
    </div>
  )
}
