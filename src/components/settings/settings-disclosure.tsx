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
        "flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between lg:justify-start",
        className
      )}>
      <span className="shrink-0 whitespace-nowrap text-sm font-medium text-muted-foreground">
        {t("settings.disclosure.title")}
      </span>
      <Tabs
        value={level}
        onValueChange={(value) => onLevelChange(value as SettingsLevel)}
        className="min-w-0 w-full sm:w-auto sm:flex-none">
        <TabsList
          aria-label={t("settings.disclosure.title")}
          className="grid h-9 w-full grid-cols-3 border bg-muted/50 p-1 shadow-inner sm:min-w-72">
          {SETTINGS_LEVELS.map((option) => (
            <TabsTrigger
              key={option}
              value={option}
              className="px-3 text-sm data-active:border-border/50 data-active:bg-primary data-active:text-primary-foreground data-active:shadow-sm focus-visible:ring-2 focus-visible:outline-none dark:data-active:bg-primary dark:data-active:text-primary-foreground">
              {t(`settings.disclosure.levels.${option}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  )
}
