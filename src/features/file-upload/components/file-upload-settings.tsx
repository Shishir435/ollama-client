import { useStorage } from "@plasmohq/storage/hook"
import type { ChangeEvent } from "react"
import { useTranslation } from "react-i18next"
import { SettingsFormField, SettingsSwitch } from "@/components/settings"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { DEFAULT_FILE_UPLOAD_CONFIG, STORAGE_KEYS } from "@/lib/constants"
import { ocrLanguages } from "@/lib/ocr/ocr-language"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { FileUploadConfig } from "@/types"

export const FileUploadSettings = () => {
  const { t } = useTranslation()
  const [config, setConfig] = useStorage<FileUploadConfig>(
    {
      key: STORAGE_KEYS.FILE_UPLOAD.CONFIG,
      instance: plasmoGlobalStorage
    },
    DEFAULT_FILE_UPLOAD_CONFIG
  )

  const handleMaxSizeChange = (e: ChangeEvent<HTMLInputElement>) => {
    const mb = Number.parseFloat(e.target.value)
    if (!Number.isNaN(mb) && mb > 0) {
      setConfig((prev) => ({
        ...prev,
        maxFileSize: mb * 1024 * 1024
      }))
    }
  }

  const currentSizeMB = config?.maxFileSize
    ? (config.maxFileSize / (1024 * 1024)).toFixed(0)
    : "10"
  const ocrEnabled = config?.enableOcr ?? false
  const ocrLanguage = config?.ocrLanguage || "eng"

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <SettingsFormField
          htmlFor="max-file-size"
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

        <SettingsSwitch
          id="ocr-enabled"
          label={t("file_upload.settings.ocr_enabled_label")}
          description={t("file_upload.settings.ocr_enabled_description")}
          checked={ocrEnabled}
          onCheckedChange={(checked) =>
            setConfig((prev) => ({
              ...prev,
              enableOcr: checked
            }))
          }
        />

        <SettingsFormField
          label={t("file_upload.settings.ocr_language_label")}
          description={t("file_upload.settings.ocr_language_description")}>
          <Select
            value={ocrLanguage}
            onValueChange={(value) =>
              setConfig((prev) => ({
                ...prev,
                ocrLanguage: value
              }))
            }
            disabled={!ocrEnabled}>
            <SelectTrigger>
              <SelectValue
                placeholder={t("file_upload.settings.ocr_language_placeholder")}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>
                  {t("file_upload.settings.ocr_language_label")}
                </SelectLabel>
                {ocrLanguages.map((lang) => (
                  <SelectItem key={lang.value} value={lang.value}>
                    {lang.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </SettingsFormField>
      </div>
    </div>
  )
}
