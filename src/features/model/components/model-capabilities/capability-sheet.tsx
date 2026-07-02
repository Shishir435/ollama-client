import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { logger } from "@/lib/logger"
import { Info } from "@/lib/lucide-icon"
import type {
  ModelCapabilities,
  ModelCapabilityOverride
} from "@/lib/providers/capabilities"
import { getProviderDisplayName } from "@/lib/providers/registry"

import { CAPABILITY_META, type CapabilityFlag } from "./capability-meta"

interface ModelCapabilitySheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  providerId: string
  /** Stored config name — used for custom providers, which have no static meta. */
  providerDisplayName?: string
  modelName: string
  /**
   * Effective capabilities (detection with any saved override applied). Seeds
   * the toggles so they match what's actually in effect / shown in the menu.
   */
  current: ModelCapabilities
  /** Capabilities from detection only (pre-override) — the "reset" target. */
  detected: ModelCapabilities
  /** Whether the provider can report capabilities on its own (Ollama). */
  canSelfReport: boolean
  /** Whether a saved override already exists for this model. */
  hasOverride: boolean
  onSave: (override: ModelCapabilityOverride) => void | Promise<void>
  onReset: () => void | Promise<void>
}

type Draft = Record<CapabilityFlag, boolean>

const toDraft = (caps: ModelCapabilities): Draft => ({
  text: caps.text,
  vision: caps.vision,
  toolCalling: caps.toolCalling,
  reasoning: caps.reasoning,
  embeddings: caps.embeddings
})

/**
 * Right-side Sheet for declaring a model's capabilities by hand. Surfaced for
 * models whose provider cannot report capabilities (vLLM, LocalAI, KoboldCpp,
 * llama.cpp) so features such as image input and tool calling gate correctly.
 * Works unchanged in both the side panel and the options page.
 */
export const ModelCapabilitySheet = ({
  open,
  onOpenChange,
  providerId,
  providerDisplayName,
  modelName,
  current,
  detected,
  canSelfReport,
  hasOverride,
  onSave,
  onReset
}: ModelCapabilitySheetProps) => {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [draft, setDraft] = useState<Draft>(() => toDraft(current))

  // The draft differs from what detection produced — the user has edited
  // something this session.
  const isDirty = (Object.keys(draft) as CapabilityFlag[]).some(
    (flag) => draft[flag] !== detected[flag]
  )

  // Reseed when the sheet opens for a (possibly different) model, OR when an
  // external source updates `current` (e.g. a Chrome-sync write from another
  // device) — but only while the user hasn't edited the draft, so an external
  // write never silently discards unsaved changes.
  useEffect(() => {
    if (open && !isDirty) setDraft(toDraft(current))
  }, [open, current, isDirty])

  const providerName = getProviderDisplayName(providerId, providerDisplayName)

  // Reset is meaningful when there is a saved override to clear, or when the
  // user has edited the toggles in this open session.
  const canReset = hasOverride || isDirty

  const handleSave = async () => {
    try {
      await onSave({ ...draft })
      onOpenChange(false)
    } catch (error) {
      // Keep the sheet open so the user can retry; surface the failure.
      logger.error(
        "Failed to save capability override",
        "ModelCapabilitySheet",
        { error }
      )
      toast({
        variant: "destructive",
        description: t("model.capabilities.sheet.save_error")
      })
    }
  }

  const handleReset = async () => {
    // Drop any saved override and snap the toggles back to detection.
    if (hasOverride) await onReset()
    setDraft(toDraft(detected))
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 sm:max-w-md"
        aria-describedby={undefined}>
        <SheetHeader className="gap-2 border-b">
          <SheetTitle>{t("model.capabilities.sheet.title")}</SheetTitle>
          <SheetDescription>
            {t("model.capabilities.sheet.subtitle", {
              model: modelName,
              provider: providerName
            })}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-4 scrollbar-none">
          <div className="mb-2 flex items-start gap-2 rounded-control border border-status-info/30 bg-status-info/10 px-3 py-2 text-xs/relaxed text-muted-foreground">
            <Info className="icon-sm mt-0.5 shrink-0 text-status-info" />
            <span>
              {canSelfReport
                ? t("model.capabilities.sheet.note_self_report", {
                    provider: providerName
                  })
                : t("model.capabilities.sheet.note_manual", {
                    provider: providerName
                  })}
            </span>
          </div>

          {CAPABILITY_META.map(({ flag, icon: Icon, labelKey, descKey }) => {
            const switchId = `capability-${flag}`
            return (
              <label
                key={flag}
                htmlFor={switchId}
                className="flex cursor-pointer items-center gap-3 rounded-control px-2 py-2.5 transition-colors hover:bg-accent/50">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-control bg-muted/50">
                  <Icon className="icon-sm text-muted-foreground" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium text-foreground">
                    {t(labelKey)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t(descKey)}
                  </span>
                </div>
                <Switch
                  id={switchId}
                  checked={draft[flag]}
                  onCheckedChange={(checked) =>
                    setDraft((prev) => ({ ...prev, [flag]: checked }))
                  }
                />
              </label>
            )
          })}
        </div>

        <SheetFooter className="flex-row justify-between gap-2 border-t">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={!canReset}>
            {t("model.capabilities.sheet.reset")}
          </Button>
          <Button size="sm" onClick={handleSave}>
            {t("model.capabilities.sheet.save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
