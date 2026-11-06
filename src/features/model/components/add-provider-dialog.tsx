import { RpcMethod } from "@ollama-client/contracts/rpc"
import {
  Bot,
  CheckCircle2,
  Globe,
  Loader2,
  Server,
  XCircle,
  Zap
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ModelIdListEditor } from "@/features/model/components/model-id-list-editor"
import { cn } from "@/lib/class-names"
import { getDisplayErrorMessage } from "@/lib/error-display"
import { isAppError } from "@/lib/error-utils"
import {
  classifyEndpointScope,
  suggestSchemeFor
} from "@/lib/providers/endpoint-scope"
import { providerProfileRequiresApiKey } from "@/lib/providers/service-profile"
import {
  type CustomProviderWire,
  makeCustomProviderId,
  ProviderServiceProfile,
  ProviderType
} from "@/lib/providers/types"
import { extensionRpcClient } from "@/protocol/extension-client"

export interface AddProviderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (input: {
    name: string
    baseUrl: string
    wire: CustomProviderWire
    apiKey?: string
    customModels?: string[]
    serviceProfile?: ProviderServiceProfile
  }) => Promise<boolean>
}

type ProviderPreset =
  | "openai"
  | "openai-api"
  | "ollama"
  | "anthropic"
  | "anthropic-compatible"
  | "openrouter"

const PRESET_CONFIG: Record<
  ProviderPreset,
  {
    wire: CustomProviderWire
    baseUrl: string
    serviceProfile?: ProviderServiceProfile
    defaultName?: string
  }
> = {
  openai: {
    wire: "openai",
    baseUrl: "http://localhost:8080/v1"
  },
  "openai-api": {
    wire: "openai",
    baseUrl: "https://api.openai.com/v1",
    serviceProfile: ProviderServiceProfile.OPENAI,
    defaultName: "OpenAI"
  },
  ollama: { wire: "ollama", baseUrl: "http://localhost:11434" },
  anthropic: {
    wire: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    serviceProfile: ProviderServiceProfile.ANTHROPIC,
    defaultName: "Anthropic"
  },
  "anthropic-compatible": {
    wire: "anthropic",
    baseUrl: "http://localhost:8080/v1"
  },
  openrouter: {
    wire: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    serviceProfile: ProviderServiceProfile.OPENROUTER,
    defaultName: "OpenRouter"
  }
}

type UrlProblem =
  | { kind: "scheme"; suggestion: string }
  | { kind: "invalid" }
  | { kind: "protocol" }

/** What is wrong with a typed base URL, or null when it is usable. */
const findUrlProblem = (value: string): UrlProblem | null => {
  const trimmed = value.trim()
  if (!trimmed) return null
  const suggestion = suggestSchemeFor(trimmed)
  if (suggestion) return { kind: "scheme", suggestion }
  try {
    const { protocol } = new URL(trimmed)
    return protocol === "http:" || protocol === "https:"
      ? null
      : { kind: "protocol" }
  } catch {
    return { kind: "invalid" }
  }
}

const WIRE_PROVIDER_TYPE: Record<CustomProviderWire, ProviderType> = {
  openai: ProviderType.OPENAI,
  ollama: ProviderType.OLLAMA,
  anthropic: ProviderType.ANTHROPIC
}

/**
 * Provider creation uses visible API-type cards, not a narrow select menu.
 * Manual model ids supplement discovery for endpoints that omit `/models`.
 */
