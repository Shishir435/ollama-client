import { useEffect } from "react"

import { migrateLegacyProviderStorage } from "@/lib/storage/provider-migration"

export const useProviderStorageMigration = () => {
  useEffect(() => {
    void migrateLegacyProviderStorage()
  }, [])
}
