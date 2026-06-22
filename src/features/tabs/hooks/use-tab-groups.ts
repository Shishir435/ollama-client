import { useCallback, useEffect, useState } from "react"
import {
  type BrowserTabGroup,
  getTabGroupsAvailability,
  listBrowserTabGroups,
  requestTabGroupsAccess
} from "@/lib/browser-tab-groups"
import { logger } from "@/lib/logger"

export const useTabGroups = (enabled: boolean) => {
  const [groups, setGroups] = useState<BrowserTabGroup[]>([])
  const [availability, setAvailability] = useState<
    "available" | "unsupported" | "permission"
  >("unsupported")
  const [loading, setLoading] = useState(false)

  const refreshGroups = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    try {
      const nextAvailability = await getTabGroupsAvailability()
      setAvailability(nextAvailability)
      if (nextAvailability !== "available") {
        setGroups([])
        return
      }
      setGroups(await listBrowserTabGroups())
    } catch (error) {
      logger.error("Failed to fetch tab groups", "useTabGroups", { error })
      setGroups([])
    } finally {
      setLoading(false)
    }
  }, [enabled])

  const requestAccess = useCallback(async () => {
    const granted = await requestTabGroupsAccess()
    await refreshGroups()
    return granted
  }, [refreshGroups])

  useEffect(() => {
    refreshGroups()
  }, [refreshGroups])

  return { groups, availability, loading, refreshGroups, requestAccess }
}
