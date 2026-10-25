import { useEffect, useState } from "react"
import { observeBrowserModelStatus } from "@/features/model/lib/browser-model-observer"
import { promptAPI } from "@/lib/providers/browser-built-in/api"

/** Search advertises the optional control only after the host proves support. */
export const useBrowserBuiltInVisible = (): boolean => {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!promptAPI()) return
    return observeBrowserModelStatus((status) =>
      setVisible(
        Boolean(promptAPI()) &&
          (status.availability !== "unavailable" || status.enabled)
      )
    )
  }, [])
  return visible
}