export const AddProviderDialog = ({
  open,
  onOpenChange,
  onAdd
}: AddProviderDialogProps) => {
  const { t } = useTranslation()
  const nameInputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState("")
  const [preset, setPreset] = useState<ProviderPreset>("openai")
  const [baseUrl, setBaseUrl] = useState(PRESET_CONFIG.openai.baseUrl)
  const [apiKey, setApiKey] = useState("")
  const [customModels, setCustomModels] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [urlBlurred, setUrlBlurred] = useState(false)
  const [test, setTest] = useState<
    | { state: "idle" }
    | { state: "running" }
    | { state: "done"; success: boolean; message: string }
  >({ state: "idle" })
  const radioRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    if (open) nameInputRef.current?.focus()
  }, [open])

  const reset = () => {
    setName("")
    setPreset("openai")
    setBaseUrl(PRESET_CONFIG.openai.baseUrl)
    setApiKey("")
    setCustomModels([])
    setUrlBlurred(false)
    setTest({ state: "idle" })
  }

  const handlePresetChange = (next: ProviderPreset) => {
    const current = PRESET_CONFIG[preset]
    const selected = PRESET_CONFIG[next]
    if (!baseUrl.trim() || baseUrl === current.baseUrl) {
      setBaseUrl(selected.baseUrl)
    }
    if (!name.trim() || name === current.defaultName) {
      setName(selected.defaultName || "")
    }
    setPreset(next)
    setTest({ state: "idle" })
  }

  const handleRadioKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    const forward = ["ArrowRight", "ArrowDown"].includes(event.key)
    const backward = ["ArrowLeft", "ArrowUp"].includes(event.key)
    if (!forward && !backward) return
    event.preventDefault()
    const next = (index + (forward ? 1 : -1) + options.length) % options.length
    const target = options[next]
    if (!target) return
    handlePresetChange(target.preset)
    radioRefs.current[next]?.focus()
  }

  const handleTestConnection = async () => {
    setTest({ state: "running" })
    try {
      const wire = PRESET_CONFIG[preset].wire
      const result = await extensionRpcClient.call(
        RpcMethod.ProvidersTestConnection,
        {
          target: "draft",
          config: {
            id: makeCustomProviderId(wire),
            type: WIRE_PROVIDER_TYPE[wire],
            enabled: true,
            name: name.trim() || "Draft",
            baseUrl: baseUrl.trim(),
            customModels,
            ...(PRESET_CONFIG[preset].serviceProfile
              ? { serviceProfile: PRESET_CONFIG[preset].serviceProfile }
              : {}),
            apiKey: apiKey.trim()
              ? { state: "replaced", value: apiKey.trim() }
              : { state: "cleared" }
          }
        }
      )
      setTest({
        state: "done",
        success: true,
        message:
          result.modelCount > 0
            ? t("settings.providers.add.test_ok", { count: result.modelCount })
            : t("settings.providers.add.test_ok_no_models")
      })
    } catch (error) {
      setTest({
        state: "done",
        success: false,
        message:
          isAppError(error) && error.messageKey
            ? t(error.messageKey, error.messageParams)
            : getDisplayErrorMessage(
                error,
                t("settings.providers.add.test_failed")
              )
      })
    }
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const added = await onAdd({
        name,
        baseUrl: baseUrl.trim(),
        wire: PRESET_CONFIG[preset].wire,
        apiKey: apiKey.trim() || undefined,
        customModels,
        serviceProfile: PRESET_CONFIG[preset].serviceProfile
      })
      if (added) {
        handleOpenChange(false)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const apiKeyRequired = providerProfileRequiresApiKey(
    PRESET_CONFIG[preset].serviceProfile
  )
  const urlProblem = findUrlProblem(baseUrl)
  const endpointScope = baseUrl.trim() ? classifyEndpointScope(baseUrl) : null
  const canSubmit =
    name.trim().length > 0 &&
    baseUrl.trim().length > 0 &&
    urlProblem === null &&
    (!apiKeyRequired || apiKey.trim().length > 0)
  const options: Array<{
    preset: ProviderPreset
    icon: typeof Server
    label: string
    description: string
  }> = [
    {
      preset: "openai",
      icon: Server,
      label: t("settings.providers.add.wire_openai"),
      description: t("settings.providers.add.wire_openai_description")
    },
    {
      preset: "openai-api",
      icon: Globe,
      label: t("settings.providers.add.wire_openai_api"),
      description: t("settings.providers.add.wire_openai_api_description")
    },
    {
      preset: "ollama",
      icon: Bot,
      label: t("settings.providers.add.wire_ollama"),
      description: t("settings.providers.add.wire_ollama_description")
    },
    {
      preset: "anthropic",
      icon: Globe,
      label: t("settings.providers.add.wire_anthropic"),
      description: t("settings.providers.add.wire_anthropic_description")
    },
    {
      preset: "anthropic-compatible",
      icon: Server,
      label: t("settings.providers.add.wire_anthropic_compatible"),
      description: t(
        "settings.providers.add.wire_anthropic_compatible_description"
      )
    },
    {
      preset: "openrouter",
      icon: Globe,
      label: t("settings.providers.add.wire_openrouter"),
      description: t("settings.providers.add.wire_openrouter_description")
    }
  ]

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("settings.providers.add.title")}</DialogTitle>
          <DialogDescription>
            {t("settings.providers.add.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[65vh] gap-5 overflow-y-auto pr-1">
          <div className="grid gap-2">
            <Label htmlFor="add-provider-name">
              {t("settings.providers.add.name_label")}
            </Label>
            <Input
              ref={nameInputRef}
              id="add-provider-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("settings.providers.add.name_placeholder")}
            />
          </div>

          <div className="grid gap-2">
            <span id="add-provider-wire-label" className="text-sm font-medium">
              {t("settings.providers.add.wire_label")}
            </span>
            <div
              role="radiogroup"
              aria-labelledby="add-provider-wire-label"
              className="grid gap-2 sm:grid-cols-2">
              {options.map((option, index) => {
                const Icon = option.icon
                const selected = preset === option.preset
                return (
                  <button
                    key={option.preset}
                    ref={(node) => {
                      radioRefs.current[index] = node
                    }}
                    type="button"
                    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- card-style radio group with roving focus; a native radio cannot hold the icon and description
                    role="radio"
                    aria-checked={selected}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => handlePresetChange(option.preset)}
                    onKeyDown={(event) => handleRadioKeyDown(event, index)}
                    className={cn(
                      "min-w-0 rounded-control border p-3 text-left transition-colors",
                      selected
                        ? "border-primary bg-app-primary-soft"
                        : "border-stroke-control bg-card hover:bg-state-hover"
                    )}>
                    <Icon
                      className={cn(
                        "icon-md mb-2",
                        selected ? "text-app-primary" : "text-muted-foreground"
                      )}
                    />
                    <div className="text-sm font-medium wrap-anywhere">
                      {option.label}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground wrap-anywhere">
                      {option.description}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="add-provider-url">
              {t("settings.providers.base_url")}
            </Label>
            <Input
              id="add-provider-url"
              value={baseUrl}
              onChange={(event) => {
                setBaseUrl(event.target.value)
                setTest({ state: "idle" })
              }}
              onBlur={() => setUrlBlurred(true)}
              aria-invalid={urlBlurred && urlProblem !== null}
              aria-describedby="add-provider-url-note"
              placeholder={PRESET_CONFIG[preset].baseUrl}
            />
            <div id="add-provider-url-note" className="grid gap-1">
              {urlBlurred && urlProblem?.kind === "scheme" && (
                <p className="text-xs text-status-danger-text">
                  {t("settings.providers.add.url_scheme_missing")}{" "}
                  <button
                    type="button"
                    className="rounded-control font-medium underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    onClick={() => setBaseUrl(urlProblem.suggestion)}>
                    {t("settings.providers.add.url_use_suggestion", {
                      url: urlProblem.suggestion
                    })}
                  </button>
                </p>
              )}
              {urlBlurred && urlProblem?.kind === "invalid" && (
                <p className="text-xs text-status-danger-text">
                  {t("settings.providers.add.url_invalid")}
                </p>
              )}
              {urlBlurred && urlProblem?.kind === "protocol" && (
                <p className="text-xs text-status-danger-text">
                  {t("settings.providers.add.url_protocol")}
                </p>
              )}
              {endpointScope === "remote" && (
                <p className="text-xs text-status-warning-text">
                  {t("settings.providers.add.remote_notice")}
                </p>
              )}
              {endpointScope === "local-network" && (
                <p className="text-xs text-muted-foreground">
                  {t("settings.providers.add.local_network_notice")}
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="add-provider-key">
              {apiKeyRequired
                ? t("settings.providers.add.api_key_required_label")
                : t("settings.providers.add.api_key_label")}
            </Label>
            <Input
              id="add-provider-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={preset === "anthropic" ? "sk-ant-..." : "sk-..."}
            />
          </div>

          <div className="grid gap-2">
            <div>
              <Label>{t("settings.providers.models.title")}</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("settings.providers.models.description")}
              </p>
            </div>
            <ModelIdListEditor
              models={customModels}
              onChange={setCustomModels}
              addLabel={t("settings.providers.models.add")}
              removeLabel={t("settings.providers.models.remove")}
              placeholder={t("settings.providers.models.placeholder")}
            />
          </div>
        </div>

        {test.state === "done" && (
          <p
            role={test.success ? "status" : "alert"}
            className={cn(
              "flex items-start gap-2 text-sm",
              test.success
                ? "text-status-success-text"
                : "text-status-danger-text"
            )}>
            {test.success ? (
              <CheckCircle2 className="icon-md mt-0.5 shrink-0" />
            ) : (
              <XCircle className="icon-md mt-0.5 shrink-0" />
            )}
            <span>{test.message}</span>
          </p>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleTestConnection}
            disabled={!canSubmit || submitting || test.state === "running"}
            className="sm:mr-auto">
            {test.state === "running" ? (
              <Loader2 className="icon-md animate-spin" />
            ) : (
              <Zap className="icon-md" />
            )}
            {t("settings.providers.add.test")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || submitting}>
            {submitting && <Loader2 className="icon-md animate-spin" />}
            {t("settings.providers.add.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
