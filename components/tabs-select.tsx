import { MultiSelect } from "@/components/ui/multi-select"
import useOpenTabs from "@/hooks/use-open-tab"
import { STORAGE_KEYS } from "@/lib/constant"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { useState } from "react"

import { useStorage } from "@plasmohq/storage/hook"

const trimTitle = (title: string, max = 30) =>
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
  const [selectedTabs, setSelectedTabs] = useState<string[]>([])
  if (!tabAccess) return null

  const tabOptions = openTabs.map((tab) => ({
    label: trimTitle(tab.title),
    value: tab.id?.toString() || tab.title
  }))

  return (
    <div className="mb-2 w-full">
      <MultiSelect
        options={tabOptions}
        onValueChange={setSelectedTabs}
        defaultValue={selectedTabs}
        placeholder="Select open tabs"
      />
    </div>
  )
}
