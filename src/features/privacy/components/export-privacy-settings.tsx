import { useTranslation } from "react-i18next"

import { SettingsSwitch } from "@/components/settings"
import { useSetting } from "@/hooks/use-setting"
import { SETTINGS } from "@/lib/storage/settings"

/**
 * Export privacy controls. Remote images in a print/PDF export fire network
 * requests to whatever servers appear in message content, so they are blocked
 * by default and replaced with an inert placeholder; this switch is the
 * explicit opt-in.
 */
export const ExportPrivacySettings = () => {
  const { t } = useTranslation()
  const [allowRemoteImages, setAllowRemoteImages] = useSetting(
    SETTINGS.EXPORT_ALLOW_REMOTE_IMAGES
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
