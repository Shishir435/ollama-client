import {
  isChromiumBased,
  supportsOffscreenDocuments,
  supportsTabCapture
} from "@/lib/browser-api"

export type TabCapturePrototypeBlocker =
  | "firefox-unsupported"
  | "tab-capture-unavailable"
  | "offscreen-unavailable"
  | "transcription-pipeline-missing"
  | "interactive-stop-control-missing"

export interface TabCapturePrototypeAssessment {
  browserInfrastructureReady: boolean
  blockers: TabCapturePrototypeBlocker[]
  requiredPermissions: ["tabCapture", "offscreen"]
  minimumChromeVersion: 116
  userGestureRequired: true
  preserveTabAudioRequired: true
  persistenceDefault: "ephemeral"
}

/**
 * Week 2 feasibility gate. This intentionally does not start capture: Chrome
 * requires a user gesture, persistent recording UI, and an explicit Stop path.
 * Shipping a hidden or half-wired capture would violate the product safety
 * contract.
 */
export const assessTabCapturePrototype = (): TabCapturePrototypeAssessment => {
  const blockers: TabCapturePrototypeBlocker[] = []
  if (!isChromiumBased()) blockers.push("firefox-unsupported")
  else {
    if (!supportsTabCapture()) blockers.push("tab-capture-unavailable")
    if (!supportsOffscreenDocuments()) blockers.push("offscreen-unavailable")
  }

  blockers.push(
    "transcription-pipeline-missing",
    "interactive-stop-control-missing"
  )

  return {
    browserInfrastructureReady:
      !blockers.includes("firefox-unsupported") &&
      !blockers.includes("tab-capture-unavailable") &&
      !blockers.includes("offscreen-unavailable"),
    blockers,
    requiredPermissions: ["tabCapture", "offscreen"],
    minimumChromeVersion: 116,
    userGestureRequired: true,
    preserveTabAudioRequired: true,
    persistenceDefault: "ephemeral"
  }
}
