import { useEffect, useRef, useState } from "react"
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
import { Info, Loader2, Zap } from "@/lib/lucide-icon"
import type {
  ModelCapabilities,
  ModelCapabilityOverride
} from "@/lib/providers/capabilities"
import type { CapabilityProbeResult } from "@/lib/providers/capability-probe"
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
  /**
   * Run the one-shot tool-calling probe against the live provider. The parent
   * persists the result; the sheet's toggles refresh through the reactive
   * probe storage. Absent → no Detect button.
   */
  onProbe?: () => Promise<CapabilityProbeResult>
}

type Draft = Record<CapabilityFlag, boolean>

const toDraft = (caps: ModelCapabilities): Draft => ({
  text: caps.text,
  vision: caps.vision,
  toolCalling: caps.toolCalling,
  reasoning: caps.reasoning,
  embeddings: caps.embeddings
})

const CAPABILITY_FLAGS = [
  "text",
  "vision",
  "toolCalling",
  "reasoning",
  "embeddings"
] as const

const draftsEqual = (a: Draft, b: Draft): boolean =>
  CAPABILITY_FLAGS.every((flag) => a[flag] === b[flag])

/**
 * Right-side Sheet for correcting a model's detected capabilities. This is
 * useful both when a provider cannot report metadata and when self-reported
 * metadata is incomplete or inaccurate. Works unchanged in both the side panel
 * and the options page.
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
  onReset,
  onProbe
}: ModelCapabilitySheetProps) => {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [draft, setDraft] = useState<Draft>(() => toDraft(current))
  const [probing, setProbing] = useState(false)

  // The draft differs from what detection produced — the user has edited
  // something this session.
  const isDirty = (Object.keys(draft) as CapabilityFlag[]).some(
    (flag) => draft[flag] !== detected[flag]
  )

  // Snapshot of the value we last seeded into the draft, keyed by model. The
  // reseed guard compares against this — NOT against `detected` — so a toggle
  // the user sets back to its detected value isn't mistaken for "no edits" and
  // snapped back to the override (the bug where embeddings couldn't be turned
  // off once an override had turned it on).
  const seededRef = useRef<{ id: string; draft: Draft } | null>(null)
  const seedId = `${providerId}::${modelName}`

  // Seed when the sheet opens for a (possibly different) model, and reseed when
  // an external source updates `current` (e.g. a Chrome-sync write from another
  // device) — but only while the user hasn't edited away from the last seed, so
  // an external write never silently discards unsaved changes.
  useEffect(() => {
    if (!open) return
    const next = toDraft(current)
    const seeded = seededRef.current
    // New model (or first open): always seed.
    if (!seeded || seeded.id !== seedId) {
      seededRef.current = { id: seedId, draft: next }
      setDraft(next)
      return
    }
    // Same model, `current` changed externally: adopt it only if the user hasn't
    // edited and the value actually changed.
    if (draftsEqual(draft, seeded.draft) && !draftsEqual(next, seeded.draft)) {
      seededRef.current = { id: seedId, draft: next }
      setDraft(next)
    }
  }, [open, current, seedId, draft])

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

  const handleProbe = async () => {
    if (!onProbe) return
    setProbing(true)
    try {
      const result = await onProbe()
      // The persisted probe flows back through reactive storage and reseeds
      // the toggles (unless the user has unsaved edits) — only report here.
      const detected: string[] = []
      if (result.vision)
        detected.push(t("model.capabilities.flags.vision.label"))
      if (result.toolCalling)
        detected.push(t("model.capabilities.flags.toolCalling.label"))
      if (result.reasoning)
        detected.push(t("model.capabilities.flags.reasoning.label"))
      toast({
        description: detected.length
          ? t("model.capabilities.sheet.probe_detected", {
              capabilities: detected.join(", ")
            })
          : t("model.capabilities.sheet.probe_none_detected")
      })
    } catch (error) {
      logger.warn("Tool-calling probe failed", "ModelCapabilitySheet", {
        error
      })
      toast({
        variant: "destructive",
        description: t("model.capabilities.sheet.probe_failed")
      })
    } finally {
      setProbing(false)
    }
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

          {onProbe && (
            <div className="mb-2 flex items-center justify-between gap-3 rounded-control border border-border px-3 py-2.5">
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-medium text-foreground">
                  {t("model.capabilities.sheet.probe_title")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("model.capabilities.sheet.probe_description")}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleProbe}
                disabled={probing}>
                {probing ? (
                  <Loader2 className="icon-sm mr-2 animate-spin" />
                ) : (
                  <Zap className="icon-sm mr-2" />
                )}
                {t("model.capabilities.sheet.probe_button")}
              </Button>
            </div>
          )}

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
