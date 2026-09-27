import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { browser } from "@/lib/browser-api"
import { STORAGE_KEYS } from "@/lib/constants/keys"
import { getOnboardingState } from "@/lib/onboarding/state"
import { readSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"
import { useNativeEmbeddings } from "../hooks/use-native-embeddings"
import { NativeEmbeddingFields } from "./native-embedding-fields"

/** Existing profiles choose their embedding route after onboarding and the agent notice. */
export const NativeEmbeddingAnnouncementDialog = () => {
  const { t } = useTranslation()
  const native = useNativeEmbeddings()
  const [ready, setReady] = useState(false)
  const [closed, setClosed] = useState(false)

  useEffect(() => {
    let active = true
    let revision = 0
    const check = async () => {
      const current = ++revision
      const onboarding = await getOnboardingState()
      const agentPending =
        typeof __AGENT_PREVIEW_ENABLED__ !== "undefined" &&
        __AGENT_PREVIEW_ENABLED__
          ? !(await readSetting(SETTINGS.AGENT_ANNOUNCEMENT_DISMISSED)) &&
            !(await readSetting(SETTINGS.AGENT_ENABLED))
          : false
      if (active && current === revision)
        setReady(onboarding.stage === "complete" && !agentPending)
    }
    const onChanged = (changes: Record<string, unknown>) => {
      if (
        changes[STORAGE_KEYS.ONBOARDING.STATE] ||
        changes[SETTINGS.AGENT_ANNOUNCEMENT_DISMISSED.key] ||
        changes[SETTINGS.AGENT_ENABLED.key]
      ) {
        void check().catch(() => undefined)
      }
    }
    browser.storage.onChanged.addListener(onChanged)
    void check().catch(() => undefined)
    return () => {
      active = false
      browser.storage.onChanged.removeListener(onChanged)
    }
  }, [])

  const open =
    ready &&
    !closed &&
    !!native.state &&
    native.state.mode !== "bundled" &&
    !native.dismissed
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setClosed(true)
          void native.command("dismiss")
        }
      }}>
      <DialogContent
        className="max-h-[85dvh] overflow-y-auto"
        aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("settings.embeddings.bundled.title")}</DialogTitle>
        </DialogHeader>
        <NativeEmbeddingFields native={native} />
      </DialogContent>
    </Dialog>
  )
}
