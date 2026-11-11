import { expect, it } from "vitest"
import { cn } from "../class-names"

it("lets caller classes override the app's custom size tokens", () => {
  expect(cn("text-micro", "text-nano")).toBe("text-nano")
  expect(cn("rounded-panel", "rounded-control")).toBe("rounded-control")
  expect(cn("icon-sm", "icon-lg")).toBe("icon-lg")
  expect(cn("text-status-danger-text", "text-feature-2")).toBe("text-feature-2")
})
