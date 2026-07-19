import { useState } from "react"
import { useTranslation } from "react-i18next"

import { SectionStack } from "@/components/layout"
import { SettingsCard, StatusAlert } from "@/components/settings"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { useResetAppStorage } from "@/hooks/use-reset-app-storage"
import { getAllResetKeys } from "@/lib/get-all-reset-keys"
import {
  CircleCheck,
  Globe,
  Library,
  Loader2,
  type LucideIcon,
  MessageSquare,
  RefreshCcw,
  Settings,
  Shield,
  Volume2
} from "@/lib/lucide-icon"

export const ResetStorage = () => {
  const { t } = useTranslation()
  const reset = useResetAppStorage()
  const keysByModule = getAllResetKeys()
  const [open, setOpen] = useState(false)
  const [isResetting, setIsResetting] = useState(false)

  const handleResetAll = async () => {
    if (isResetting) return
    setIsResetting(true)
    try {
      // Deleting a large chat database takes seconds; the extension reloads
      // itself when this finishes, so the dialog stays up with a spinner.
      await reset("all")
    } finally {
      setIsResetting(false)
      setOpen(false)
    }
  }

  const getModuleIcon = (module: string): LucideIcon => {
    switch (module) {
      case "PROVIDER":
        return Library
      case "THEME":
        return Settings
      case "BROWSER":
        return Globe
      case "TTS":
        return Volume2
      case "CHAT_SESSIONS":
        return MessageSquare
      case "FEEDBACK":
        return Shield
      default:
        return Settings
    }
  }

  const getModuleName = (module: string) => {
    switch (module) {
      case "PROVIDER":
        return t("settings.reset.modules.provider.title")
      case "THEME":
        return t("settings.reset.modules.theme.title")
      case "BROWSER":
        return t("settings.reset.modules.browser.title")
      case "TTS":
        return t("settings.reset.modules.tts.title")
      case "CHAT_SESSIONS":
        return t("settings.reset.modules.chat_sessions.title")
      case "FEEDBACK":
        return t("settings.reset.modules.feedback.title")
      default:
        return module.replace("_", " ")
    }
  }

  const getModuleDescription = (module: string) => {
    switch (module) {
      case "PROVIDER":
        return t("settings.reset.modules.provider.description")
      case "THEME":
        return t("settings.reset.modules.theme.description")
      case "BROWSER":
        return t("settings.reset.modules.browser.description")
      case "TTS":
        return t("settings.reset.modules.tts.description")
      case "CHAT_SESSIONS":
        return t("settings.reset.modules.chat_sessions.description")
      case "FEEDBACK":
        return t("settings.reset.modules.feedback.description")
      default:
        return t("settings.reset.modules.default.description")
    }
  }

  return (
    <SectionStack>
      <SettingsCard
        icon={RefreshCcw}
        focusId="reset-settings"
        title={t("settings.reset.title")}
        description={t("settings.reset.description")}>
        <div className="grid gap-3">
          {Object.entries(keysByModule).map(([module, keys]) => (
            <ModuleResetItem
              key={module}
              module={module}
              keys={keys}
              getModuleIcon={getModuleIcon}
              getModuleName={getModuleName}
              getModuleDescription={getModuleDescription}
              reset={reset}
            />
          ))}
        </div>

        <Separator />

        <div
          data-settings-focus="true"
          data-settings-focus-id="reset-danger-zone">
          <StatusAlert
            variant="destructive"
            icon={RefreshCcw}
            title={t("settings.reset.danger_zone.title")}
            description={t("settings.reset.danger_zone.description")}
            actions={
              <Dialog
                open={open}
                onOpenChange={(next) => {
                  if (!isResetting) setOpen(next)
                }}>
                <DialogTrigger
                  render={
                    <Button
                      variant="destructive"
                      className="w-full sm:w-auto"
                    />
                  }>
                  {t("settings.reset.danger_zone.button")}
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>
                      {t("settings.reset.dialog.title")}
                    </DialogTitle>
                    <DialogDescription>
                      {t("settings.reset.dialog.description")}
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter className="flex flex-col gap-4">
                    <Button
                      variant="destructive"
                      disabled={isResetting}
                      onClick={handleResetAll}>
                      {isResetting && (
                        <Loader2 className="mr-2 icon-md animate-spin" />
                      )}
                      {t("settings.reset.dialog.confirm")}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={isResetting}
                      onClick={() => setOpen(false)}>
                      {t("settings.reset.dialog.cancel")}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            }
          />
        </div>
      </SettingsCard>
    </SectionStack>
  )
}

const ModuleResetItem = ({
  module,
  keys,
  getModuleIcon,
  getModuleName,
  getModuleDescription,
  reset
}: {
  module: string
  keys: string[]
  getModuleIcon: (module: string) => LucideIcon
  getModuleName: (module: string) => string
  getModuleDescription: (module: string) => string
  reset: (key: string) => Promise<string>
}) => {
  const { t } = useTranslation()
  const [resetState, setResetState] = useState<"idle" | "working" | "done">(
    "idle"
  )
  const ModuleIcon = getModuleIcon(module)
  const focusId = `reset-${module.toLowerCase().replace(/_/g, "-")}`

  const handleReset = async () => {
    if (resetState === "working") return
    setResetState("working")
    try {
      await reset(module)
      setResetState("done")
      setTimeout(() => setResetState("idle"), 1500)
    } catch {
      setResetState("idle")
    }
  }

  return (
    <Card
      data-settings-focus="true"
      data-settings-focus-id={focusId}
      className="flex-row items-center justify-between gap-3 bg-sidebar-accent ring-0 p-3 transition-colors hover:bg-accent/50">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <ModuleIcon className="icon-md shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium">{getModuleName(module)}</h4>
            <Badge variant="secondary" className="text-xs">
              {keys.length === 1
                ? t("settings.reset.item_count", { count: keys.length })
                : t("settings.reset.item_count_plural", { count: keys.length })}
            </Badge>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {getModuleDescription(module)}
          </p>
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        disabled={resetState === "working"}
        onClick={handleReset}>
        {t("settings.reset.reset_button")}{" "}
        {resetState === "working" && (
          <Loader2 className="icon-md animate-spin" />
        )}
        {resetState === "done" && <CircleCheck className="icon-md" />}
      </Button>
    </Card>
  )
}
