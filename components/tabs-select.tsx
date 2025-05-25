import { MultiSelect } from "@/components/ui/multi-select"
import { useSelectedTabIds } from "@/context/selected-tab-ids-context"
import useOpenTabs from "@/hooks/use-open-tab"
import { useTabStatusMap } from "@/hooks/use-tab-status-map"
import { STORAGE_KEYS } from "@/lib/constant"
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
  if (!tabAccess) return null

  const tabOptions = openTabs.map((tab) => ({
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
