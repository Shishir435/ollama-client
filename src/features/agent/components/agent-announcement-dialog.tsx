import { Bot } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { getOnboardingState } from "@/lib/onboarding/state"
import { readSetting, writeSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"

/**
 * One-time notice that the experimental browser agent exists, shown to every
 * profile — new and upgraded — until it is closed.
 *
 * The agent is opt-in, so without this nobody learns it shipped. It waits for
 * onboarding to be finished or skipped, because two dialogs stacked on a first
 * run is how both get dismissed unread. Closing it by any route counts as
 * seen; turning the agent on from here also enables it.
 */
export const AgentAnnouncementDialog = () => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let active = true
    const load = async () => {
      const [dismissed, enabled, onboarding] = await Promise.all([
        readSetting(SETTINGS.AGENT_ANNOUNCEMENT_DISMISSED),
        readSetting(SETTINGS.AGENT_ENABLED),
        getOnboardingState()
      ])
      if (active && !dismissed && !enabled && onboarding.stage === "complete")
        setOpen(true)
    }
    void load().catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  const close = async (enable: boolean) => {
    setOpen(false)
    if (enable) await writeSetting(SETTINGS.AGENT_ENABLED, true)
    await writeSetting(SETTINGS.AGENT_ANNOUNCEMENT_DISMISSED, true)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) void close(false)
      }}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div className="flex size-9 items-center justify-center rounded-control bg-app-primary-soft text-app-agent">
              <Bot className="icon-md" />
            </div>
            <span className="rounded-chip border border-border-subtle px-1.5 text-micro text-muted-foreground">
              {t("agent.experimental_badge")}
            </span>
          </div>
          <DialogTitle>{t("agent.announcement.title")}</DialogTitle>
          <DialogDescription>
            {t("agent.announcement.description")}
          </DialogDescription>
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            <li>{t("agent.announcement.hosted_models")}</li>
            <li>{t("agent.announcement.approvals")}</li>
            <li>{t("agent.announcement.coming")}</li>
          </ul>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => void close(false)}>
            {t("agent.announcement.later")}
          </Button>
          <Button onClick={() => void close(true)}>
            {t("agent.announcement.enable")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
