import type { AgentObservation } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import { agentPictureWarranted } from "../vision"

const observation = (
  overrides: Partial<AgentObservation> = {}
): AgentObservation =>
  ({
    snapshotId: "snapshot-1",
    generation: 1,
    tabId: 7,
    frameId: 0,
    documentId: "document-1",
    url: "https://example.com/",
    origin: "https://example.com",
    title: "Example",
    frames: [],
    elements: Array.from({ length: 20 }, (_value, index) => ({
      ref: `e${index + 1}`,
      frameId: 0,
      tag: "button",
      visible: true,
      enabled: true,
      editable: false,
      sensitive: false
    })),
    visibleText: "",
    scroll: {
      x: 0,
      y: 0,
      viewportWidth: 1_000,
      viewportHeight: 800,
      documentWidth: 1_000,
      documentHeight: 800
    },
    dialogs: [],
    capturedAt: 1,
    ...overrides
  }) as unknown as AgentObservation

describe("agentPictureWarranted", () => {
  it("takes one on the first step, which is what makes zoom reachable", () => {
    expect(
      agentPictureWarranted({
        state: { stepCount: 0 },
        observation: observation()
      })
    ).toBe(true)
  })

  it("skips an ordinary step on an ordinary page", () => {
    /**
     * The point of the whole predicate: most steps decide from text, and the
     * picture they were handed cost an image prefill and was never read.
     */
    expect(
      agentPictureWarranted({
        state: { stepCount: 4 },
        observation: observation(),
        previousVerification: {
          outcome: "confirmed",
          evidence: { kind: "field", summary: "", observedAt: 1 }
        }
      })
    ).toBe(false)
  })

  it("takes one after a step that did not land", () => {
    expect(
      agentPictureWarranted({
        state: { stepCount: 4 },
        observation: observation(),
        previousVerification: {
          outcome: "ambiguous",
          evidence: { kind: "field", summary: "", observedAt: 1 }
        }
      })
    ).toBe(true)
  })

  it("takes one when the page holds almost nothing the DOM can describe", () => {
    /**
     * A canvas application, a map or a rendered document: few controls and a
     * document taller than its viewport. Sparseness alone is not the signal —
     * a short confirmation dialog is also sparse — so the height is what
     * separates "little here" from "little here that the DOM can see".
     */
    expect(
      agentPictureWarranted({
        state: { stepCount: 4 },
        observation: observation({
          elements: [],
          scroll: {
            x: 0,
            y: 0,
            viewportWidth: 1_000,
            viewportHeight: 800,
            documentWidth: 1_000,
            documentHeight: 4_000
          }
        })
      })
    ).toBe(true)
    expect(
      agentPictureWarranted({
        state: { stepCount: 4 },
        observation: observation({
          elements: observation().elements.slice(0, 2),
          scroll: {
            x: 0,
            y: 0,
            viewportWidth: 1_000,
            viewportHeight: 800,
            documentWidth: 1_000,
            documentHeight: 800
          }
        })
      })
    ).toBe(false)
  })

  it("takes one on a page it has not seen yet", () => {
    /**
     * A navigation that landed on a map, a viewer or a canvas application:
     * the element list says little, the page has more than four controls, and
     * the old rule skipped it. `zoom` is offered only where a screenshot
     * exists, so skipping the first step on a new page left the model with no
     * way to ask to see the thing it had just navigated to.
     */
    expect(
      agentPictureWarranted({
        state: { stepCount: 4 },
        observation: observation({ url: "https://example.com/viewer" }),
        previousVerification: {
          outcome: "confirmed",
          evidence: { kind: "field", summary: "", observedAt: 1 }
        },
        history: [
          {
            step: 1,
            action: "click",
            outcome: "confirmed",
            url: "https://example.com/"
          }
        ]
      })
    ).toBe(true)
  })

  it("does not take a second one for staying where it is", () => {
    expect(
      agentPictureWarranted({
        state: { stepCount: 4 },
        observation: observation({
          url: "https://example.com/viewer?page=2#top"
        }),
        previousVerification: {
          outcome: "confirmed",
          evidence: { kind: "field", summary: "", observedAt: 1 }
        },
        history: [
          {
            step: 1,
            action: "click",
            outcome: "confirmed",
            url: "https://example.com/viewer"
          },
          { step: 2, action: "read", outcome: "confirmed" }
        ]
      })
    ).toBe(false)
  })

  it("takes one when the model asked to magnify a region", () => {
    expect(
      agentPictureWarranted({
        state: { stepCount: 9 },
        observation: observation(),
        inspection: { zoom: { x: 0, y: 0, width: 10, height: 10 } }
      })
    ).toBe(true)
  })
})
