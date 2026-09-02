import { Window } from "happy-dom"
import { beforeEach, describe, expect, it } from "vitest"

import { createAgentElementReferenceStore } from "../element-references"
import {
  AGENT_OBSERVATION_LIMITS,
  buildAgentObservation
} from "../observation-builder"

beforeEach(() => {
  document.title = "Example"
  document.body.replaceChildren()
  history.replaceState({}, "", "/path")
})

const build = (minimumGeneration = 0) =>
  buildAgentObservation({
    document,
    tabId: 7,
    documentId: "document-1",
    minimumGeneration,
    references: createAgentElementReferenceStore({
      documentId: "document-1"
    }),
    createSnapshotId: () => "snapshot-1",
    capturedAt: 1
  })

describe("Agent observation builder", () => {
  it("caps visible text and interactive elements", () => {
    document.body.textContent = "x".repeat(
      AGENT_OBSERVATION_LIMITS.visibleTextChars + 100
    )
    for (
      let index = 0;
      index < AGENT_OBSERVATION_LIMITS.elements + 5;
      index += 1
    ) {
      document.body.append(document.createElement("button"))
    }
    const result = build()
    expect(result.visibleText).toHaveLength(
      AGENT_OBSERVATION_LIMITS.visibleTextChars
    )
    expect(result.elements).toHaveLength(AGENT_OBSERVATION_LIMITS.elements)
  })

  it.each([
    ["password", { type: "password", value: "secret" }],
    ["one-time code", { autocomplete: "one-time-code", value: "123456" }],
    ["card", { name: "card-number", value: "4111111111111111" }],
    ["file", { type: "file", value: "" }]
  ])("redacts the existing %s value", (_label, attributes) => {
    const input = document.createElement("input")
    for (const [name, value] of Object.entries(attributes)) {
      if (name === "value") input.value = value
      else input.setAttribute(name, value)
    }
    document.body.append(input)
    expect(build().elements[0]).toMatchObject({ sensitive: true })
    expect(build().elements[0]).not.toHaveProperty("value")
  })

  it("keeps bounded non-sensitive values", () => {
    const input = document.createElement("input")
    input.value = "safe value"
    document.body.append(input)
    expect(build().elements[0]).toMatchObject({
      sensitive: false,
      value: "safe value"
    })
  })

  it("rejects subframe and unsupported-scheme observations", () => {
    const references = createAgentElementReferenceStore({
      documentId: "document-1"
    })
    expect(() =>
      buildAgentObservation({
        document,
        tabId: 7,
        frameId: 2,
        documentId: "document-1",
        minimumGeneration: 0,
        references
      })
    ).toThrow("main-frame only")

    const unsupported = new Window({ url: "file:///tmp/page.html" }).document
    expect(() =>
      buildAgentObservation({
        document: unsupported as unknown as Document,
        tabId: 7,
        documentId: "document-1",
        minimumGeneration: 0,
        references
      })
    ).toThrow("HTTP(S)")
  })
})
