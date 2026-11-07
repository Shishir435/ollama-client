import { Chrome, PanelsTopLeft, type LucideIcon } from "lucide-react"

/** Display-only browser identity; Chromium alone does not establish Chrome. */
export const getBrowserBuiltInIcon = (): LucideIcon => {
  try {
    const brands = (
      navigator as Navigator & {
        userAgentData?: { brands?: Array<{ brand: string }> }
      }
    ).userAgentData?.brands
    return brands?.some(({ brand }) => brand === "Google Chrome")
      ? Chrome
      : PanelsTopLeft
  } catch {
    return PanelsTopLeft
  }
}
