import { act, fireEvent, render, screen } from "@testing-library/react"
import { Bell, Cog, House } from "lucide-react"
import { describe, expect, it } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { TooltipActionButton } from "../tooltip-action-button"

const popups = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>('[data-slot="tooltip-content"]')
  )

const openTooltips = () =>
  popups()
    .filter((node) => !node.hasAttribute("data-closed"))
    .map((node) => node.textContent)

const focusFrom = async (from: HTMLElement | null, to: HTMLElement) => {
  await act(async () => {
    if (from) fireEvent.blur(from, { relatedTarget: to })
    to.focus()
    fireEvent.focus(to)
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

describe("TooltipActionButton", () => {
  it("shows only the focused trigger's tooltip while tabbing, without animating", async () => {
    render(
      <TooltipProvider>
        <TooltipActionButton label="Home" icon={House} />
        <TooltipActionButton label="Alerts" icon={Bell} />
        <TooltipActionButton label="Settings" icon={Cog} />
      </TooltipProvider>
    )
    const [home, alerts, settings] = ["Home", "Alerts", "Settings"].map(
      (name) => screen.getByRole("button", { name })
    )

    await focusFrom(null, home)
    expect(openTooltips()).toEqual(["Home"])

    await focusFrom(home, alerts)
    expect(openTooltips()).toEqual(["Alerts"])

    await focusFrom(alerts, settings)
    expect(openTooltips()).toEqual(["Settings"])

    /**
     * A focus-opened popup is marked instant for its whole life (`focus`, or
     * `delay` while the provider moves between adjacent triggers), and the
     * class turns its enter and exit animations off. Without that, each
     * tooltip Tab moved past kept fading out beside the next one.
     */
    const [settingsPopup] = popups().filter(
      (node) => node.textContent === "Settings"
    )
    expect(settingsPopup).toHaveAttribute("data-instant")
    expect(settingsPopup.className).toContain("data-instant:animate-none!")

    await act(async () => {
      fireEvent.blur(settings, { relatedTarget: document.body })
      settings.blur()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(openTooltips()).toEqual([])
  })
})
