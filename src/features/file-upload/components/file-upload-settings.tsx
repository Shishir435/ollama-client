import type { ChangeEvent } from "react"
import { useTranslation } from "react-i18next"
import { FieldStack } from "@/components/layout"
import { SettingsFormField } from "@/components/settings"
import { Input } from "@/components/ui/input"
import { useSetting } from "@/hooks/use-setting"
import {
  DEFAULT_FILE_UPLOAD_CONFIG,
  DEFAULT_MAX_IMAGE_SIZE_MB
} from "@/lib/constants"
import { SETTINGS } from "@/lib/storage/settings"

export const FileUploadSettings = () => {
  const { t } = useTranslation()
  const [config, setConfig] = useSetting(SETTINGS.FILE_UPLOAD_CONFIG)

  const [maxImageSizeMb, setMaxImageSizeMb] = useSetting(
    SETTINGS.MAX_IMAGE_SIZE_MB
  )

  const handleMaxSizeChange = (e: ChangeEvent<HTMLInputElement>) => {
    const mb = Number.parseFloat(e.target.value)
    if (!Number.isNaN(mb) && mb > 0) {
      setConfig((prev) => ({
        ...(prev ?? DEFAULT_FILE_UPLOAD_CONFIG),
        maxFileSize: mb * 1024 * 1024
      }))
    }
  }

  const handleMaxImageSizeChange = (e: ChangeEvent<HTMLInputElement>) => {
    const mb = Number.parseFloat(e.target.value)
    if (!Number.isNaN(mb) && mb > 0) {
      setMaxImageSizeMb(mb)
    }
  }

  const currentSizeMB = config?.maxFileSize
    ? (config.maxFileSize / (1024 * 1024)).toFixed(0)
    : "10"

  return (
    <FieldStack>
      <FieldStack>
        <SettingsFormField
          htmlFor="max-file-size"
          focusId="max-file-size-mb"
          label={t("file_upload.settings.max_file_size_label")}
          description={t("file_upload.settings.max_file_size_description")}>
          <div className="flex items-center gap-2">
            <Input
              id="max-file-size"
              type="number"
              min="1"
              value={currentSizeMB}
              onChange={handleMaxSizeChange}
              className="max-w-[100px]"
            />
            <span className="text-sm text-muted-foreground">MB</span>
          </div>
        </SettingsFormField>

        <SettingsFormField
          htmlFor="max-image-size"
          focusId="max-image-size-mb"
          label={t("file_upload.settings.max_image_size_label")}
          description={t("file_upload.settings.max_image_size_description")}>
          <div className="flex items-center gap-2">
            <Input
              id="max-image-size"
              type="number"
              min="1"
              value={String(maxImageSizeMb || DEFAULT_MAX_IMAGE_SIZE_MB)}
              onChange={handleMaxImageSizeChange}
              className="max-w-[100px]"
            />
            <span className="text-sm text-muted-foreground">MB</span>
          </div>
        </SettingsFormField>
      </FieldStack>
    </FieldStack>
  )
}
