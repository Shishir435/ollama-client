import { useStorage } from "@plasmohq/storage/hook"
import { useTranslation } from "react-i18next"

import { SettingsSwitch } from "@/components/settings"
import { STORAGE_KEYS } from "@/lib/constants/keys"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

/**
 * Export privacy controls. Remote images in a print/PDF export fire network
 * requests to whatever servers appear in message content, so they are blocked
 * by default and replaced with an inert placeholder; this switch is the
 * explicit opt-in.
 */
export const ExportPrivacySettings = () => {
  const { t } = useTranslation()
  const [allowRemoteImages, setAllowRemoteImages] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.EXPORT.ALLOW_REMOTE_IMAGES,
      instance: plasmoGlobalStorage
    },
    false
  )

  return (
    <SettingsSwitch
      id="export-allow-remote-images"
      label={t("settings.export_privacy.remote_images_label")}
      description={t("settings.export_privacy.remote_images_hint")}
      checked={allowRemoteImages ?? false}
      onCheckedChange={(checked) => void setAllowRemoteImages(checked)}
    />
  )
}
