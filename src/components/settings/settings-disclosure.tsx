import { createContext, type ReactNode, useContext } from "react"
import { useTranslation } from "react-i18next"

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
        "flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between",
        className
      )}>
      <div className="space-y-1">
        <p className="text-sm font-medium">{t("settings.disclosure.title")}</p>
        <p className="text-xs text-muted-foreground">
          {t("settings.disclosure.description")}
        </p>
      </div>
      <Tabs
        value={level}
        onValueChange={(value) => onLevelChange(value as SettingsLevel)}
        className="w-full sm:w-auto">
        <TabsList
          aria-label={t("settings.disclosure.title")}
          className="grid h-10 w-full grid-cols-3 border bg-muted/50 p-1 shadow-inner sm:w-72">
          {SETTINGS_LEVELS.map((option) => (
            <TabsTrigger
              key={option}
              value={option}
              className="px-3 text-sm data-active:border-border/50 data-active:bg-primary data-active:text-primary-foreground data-active:shadow-sm dark:data-active:bg-primary dark:data-active:text-primary-foreground">
              {t(`settings.disclosure.levels.${option}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  )
}
