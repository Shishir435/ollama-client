import { Bot } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  AGENT_CONTEXT_MAX_TOKENS,
  AGENT_CONTEXT_MIN_TOKENS
} from "@/application/agent/agent-context-window"
import {
  SettingsCard,
  SettingsFormField,
  SettingsLevelGate,
  SettingsSwitch
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
const PERMISSION_MODES = ["allow_routine", "approve_each"] as const

/**
 * What a run may do unasked, and the two knobs its cost is made of.
 *
 * The permission mode is read once per start and minted into that run's own
 * grants, so changing it never widens a run already going, and no choice here
 * covers a submission, a deletion, a sign-in or a payment.
 *
 * Both were literals in the decision path until now, and both are the kind of
 * thing only the person running it can answer: how much memory this machine
 * can spare for a window, and whether a model that can see should be shown
 * every step or only the ones that need it. `auto` is the default for each
 * and resolves from the model itself, so the controls exist for the cases
 * where the resolution is wrong rather than as a setup step.
 *
 * The whole agent is behind an opt-in, off by default, because nothing yet
 * measures it across models. The other controls stay mounted while it is
 * off, so a settings search that lands on one still finds it.
 */
export const AgentSettings = () => {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useSetting(SETTINGS.AGENT_ENABLED)
  const [contextWindow, setContextWindow] = useSetting(
    SETTINGS.AGENT_CONTEXT_WINDOW
  )
  const [vision, setVision] = useSetting(SETTINGS.AGENT_VISION)
  const [permissionMode, setPermissionMode] = useSetting(
    SETTINGS.AGENT_PERMISSION_MODE
  )
  const isAuto = contextWindow === "auto" || contextWindow === undefined

  return (
    <SettingsCard
      icon={Bot}
      title={t("agent.settings.title")}
      description={t("agent.settings.description")}
      badge={t("agent.experimental_badge")}>
      <SettingsSwitch
        id="agent-enabled"
        label={t("agent.settings.enabled.label")}
        description={t("agent.settings.enabled.description")}
        checked={enabled === true}
        onCheckedChange={setEnabled}
      />

      <SettingsFormField
        focusId="agent-permission-mode"
        label={t("agent.settings.permission_mode.label")}
        description={t("agent.settings.permission_mode.description")}>
        <Select
          value={permissionMode ?? "allow_routine"}
          onValueChange={(next) =>
            setPermissionMode(next as (typeof PERMISSION_MODES)[number])
          }>
          <SelectTrigger>
            <SelectValue>
              {() =>
                t(
                  `agent.settings.permission_mode.${permissionMode ?? "allow_routine"}`
                )
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {PERMISSION_MODES.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {t(`agent.settings.permission_mode.${mode}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsFormField>

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
              <SelectValue>
                {() =>
                  t(
                    isAuto
                      ? "agent.settings.context_window.auto"
                      : "agent.settings.context_window.custom"
                  )
                }
              </SelectValue>
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
              <SelectValue>
                {() => t(`agent.settings.vision.${vision ?? "auto"}`)}
              </SelectValue>
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
