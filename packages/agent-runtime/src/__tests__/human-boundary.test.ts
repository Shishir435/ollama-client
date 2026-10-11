import type { AgentObservation } from "@ollama-client/contracts"
import { expect, it } from "vitest"
import { agentObservationNeedsHuman } from "../human-boundary"

const page = (
  title: string,
  visibleText: string,
  elements: AgentObservation["elements"] = []
) => ({ title, visibleText, elements }) as AgentObservation

it("pauses on a rendered login gate or challenge without treating ordinary prose as a gate", () => {
  expect(
    agentObservationNeedsHuman(page("Just a moment...", "Verify you are human"))
  ).toBe(true)
  expect(
    agentObservationNeedsHuman(
      page("Sign in", "", [
        {
          ref: "e1",
          tag: "input",
          type: "password",
          visible: true,
          enabled: true,
          editable: true,
          sensitive: true,
          frameId: 0
        },
        {
          ref: "e2",
          tag: "button",
          name: "Sign in",
          visible: true,
          enabled: true,
          editable: false,
          sensitive: false,
          frameId: 0
        }
      ])
    )
  ).toBe(true)
  expect(
    agentObservationNeedsHuman(
      page("CAPTCHA documentation", "Learn to integrate CAPTCHA or sign in")
    )
  ).toBe(false)
  expect(agentObservationNeedsHuman(page("Home", "Sign in"))).toBe(false)
})
