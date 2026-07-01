import { useStorage } from "@plasmohq/storage/hook"
import { useTranslation } from "react-i18next"

import { SettingsCard, SettingsFormField } from "@/components/settings"
import { Input } from "@/components/ui/input"
import {
  DEFAULT_MAX_RESTORE_SESSIONS,
  MAX_MAX_RESTORE_SESSIONS,
  MIN_MAX_RESTORE_SESSIONS
} from "@/lib/constants/config"
import { STORAGE_KEYS } from "@/lib/constants/keys"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

const normalize = (value: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_MAX_RESTORE_SESSIONS
  return Math.max(
    MIN_MAX_RESTORE_SESSIONS,
    Math.min(MAX_MAX_RESTORE_SESSIONS, Math.round(value))
  )
}

/**
 * Configures how many tabs the `restore_session` tool may reopen in one call —
 * bounds how many tabs a single model action can spawn.
 */
export const RestoreSessionsLimitSettings = () => {
  const { t } = useTranslation()
  const [maxRestore, setMaxRestore] = useStorage<number>(
    {
      key: STORAGE_KEYS.BROWSER.MAX_RESTORE_SESSIONS,
      instance: plasmoGlobalStorage
    },
    DEFAULT_MAX_RESTORE_SESSIONS
  )

  return (
    <SettingsCard
      title={t("settings.restore_sessions.title")}
      description={t("settings.restore_sessions.description")}>
      <SettingsFormField
        htmlFor="max-restore-sessions"
        focusId="max-restore-sessions"
        label={t("settings.restore_sessions.max_label")}
        description={t("settings.restore_sessions.max_hint")}>
        <Input
          id="max-restore-sessions"
          type="number"
          min={MIN_MAX_RESTORE_SESSIONS}
          max={MAX_MAX_RESTORE_SESSIONS}
          step={1}
          value={maxRestore ?? DEFAULT_MAX_RESTORE_SESSIONS}
          onChange={(e) =>
            setMaxRestore(normalize(parseInt(e.target.value, 10)))
          }
        />
      </SettingsFormField>
    </SettingsCard>
  )
}
