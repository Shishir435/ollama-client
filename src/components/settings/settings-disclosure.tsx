import { createContext, type ReactNode, useContext } from "react"
import { useTranslation } from "react-i18next"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  countHiddenSettings,
  getSettingsEntry,
  getSettingsEntryLevel,
  SETTINGS_LEVELS,
  type SettingsLevel,
  settingsLevelIncludes
} from "@/features/settings/settings-registry"
import { cn } from "@/lib/class-names"

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
  const hidden = countHiddenSettings(level)

  return (
    <div
      data-settings-focus="true"
      data-settings-focus-id="settings-disclosure-level"
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-surface-sunken p-3 lg:flex-row lg:items-center lg:justify-between",
        className
      )}>
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium">{t("settings.disclosure.title")}</p>
        <p className="text-xs text-muted-foreground">
          {t("settings.disclosure.description")}
        </p>
        {hidden > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("settings.disclosure.hidden_count", { count: hidden })}{" "}
            <button
              type="button"
              className="rounded-control font-medium text-foreground underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-focus"
              onClick={() => onLevelChange("advanced")}>
              {t("settings.disclosure.show_all")}
            </button>
          </p>
        )}
      </div>
      <Tabs
        value={level}
        onValueChange={(value) => onLevelChange(value as SettingsLevel)}
        className="min-w-0 lg:max-w-sm">
        <TabsList
          aria-label={t("settings.disclosure.title")}
          className="h-auto w-full flex-wrap bg-background p-1">
          {SETTINGS_LEVELS.map((option) => (
            <TabsTrigger
              key={option}
              value={option}
              className="h-auto min-w-[6rem] whitespace-normal py-1 text-center">
              {t(`settings.disclosure.levels.${option}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  )
}
