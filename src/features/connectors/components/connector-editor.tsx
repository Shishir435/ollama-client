import type {
  ConnectorAuthKind,
  ConnectorDraft,
  ConnectorSecretDraft,
  ConnectorType,
  PublicConnector
} from "@ollama-client/contracts/connector-rpc"
import { ConnectorDraftSchema } from "@ollama-client/contracts/connector-rpc"
import { Loader2, Save } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { SecretKeyField } from "@/components/forms"
import { SettingsFormField } from "@/components/settings"
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
import {
  CONNECTOR_TYPES,
  getConnectorType
} from "@/lib/connectors/connector-types"

interface ConnectorEditorProps {
  /** Absent for a new connector. */
  connector?: PublicConnector
  onSave: (draft: ConnectorDraft) => Promise<unknown>
  onCancel: () => void
}

/**
 * Add or edit one connector. The credential is write-only: a stored one shows
 * as saved and is sent back only as an explicit replace or clear.
 */
export const ConnectorEditor = ({
  connector,
  onSave,
  onCancel
}: ConnectorEditorProps) => {
  const { t } = useTranslation()
  const idPrefix = connector ? `connector-${connector.id}` : "connector-new"
  const [type, setType] = useState<ConnectorType>(
    connector?.type ?? "mcp-local"
  )
  const [name, setName] = useState(connector?.name ?? "")
  const [url, setUrl] = useState(
    connector?.url ?? getConnectorType("mcp-local").defaultUrl
  )
  const [authKind, setAuthKind] = useState<ConnectorAuthKind>(
    connector?.auth.kind ?? getConnectorType("mcp-local").defaultAuth
  )
  const [headerName, setHeaderName] = useState(connector?.auth.headerName ?? "")
  const [secretValue, setSecretValue] = useState("")
  const [secretCleared, setSecretCleared] = useState(false)
  const [saving, setSaving] = useState(false)

  const definition = getConnectorType(type)

  const changeType = (next: ConnectorType) => {
    const nextDefinition = getConnectorType(next)
    setType(next)
    if (!connector) setUrl(nextDefinition.defaultUrl)
    if (!nextDefinition.authKinds.includes(authKind)) {
      setAuthKind(nextDefinition.defaultAuth)
    }
  }

  const secret: ConnectorSecretDraft = secretValue
    ? { state: "replaced", value: secretValue }
    : secretCleared
      ? { state: "cleared" }
      : { state: "unchanged" }

  const draft: ConnectorDraft = {
    ...(connector ? { id: connector.id } : {}),
    type,
    name: name.trim(),
    url: url.trim(),
    enabled: connector?.enabled ?? true,
    auth: {
      kind: authKind,
      ...(authKind === "header" ? { headerName: headerName.trim() } : {})
    },
    secret
  }
  const valid = ConnectorDraftSchema.safeParse(draft).success
  const urlValid = ConnectorDraftSchema.shape.url.safeParse(url.trim()).success

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!valid || saving) return
    setSaving(true)
    try {
      await onSave(draft)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="grid gap-4 rounded-control border border-border bg-surface-sunken p-4"
      onSubmit={submit}>
      <div className="grid gap-4 md:grid-cols-2">
        <SettingsFormField
          htmlFor={`${idPrefix}-type`}
          label={t("settings.connectors.fields.type.label")}
          description={t(definition.descriptionKey)}
          className="min-w-0">
          <Select
            value={type}
            onValueChange={(value) => changeType(value as ConnectorType)}>
            <SelectTrigger id={`${idPrefix}-type`} className="w-full">
              <SelectValue>{() => t(definition.labelKey)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {CONNECTOR_TYPES.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {t(item.labelKey)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </SettingsFormField>

        <SettingsFormField
          htmlFor={`${idPrefix}-name`}
          label={t("settings.connectors.fields.name.label")}
          description={t("settings.connectors.fields.name.description")}
          className="min-w-0">
          <Input
            id={`${idPrefix}-name`}
            value={name}
            maxLength={60}
            placeholder={t("settings.connectors.fields.name.placeholder")}
            onChange={(event) => setName(event.target.value)}
          />
        </SettingsFormField>
      </div>

      <SettingsFormField
        htmlFor={`${idPrefix}-url`}
        label={t("settings.connectors.fields.url.label")}
        description={t(
          type === "mcp-local"
            ? "settings.connectors.fields.url.description_local"
            : "settings.connectors.fields.url.description"
        )}>
        <Input
          id={`${idPrefix}-url`}
          type="url"
          value={url}
          aria-invalid={url.trim() !== "" && !urlValid}
          onChange={(event) => setUrl(event.target.value)}
        />
      </SettingsFormField>

      {definition.authKinds.length > 1 && (
        <div className="grid gap-4 md:grid-cols-2">
          <SettingsFormField
            htmlFor={`${idPrefix}-auth`}
            label={t("settings.connectors.fields.auth.label")}
            className="min-w-0">
            <Select
              value={authKind}
              onValueChange={(value) =>
                setAuthKind(value as ConnectorAuthKind)
              }>
              <SelectTrigger id={`${idPrefix}-auth`} className="w-full">
                <SelectValue>
                  {() => t(`settings.connectors.fields.auth.${authKind}`)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {definition.authKinds.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {t(`settings.connectors.fields.auth.${kind}`)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </SettingsFormField>

          {authKind === "header" && (
            <SettingsFormField
              htmlFor={`${idPrefix}-header`}
              label={t("settings.connectors.fields.header_name.label")}
              className="min-w-0">
              <Input
                id={`${idPrefix}-header`}
                value={headerName}
                placeholder="X-API-Key"
                onChange={(event) => setHeaderName(event.target.value)}
              />
            </SettingsFormField>
          )}
        </div>
      )}

      {authKind !== "none" && (
        <SettingsFormField
          htmlFor={`${idPrefix}-secret`}
          label={t(
            type === "mcp-local"
              ? "settings.connectors.fields.secret.label_local"
              : "settings.connectors.fields.secret.label"
          )}
          description={t(
            type === "mcp-local"
              ? "settings.connectors.fields.secret.description_local"
              : "settings.connectors.fields.secret.description"
          )}>
          <SecretKeyField
            id={`${idPrefix}-secret`}
            stored={Boolean(connector?.hasSecret) && !secretCleared}
            value={secretValue}
            onChange={(value) => {
              setSecretCleared(false)
              setSecretValue(value)
            }}
            onRemove={() => {
              setSecretValue("")
              setSecretCleared(true)
            }}
            removePending={secretCleared}
            onUndoRemove={() => setSecretCleared(false)}
            onCancelReplace={() => setSecretValue("")}
          />
        </SettingsFormField>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("settings.connectors.actions.cancel")}
        </Button>
        <Button type="submit" disabled={!valid || saving}>
          {saving ? (
            <Loader2 className="icon-md animate-spin" />
          ) : (
            <Save className="icon-md" />
          )}
          {t(
            connector
              ? "settings.connectors.actions.save"
              : "settings.connectors.actions.add_and_connect"
          )}
        </Button>
      </div>
    </form>
  )
}
