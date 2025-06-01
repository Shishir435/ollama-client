import { MultiSelect } from "@/components/ui/multi-select"
import useOpenTabs from "@/hooks/use-open-tab"
import { useTabStatusMap } from "@/hooks/use-tab-status-map"
import { useSelectedTabIds } from "@/context/selected-tab-ids-context"
import { DEFAULT_EXCLUDE_URLS, STORAGE_KEYS } from "@/lib/constant"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

import { useStorage } from "@plasmohq/storage/hook"

const trimTitle = (title: string, max = 25) =>
  title
    ? title.length > max
      ? title.slice(0, max) + "..."
      : title
    : "undefined"

export default function TabsSelect() {
  const [tabAccess] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.BROWSER.TABS_ACCESS,
      instance: plasmoGlobalStorage
    },
    false
  )
  const openTabs = useOpenTabs(tabAccess)
  const { selectedTabIds, setSelectedTabIds } = useSelectedTabIds()
  const getTabStatus = useTabStatusMap()
  const [excludedPatterns] = useStorage<string[]>(
    {
      key: STORAGE_KEYS.BROWSER.EXCLUDE_URL_PATTERNS,
      instance: plasmoGlobalStorage
    },
    DEFAULT_EXCLUDE_URLS
  )
  if (!tabAccess) return null

  const isAccessibleTab = (url: string | undefined) => {
    if (!url) return false
    return !excludedPatterns?.some((pattern) => new RegExp(pattern).test(url))
  }

  const tabOptions = openTabs
    .filter((tab) => isAccessibleTab(tab.url))
    .map((tab) => ({
      label: trimTitle(tab.title),
      value: tab.id?.toString() || tab.title
    }))

  return (
    <div className="mb-2 w-full">
      <MultiSelect
        options={tabOptions}
        onValueChange={setSelectedTabIds}
        defaultValue={selectedTabIds}
        placeholder="Select open tabs"
        statusForValue={(id) => getTabStatus(id)}
      />
    </div>
  )
}
