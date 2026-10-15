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
} from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { SectionStack } from "@/components/layout"
import {
  ConfirmActionDialog,
  SettingsCard,
  SettingsRow,
  StatusAlert
} from "@/components/settings"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useResetAppStorage } from "@/hooks/use-reset-app-storage"
import { readAndClearResetFailure } from "@/lib/app-reset"
import { getAllResetKeys } from "@/lib/get-all-reset-keys"

/** `APP_LIFECYCLE` → `App lifecycle`: a storage group key read as words. */
const humanizeModuleKey = (module: string): string => {
  const words = module.toLowerCase().replace(/_+/g, " ").trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export const ResetStorage = () => {
  const { t } = useTranslation()
  const reset = useResetAppStorage()
  const keysByModule = getAllResetKeys()
  const [open, setOpen] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [showFailureNotice, setShowFailureNotice] = useState(false)

  // A destructive reset runs in the background after a self-reload; if it
  // failed there, a one-shot record survives the restart. Surface it here.
  useEffect(() => {
    void readAndClearResetFailure().then((failure) => {
      if (failure) setShowFailureNotice(true)
    })
  }, [])

  const handleResetAll = async () => {
    if (isResetting) return
    setIsResetting(true)
    setShowFailureNotice(false)
    try {
      // Scheduling persists a flag and restarts the extension; the dialog
      // stays up with a spinner for the brief moment before the reload.
      const outcome = await reset("all")
      if (outcome.ok) {
        setOpen(false)
        return
      }
      // Scheduling itself failed; keep the dialog closed but show why the
      // data was not cleared instead of silently looking done.
      setOpen(false)
      setShowFailureNotice(true)
    } finally {
      setIsResetting(false)
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
        return humanizeModuleKey(module)
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
        {showFailureNotice && (
          <StatusAlert
            variant="destructive"
            icon={RefreshCcw}
            title={t("settings.reset.failure_notice.title")}
            description={t("settings.reset.failure_notice.description")}
          />
        )}
        <div className="divide-y divide-border">
          {Object.entries(keysByModule).map(([module, keys]) => (
            <ModuleResetItem
              key={module}
              module={module}
              keys={keys}
              getModuleIcon={getModuleIcon}
              getModuleName={getModuleName}
              getModuleDescription={getModuleDescription}
              reset={reset}
              onFailure={() => setShowFailureNotice(true)}
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
              <Button
                variant="destructive"
                className="w-full sm:w-auto"
                disabled={isResetting}
                onClick={() => setOpen(true)}>
                {isResetting && <Loader2 className="icon-md animate-spin" />}
                {t("settings.reset.danger_zone.button")}
              </Button>
            }
          />
        </div>
      </SettingsCard>
      <ConfirmActionDialog
        open={open}
        onOpenChange={(next) => {
          if (!isResetting) setOpen(next)
        }}
        title={t("settings.reset.dialog.title")}
        description={t("settings.reset.dialog.description")}
        confirmLabel={t("settings.reset.dialog.confirm")}
        cancelLabel={t("settings.reset.dialog.cancel")}
        destructive
        busy={isResetting}
        onConfirm={handleResetAll}
      />
    </SectionStack>
  )
}

const ModuleResetItem = ({
  module,
  keys,
  getModuleIcon,
  getModuleName,
  getModuleDescription,
  reset,
  onFailure
}: {
  module: string
  keys: string[]
  getModuleIcon: (module: string) => LucideIcon
  getModuleName: (module: string) => string
  getModuleDescription: (module: string) => string
  reset: (key: string) => Promise<{ ok: boolean }>
  onFailure: () => void
}) => {
  const { t } = useTranslation()
  const [resetState, setResetState] = useState<"idle" | "working" | "done">(
    "idle"
  )
  const [confirmOpen, setConfirmOpen] = useState(false)
  const isChatHistory = module === "CHAT_SESSIONS"
  const ModuleIcon = getModuleIcon(module)
  const focusId = `reset-${module.toLowerCase().replace(/_/g, "-")}`

  const handleReset = async () => {
    if (resetState !== "idle") return
    setConfirmOpen(false)
    setResetState("working")
    try {
      const outcome = await reset(module)
      if (!outcome.ok) {
        onFailure()
        setResetState("idle")
        return
      }
      setResetState("done")
      setTimeout(() => setResetState("idle"), 1500)
    } catch {
      onFailure()
      setResetState("idle")
    }
  }

  return (
    <>
      <SettingsRow
        focusId={focusId}
        leading={
          // oxlint-disable-next-line react/static-components -- The renderer is an existing component supplied by context or the icon registry, not created during render.
          <ModuleIcon className="icon-md shrink-0 text-muted-foreground" />
        }
        label={getModuleName(module)}
        meta={
          <Badge variant="secondary">
            {keys.length === 1
              ? t("settings.reset.item_count", { count: keys.length })
              : t("settings.reset.item_count_plural", { count: keys.length })}
          </Badge>
        }
        description={getModuleDescription(module)}
        control={
          <Button
            size="sm"
            variant="ghost"
            disabled={resetState !== "idle"}
            onClick={() => setConfirmOpen(true)}>
            {t("settings.reset.reset_button")}{" "}
            {resetState === "working" && (
              <Loader2 className="icon-md animate-spin" />
            )}
            {resetState === "done" && <CircleCheck className="icon-md" />}
          </Button>
        }
      />
      <ConfirmActionDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={
          isChatHistory
            ? t("settings.reset.chat_dialog.title")
            : t("settings.reset.module_dialog.title", {
                module: getModuleName(module)
              })
        }
        description={
          isChatHistory
            ? t("settings.reset.chat_dialog.description")
            : t("settings.reset.module_dialog.description")
        }
        confirmLabel={
          isChatHistory
            ? t("settings.reset.chat_dialog.confirm")
            : t("settings.reset.module_dialog.confirm")
        }
        destructive
        onConfirm={handleReset}
      />
    </>
  )
}
