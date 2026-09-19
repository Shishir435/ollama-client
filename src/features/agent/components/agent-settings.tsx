import { Bot } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  AGENT_CONTEXT_MAX_TOKENS,
  AGENT_CONTEXT_MIN_TOKENS
} from "@/application/agent/agent-context-window"
import {
  SettingsCard,
  SettingsFormField,
  SettingsLevelGate
} from "@/components/settings"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { useSetting } from "@/hooks/use-setting"
import { SETTINGS } from "@/lib/storage/settings"

const VISION_MODES = ["auto", "always", "never"] as const

/**
 * The two knobs a run's cost is actually made of.
 *
 * Both were literals in the decision path until now, and both are the kind of
 * thing only the person running it can answer: how much memory this machine
 * can spare for a window, and whether a model that can see should be shown
 * every step or only the ones that need it. `auto` is the default for each
 * and resolves from the model itself, so the controls exist for the cases
 * where the resolution is wrong rather than as a setup step.
 */
export const AgentSettings = () => {
  const { t } = useTranslation()
  const [contextWindow, setContextWindow] = useSetting(
    SETTINGS.AGENT_CONTEXT_WINDOW
  )
  const [vision, setVision] = useSetting(SETTINGS.AGENT_VISION)
  const isAuto = contextWindow === "auto" || contextWindow === undefined

  return (
    <SettingsCard
      icon={Bot}
      title={t("agent.settings.title")}
      description={t("agent.settings.description")}>
      <SettingsFormField
        focusId="agent-context-window"
        label={t("agent.settings.context_window.label")}
        description={t("agent.settings.context_window.description")}>
        <div className="grid gap-2 min-w-0">
          <Select
            value={isAuto ? "auto" : "custom"}
            onValueChange={(next) =>
              setContextWindow(next === "auto" ? "auto" : 32_768)
            }>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">
                {t("agent.settings.context_window.auto")}
              </SelectItem>
              <SelectItem value="custom">
                {t("agent.settings.context_window.custom")}
              </SelectItem>
            </SelectContent>
          </Select>
          {isAuto ? null : (
            <Input
              type="number"
              min={AGENT_CONTEXT_MIN_TOKENS}
              max={AGENT_CONTEXT_MAX_TOKENS}
              step={1_024}
              value={typeof contextWindow === "number" ? contextWindow : 32_768}
              onChange={(event) => {
                const next = Number(event.target.value)
                if (!Number.isFinite(next)) return
                setContextWindow(
                  Math.max(
                    AGENT_CONTEXT_MIN_TOKENS,
                    Math.min(AGENT_CONTEXT_MAX_TOKENS, Math.round(next))
                  )
                )
              }}
            />
          )}
        </div>
      </SettingsFormField>

      <SettingsLevelGate settingId="agent-vision">
        <SettingsFormField
          focusId="agent-vision"
          label={t("agent.settings.vision.label")}
          description={t("agent.settings.vision.description")}>
          <Select
            value={vision ?? "auto"}
            onValueChange={(next) =>
              setVision(next as (typeof VISION_MODES)[number])
            }>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VISION_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {t(`agent.settings.vision.${mode}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsFormField>
      </SettingsLevelGate>
    </SettingsCard>
  )
}
