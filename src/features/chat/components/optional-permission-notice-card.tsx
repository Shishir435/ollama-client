import { LockKeyhole, MousePointerClick, Settings } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import type { PermissionResumeResult } from "@/features/chat/lib/resume-permission-turn"
import { openOptionsInTab, runtime } from "@/lib/browser-api"
import type { PermissionNotice } from "@/types"

export const OptionalPermissionNoticeCard = ({
  notice,
  onEnable
}: {
  notice: PermissionNotice
  onEnable: (enable?: boolean) => Promise<PermissionResumeResult>
}) => {
  const { t } = useTranslation()
  const [enabling, setEnabling] = useState(false)
  const [failure, setFailure] = useState<
    "permission-denied" | "resume-failed" | null
  >(null)
  const feature = t(notice.labelKey)
  /**
   * The agent is an experimental setting, not a browser permission, and a
   * request can look like a browser task without being one — so its card also
   * offers to send the message as it was.
   */
  const agent = notice.capabilityId === "browserAgent"
  const Icon = agent ? MousePointerClick : LockKeyhole

  const enable = async (turnOn = true) => {
    setEnabling(true)
    setFailure(null)
    try {
      const result = await onEnable(turnOn)
      if (result !== "started") setFailure(result)
    } catch {
      setFailure("resume-failed")
    } finally {
      setEnabling(false)
    }
  }

  const manage = () => {
    void openOptionsInTab(
      runtime.getURL(
        `options.html?tab=${agent ? "agent" : "privacy"}&focus=${notice.focusId}`
      )
    )
  }

  return (
    <div
      role="status"
      className="mx-2 rounded-panel border border-app-primary/25 bg-app-primary-soft/35 p-3">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-control bg-surface-sunken text-app-primary">
          <Icon className="icon-sm" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            {agent
              ? t("chat.permissions.agent.title")
              : t("chat.permissions.disabled_notice", { feature })}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {agent
              ? t("chat.permissions.agent.description")
              : t("chat.permissions.enable_description")}
          </p>
          {failure && (
            <p className="mt-1 text-xs text-status-danger">
              {t(
                failure === "permission-denied"
                  ? "chat.permissions.not_granted"
                  : "chat.permissions.resume_failed"
              )}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button size="sm" onClick={() => void enable()} disabled={enabling}>
              {enabling
                ? t("chat.permissions.enabling")
                : agent
                  ? t("chat.permissions.agent.enable")
                  : t("chat.permissions.enable", { feature })}
            </Button>
            {agent && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void enable(false)}
                disabled={enabling}>
                {t("chat.permissions.agent.continue_without")}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={manage}>
              <Settings className="icon-xs" />
              {agent
                ? t("chat.permissions.agent.manage")
                : t("chat.permissions.manage")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
