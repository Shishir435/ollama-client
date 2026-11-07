import { Chrome, PanelsTopLeft } from "lucide-react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { getModelIcon } from "@/features/model/lib/model-utils"
import { BROWSER_MODEL_ID } from "../browser-built-in/constants"
import { getBrowserBuiltInIcon } from "../browser-built-in/icon"
import { getProviderIcon } from "../registry"
import { ProviderId } from "../types"

const originalIdentity = Object.getOwnPropertyDescriptor(
  navigator,
  "userAgentData"
)
afterEach(() => {
  vi.restoreAllMocks()
  if (originalIdentity)
    Object.defineProperty(navigator, "userAgentData", originalIdentity)
  else Reflect.deleteProperty(navigator, "userAgentData")
})
describe("browser built-in icon", () => {
  it.each([
    [undefined, PanelsTopLeft],
    [{ brands: [{ brand: "Chromium" }] }, PanelsTopLeft],
    [
      { brands: [{ brand: "Microsoft Edge" }, { brand: "Chromium" }] },
      PanelsTopLeft
    ],
    [{ brands: [{ brand: "Google Chrome" }, { brand: "Chromium" }] }, Chrome]
  ])("uses only explicit Chrome identity: %j", (identity, expected) => {
    Object.defineProperty(navigator, "userAgentData", {
      configurable: true,
      get: vi.fn(() => identity)
    })
    expect(getBrowserBuiltInIcon()).toBe(expected)
    expect(getProviderIcon(ProviderId.BROWSER)).toEqual({
      kind: "lucide",
      icon: expected
    })
    expect(getModelIcon(BROWSER_MODEL_ID)).toBe(expected)
  })
})
