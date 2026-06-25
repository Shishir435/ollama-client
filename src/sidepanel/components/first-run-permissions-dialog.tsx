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
import { openOptionsInTab, runtime } from "@/lib/browser-api"
import { STORAGE_KEYS } from "@/lib/constants"
import { Lock } from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

/**
 * One-time first-run intro shown on the side panel's first open. It tells the
 * user that the extension runs locally (data never leaves the device) and that
 * some features sit behind optional browser permissions which are off until
 * granted, with a deep link straight to the Permissions tab.
 *
 * Gated by a device-local "seen" flag (optional permissions are per browser
 * profile, so each device shows this once). Dismissing — via either button or
 * the close affordance — marks it seen so it never reappears.
 */
export const FirstRunPermissionsDialog = () => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let active = true
    plasmoGlobalStorage
      .get<boolean>(STORAGE_KEYS.ONBOARDING_PERMISSIONS_SEEN)
      .then((seen) => {
        if (active && !seen) setOpen(true)
      })
      .catch(() => {
        // If the flag can't be read we simply don't nag — fail closed.
      })
    return () => {
      active = false
    }
  }, [])

  const markSeen = () => {
    void plasmoGlobalStorage.set(STORAGE_KEYS.ONBOARDING_PERMISSIONS_SEEN, true)
  }

  const dismiss = () => {
    markSeen()
    setOpen(false)
  }

  const openPermissions = () => {
    markSeen()
    setOpen(false)
    void openOptionsInTab(runtime.getURL("options.html?tab=permissions"))
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss()
      }}>
      <DialogContent>
        <DialogHeader>
          <div className="flex size-9 items-center justify-center rounded-control bg-app-primary-soft text-app-agent">
            <Lock className="icon-md" />
          </div>
          <DialogTitle>{t("onboarding.permissions.title")}</DialogTitle>
          <DialogDescription>
            {t("onboarding.permissions.privacy")}
          </DialogDescription>
          <DialogDescription>
            {t("onboarding.permissions.body")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={dismiss}>
            {t("onboarding.permissions.dismiss")}
          </Button>
          <Button onClick={openPermissions}>
            {t("onboarding.permissions.open")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
