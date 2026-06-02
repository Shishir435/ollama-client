import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { DEFAULT_MODEL_CONFIG } from "@/lib/constants"
import { ModelPerformanceSection } from "../model-performance-section"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe("ModelPerformanceSection", () => {
  it("does not flush partial keep_alive values while typing", () => {
    const updateConfig = vi.fn()
    const { unmount } = render(
      <ModelPerformanceSection
        config={DEFAULT_MODEL_CONFIG}
        updateConfig={updateConfig}
      />
    )

    const keepAlive = screen.getByLabelText(
      "settings.model.runtime.keep_alive_label"
    )
    fireEvent.change(keepAlive, { target: { value: "5" } })
    fireEvent.change(keepAlive, { target: { value: "5m" } })

    expect(updateConfig).not.toHaveBeenCalled()

    unmount()

    expect(updateConfig).toHaveBeenCalledTimes(1)
    expect(updateConfig).toHaveBeenCalledWith({ keep_alive: "5m" })
  })
})
