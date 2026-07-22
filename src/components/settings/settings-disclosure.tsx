import { createContext, type ReactNode, useContext } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  getSettingsEntry,
  getSettingsEntryLevel,
  SETTINGS_LEVELS,
  type SettingsLevel,
  settingsLevelIncludes
} from "@/features/settings/settings-registry"
import { cn } from "@/lib/utils"

interface SettingsDisclosureContextValue {
  level: SettingsLevel
}

const SettingsDisclosureContext = createContext<SettingsDisclosureContextValue>(
  { level: "advanced" }
)

export const SettingsDisclosureProvider = ({
  level,
  children
}: {
  level: SettingsLevel
  children: ReactNode
}) => (
  <SettingsDisclosureContext.Provider value={{ level }}>
    {children}
  </SettingsDisclosureContext.Provider>
)

export const SettingsLevelGate = ({
  settingId,
  level,
  children
}: {
  settingId?: string
  level?: SettingsLevel
  children: ReactNode
}) => {
  const disclosure = useContext(SettingsDisclosureContext)
  const required =
    level ?? getSettingsEntryLevel(getSettingsEntry(settingId ?? ""))
  return settingsLevelIncludes(disclosure.level, required) ? children : null
}

export const SettingsDisclosureControl = ({
  level,
  onLevelChange,
  className
}: {
  level: SettingsLevel
  onLevelChange: (level: SettingsLevel) => void
  className?: string
}) => {
  const { t } = useTranslation()

  return (
    <div
      data-settings-focus="true"
      data-settings-focus-id="settings-disclosure-level"
      className={cn(
        "flex flex-col gap-2 rounded-panel border bg-card p-3 sm:flex-row sm:items-center sm:justify-between",
        className
      )}>
      <div>
        <p className="text-sm font-medium">{t("settings.disclosure.title")}</p>
        <p className="text-xs text-muted-foreground">
          {t("settings.disclosure.description")}
        </p>
      </div>
      <fieldset className="flex gap-1 rounded-control bg-muted p-1">
        <legend className="sr-only">{t("settings.disclosure.title")}</legend>
        {SETTINGS_LEVELS.map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={option === level ? "secondary" : "ghost"}
            aria-pressed={option === level}
            onClick={() => onLevelChange(option)}>
            {t(`settings.disclosure.levels.${option}`)}
          </Button>
        ))}
      </fieldset>
    </div>
  )
}
