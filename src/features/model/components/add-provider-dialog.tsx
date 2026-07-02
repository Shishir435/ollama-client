import { Loader2 } from "lucide-react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import type { CustomProviderWire } from "@/lib/providers/types"

export interface AddProviderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Resolves true when the provider was persisted (dialog closes + resets). */
  onAdd: (input: {
    name: string
    baseUrl: string
    wire: CustomProviderWire
    apiKey?: string
  }) => Promise<boolean>
}

const DEFAULT_BASE_URL: Record<CustomProviderWire, string> = {
  openai: "http://localhost:8080/v1",
  ollama: "http://localhost:11434"
}

/**
 * Form for connecting a user-defined provider: any OpenAI-compatible server or
 * a second Ollama instance. Validation (URL shape, name) lives in
 * `ProviderManager.addCustomProvider`; this component only gates on non-empty
 * fields and surfaces the manager's errors via the parent's toast.
 */
export const AddProviderDialog = ({
  open,
  onOpenChange,
  onAdd
}: AddProviderDialogProps) => {
  const { t } = useTranslation()
  const [name, setName] = useState("")
  const [wire, setWire] = useState<CustomProviderWire>("openai")
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL.openai)
  const [apiKey, setApiKey] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const reset = () => {
    setName("")
    setWire("openai")
    setBaseUrl(DEFAULT_BASE_URL.openai)
    setApiKey("")
  }

  const handleWireChange = (next: CustomProviderWire) => {
    // Follow the wire's default URL unless the user already typed their own.
    if (!baseUrl.trim() || baseUrl === DEFAULT_BASE_URL[wire]) {
      setBaseUrl(DEFAULT_BASE_URL[next])
    }
    setWire(next)
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const added = await onAdd({
        name,
        baseUrl: baseUrl.trim(),
        wire,
        apiKey: apiKey.trim() || undefined
      })
      if (added) {
        reset()
        onOpenChange(false)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit = name.trim().length > 0 && baseUrl.trim().length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("settings.providers.add.title")}</DialogTitle>
          <DialogDescription>
            {t("settings.providers.add.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-provider-name">
              {t("settings.providers.add.name_label")}
            </Label>
            <Input
              id="add-provider-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("settings.providers.add.name_placeholder")}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-provider-wire">
              {t("settings.providers.add.wire_label")}
            </Label>
            <Select
              value={wire}
              onValueChange={(v) => handleWireChange(v as CustomProviderWire)}>
              <SelectTrigger id="add-provider-wire">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">
                  {t("settings.providers.add.wire_openai")}
                </SelectItem>
                <SelectItem value="ollama">
                  {t("settings.providers.add.wire_ollama")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-provider-url">
              {t("settings.providers.base_url")}
            </Label>
            <Input
              id="add-provider-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={DEFAULT_BASE_URL[wire]}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-provider-key">
              {t("settings.providers.add.api_key_label")}
            </Label>
            <Input
              id="add-provider-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || submitting}>
            {submitting && <Loader2 className="icon-md mr-2 animate-spin" />}
            {t("settings.providers.add.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
