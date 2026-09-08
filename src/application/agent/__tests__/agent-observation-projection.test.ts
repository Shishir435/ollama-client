import type { AgentElement, AgentObservation } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"

import {
  projectAgentElement,
  projectAgentObservation
} from "../agent-observation-projection"

const element = (overrides: Partial<AgentElement> = {}): AgentElement => ({
  ref: "e1",
  verificationId: "verification-1",
  frameId: 0,
  tag: "button",
  name: "Continue",
  visible: true,
  enabled: true,
  editable: false,
  sensitive: false,
  ...overrides
})

const observation = (
  overrides: Partial<AgentObservation> = {}
): AgentObservation => ({
  snapshotId: "snapshot-1",
  generation: 1,
  tabId: 7,
  documentId: "document-1",
  url: "https://example.com/",
  origin: "https://example.com",
  title: "Example",
  elements: [element()],
  visibleText: "Continue",
  scroll: {
    x: 0,
    y: 40,
    viewportWidth: 800,
    viewportHeight: 600,
    documentWidth: 800,
    documentHeight: 4_000
  },
  dialogs: [],
  capturedAt: 1,
  ...overrides
})

describe("projectAgentElement", () => {
  it("drops what only the executor uses", () => {
    const projected = projectAgentElement(
      element({ formFingerprint: "abcd1234", maySubmit: true })
    )
    expect(projected).not.toHaveProperty("verificationId")
    expect(projected).not.toHaveProperty("frameId")
    expect(projected).not.toHaveProperty("formFingerprint")
  })

  it("omits a flag that is already at its default", () => {
    const projected = projectAgentElement(element())
    // A row saying enabled, visible, not editable and not sensitive says
    // nothing, and on a real page that noise is most of the payload.
    expect(projected).toEqual({ ref: "e1", tag: "button", name: "Continue" })
  })

  it("states only the unusual side of each flag", () => {
    expect(
      projectAgentElement(
        element({
          enabled: false,
          visible: false,
          editable: true,
          sensitive: true
        })
      )
    ).toMatchObject({
      disabled: true,
      hidden: true,
      editable: true,
      sensitive: true
    })
  })

  it("keeps what a decision has to act on", () => {
    expect(
      projectAgentElement(
        element({
          tag: "input",
          type: "checkbox",
          checked: false,
          value: "on",
          role: "checkbox",
          group: 'form "signup"',
          submitter: true
        })
      )
    ).toEqual({
      ref: "e1",
      tag: "input",
      role: "checkbox",
      name: "Continue",
      type: "checkbox",
      value: "on",
      checked: false,
      group: 'form "signup"',
      submits: true
    })
  })

  it("bounds a label the page made into prose", () => {
    const projected = projectAgentElement(
      element({ name: "n".repeat(500), value: "v".repeat(500) })
    )
    expect(projected.name).toHaveLength(200)
    expect(projected.value).toHaveLength(200)
  })

  it("reduces select options to the enabled values", () => {
    expect(
      projectAgentElement(
        element({
          tag: "select",
          options: [
            { value: "a", label: "A", disabled: false },
            { value: "b", label: "B", disabled: true },
            { value: "c", label: "C", disabled: false }
          ]
        })
      ).options
    ).toEqual(["a", "c"])
  })
})

describe("projectAgentObservation", () => {
  it("keeps the page's identity and drops the run's bookkeeping", () => {
    const projected = projectAgentObservation(observation())
    expect(projected).toMatchObject({
      url: "https://example.com/",
      title: "Example",
      text: "Continue",
      scroll: { y: 40, ofDocument: 4_000 }
    })
    expect(projected).not.toHaveProperty("snapshotId")
    expect(projected).not.toHaveProperty("documentId")
    expect(projected).not.toHaveProperty("generation")
  })

  it("carries open modals so a decision can act inside the top one", () => {
    expect(
      projectAgentObservation(
        observation({
          modals: [{ id: "dialog1", kind: "dialog", label: "Confirm" }]
        })
      ).modals
    ).toEqual([{ id: "dialog1", kind: "dialog", label: "Confirm" }])
  })

  it("carries the document's own text and says when it was cut", () => {
    const projected = projectAgentObservation(
      observation({ documentText: "Full page", documentTextTruncated: true })
    )
    expect(projected.documentText).toBe("Full page")
    expect(projected.documentTextTruncated).toBe(true)
  })

  it("is materially smaller than the observation it projects", () => {
    const wide = observation({
      elements: Array.from({ length: 200 }, (_value, index) =>
        element({
          ref: `e${index}`,
          verificationId: `verification-${index}`,
          formFingerprint: "abcd1234",
          maySubmit: true,
          type: "text",
          tag: "input",
          editable: true
        })
      )
    })
    const before = JSON.stringify(wide).length
    const after = JSON.stringify(projectAgentObservation(wide)).length
    expect(after).toBeLessThan(before / 2)
  })
})
