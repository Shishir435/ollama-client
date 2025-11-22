import { useStorage } from "@plasmohq/storage/hook"
import type { ChangeEvent } from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DEFAULT_FILE_UPLOAD_CONFIG, STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { FileUploadConfig } from "@/types"

export const FileUploadSettings = () => {
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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Label htmlFor="max-file-size">Maximum File Size (MB)</Label>
        <Input
          id="max-file-size"
          type="number"
          min="1"
          value={currentSizeMB}
          onChange={handleMaxSizeChange}
          className="max-w-[100px]"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Maximum allowed size for individual files. Larger files may take longer
        to process.
      </p>
    </div>
  )
}
