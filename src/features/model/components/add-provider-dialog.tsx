import { useState } from "react"
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
import { Bot, Globe, Loader2, Server } from "@/lib/lucide-icon"
import { providerProfileRequiresApiKey } from "@/lib/providers/service-profile"
import {
  type CustomProviderWire,
  ProviderServiceProfile
} from "@/lib/providers/types"
import { cn } from "@/lib/utils"

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

const isRemoteUrl = (value: string): boolean => {
  try {
    const hostname = new URL(value).hostname
    return !["localhost", "127.0.0.1", "::1"].includes(hostname)
  } catch {
    return false
  }
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
  const [name, setName] = useState("")
  const [preset, setPreset] = useState<ProviderPreset>("openai")
  const [baseUrl, setBaseUrl] = useState(PRESET_CONFIG.openai.baseUrl)
  const [apiKey, setApiKey] = useState("")
  const [customModels, setCustomModels] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  const reset = () => {
    setName("")
    setPreset("openai")
    setBaseUrl(PRESET_CONFIG.openai.baseUrl)
    setApiKey("")
    setCustomModels([])
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
  const canSubmit =
    name.trim().length > 0 &&
    baseUrl.trim().length > 0 &&
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
              id="add-provider-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("settings.providers.add.name_placeholder")}
              autoFocus
            />
          </div>

          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">
              {t("settings.providers.add.wire_label")}
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {options.map((option) => {
                const Icon = option.icon
                const selected = preset === option.preset
                return (
                  <button
                    key={option.preset}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => handlePresetChange(option.preset)}
                    className={cn(
                      "rounded-control border p-3 text-left transition-colors",
                      selected
                        ? "border-primary bg-app-primary-soft"
                        : "border-border bg-card hover:bg-accent/30"
                    )}>
                    <Icon
                      className={cn(
                        "icon-md mb-2",
                        selected ? "text-app-primary" : "text-muted-foreground"
                      )}
                    />
                    <div className="text-sm font-medium">{option.label}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {option.description}
                    </div>
                  </button>
                )
              })}
            </div>
          </fieldset>

          <div className="grid gap-2">
            <Label htmlFor="add-provider-url">
              {t("settings.providers.base_url")}
            </Label>
            <Input
              id="add-provider-url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={PRESET_CONFIG[preset].baseUrl}
            />
            {isRemoteUrl(baseUrl) && (
              <p className="text-xs text-status-warning">
                {t("settings.providers.add.remote_notice")}
              </p>
            )}
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

        <DialogFooter>
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
