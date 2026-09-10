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
  frameId: 0,
  documentId: "document-1",
  url: "https://example.com/",
  origin: "https://example.com",
  title: "Example",
  frames: [
    {
      frameId: 0,
      documentId: "document-1",
      origin: "https://example.com",
      url: "https://example.com/",
      access: "ok",
      snapshotId: "snapshot-1",
      generation: 1
    }
  ],
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

  it("tells the model a visible control is covered", () => {
    expect(
      projectAgentElement(element({ visible: true, occluded: true }))
    ).toMatchObject({ occluded: true })
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
    expect(
      projectAgentElement(element({ name: "n".repeat(500) })).name
    ).toHaveLength(200)
  })

  it("never alters a value the model has to reproduce", () => {
    // A select's value must match an option exactly, and for any field the
    // value is what says whether it already holds what the goal wants.
    const exact = "v".repeat(900)
    expect(projectAgentElement(element({ value: exact })).value).toBe(exact)
  })

  it("keeps every enabled option, exactly, with a label that adds something", () => {
    expect(
      projectAgentElement(
        element({
          tag: "select",
          options: [
            { value: "a", label: "Apple", disabled: false },
            { value: "b", label: "B", disabled: true },
            { value: "c", label: "c", disabled: false }
          ]
        })
      ).options
    ).toEqual([{ value: "a", label: "Apple" }, { value: "c" }])
  })

  it("makes no option unselectable, however many or long they are", () => {
    // The executor requires exact equality, so a truncated value cannot be
    // selected and an omitted option cannot be reached at all.
    const options = Array.from({ length: 120 }, (_value, index) => ({
      value: `${"v".repeat(300)}-${index}`,
      label: `Option ${index}`,
      disabled: false
    }))
    const projected = projectAgentElement(element({ tag: "select", options }))
    expect(projected.options).toHaveLength(120)
    expect(projected.options?.at(-1)?.value).toBe(options[119].value)
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

  it("carries a native dialog, which is all a blocked page can be acted on through", () => {
    const dialog = {
      id: "d1",
      type: "confirm" as const,
      message: "Delete this project?"
    }
    const projected = projectAgentObservation(
      observation({ elements: [], visibleText: "", dialogs: [dialog] })
    )
    expect(projected.dialogs).toEqual([dialog])
  })

  it("says nothing about dialogs on a page that has none", () => {
    expect(projectAgentObservation(observation())).not.toHaveProperty("dialogs")
  })

  it("keeps a dialog even when the page budget is spent", () => {
    // A budget that dropped the dialog would leave the model looking at an
    // empty page with no way to explain it and no command that works.
    const dialog = { id: "d1", type: "alert" as const, message: "Saved" }
    const projected = projectAgentObservation(
      observation({ dialogs: [dialog] }),
      { pageContentChars: 0 }
    )
    expect(projected.dialogs).toEqual([dialog])
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

describe("projectAgentObservation frames", () => {
  it("says nothing about frames when the page has only its root", () => {
    expect(projectAgentObservation(observation())).not.toHaveProperty("frames")
  })

  it("names every other frame by id, origin and access, and nothing more", () => {
    const base = observation()
    const projected = projectAgentObservation(
      observation({
        frames: [
          base.frames[0],
          {
            frameId: 2,
            parentFrameId: 0,
            documentId: "document-2",
            origin: "https://example.com",
            url: "https://example.com/child?token=abc",
            access: "ok",
            snapshotId: "snapshot-2",
            generation: 1
          },
          {
            frameId: 3,
            parentFrameId: 0,
            origin: "https://ads.example",
            access: "unauthorized_origin"
          }
        ]
      })
    )
    expect(projected.frames).toEqual([
      { frameId: 2, origin: "https://example.com", access: "ok" },
      {
        frameId: 3,
        origin: "https://ads.example",
        access: "unauthorized_origin"
      }
    ])
    expect(JSON.stringify(projected.frames)).not.toContain("token")
  })
})

describe("projectAgentObservation overview budget", () => {
  const many = (
    count: number,
    base: Partial<AgentElement> = {}
  ): AgentElement[] =>
    Array.from({ length: count }, (_value, index) =>
      element({
        ref: `e${index + 1}`,
        name: `Field ${index + 1}`,
        ...base
      })
    )

  it("sends every control and the full text when no budget is set", () => {
    const projected = projectAgentObservation(
      observation({ elements: many(50), visibleText: "x".repeat(5_000) })
    )
    expect(projected.elements).toHaveLength(50)
    expect(projected.text).toHaveLength(5_000)
    expect(projected.omittedByGroup).toBeUndefined()
  })

  it("keeps the overview within its page-content budget", () => {
    const projected = projectAgentObservation(
      observation({ elements: many(500), visibleText: "x".repeat(50_000) }),
      { pageContentChars: 2_000 }
    )
    const size =
      JSON.stringify(projected.elements).length + projected.text.length
    expect(size).toBeLessThanOrEqual(2_400)
    expect(projected.elements.length).toBeLessThan(500)
  })

  it("reports what it dropped, by region, so a control stays discoverable", () => {
    const elements = [
      ...many(200, { group: 'form "signup"' }),
      ...many(1, {}).map((one) => ({ ...one, ref: "keep", focused: true }))
    ]
    const projected = projectAgentObservation(observation({ elements }), {
      pageContentChars: 800
    })
    expect(projected.omittedByGroup?.[0]?.group).toBe('form "signup"')
    expect(projected.omittedByGroup?.[0]?.count).toBeGreaterThan(0)
  })

  it("keeps the focused control under a tiny overview budget", () => {
    const elements = [
      ...many(100),
      element({ ref: "focused", name: "Active", focused: true })
    ]
    const projected = projectAgentObservation(observation({ elements }), {
      pageContentChars: 1,
      pageContentMaxChars: 10_000
    })
    expect(projected.elements.map((one) => one.ref)).toContain("focused")
  })

  it("keeps nothing over the ceiling, even the one control it prefers", () => {
    const elements = [element({ ref: "only", name: "Solo", focused: true })]
    const projected = projectAgentObservation(observation({ elements }), {
      pageContentChars: 1,
      pageContentMaxChars: 1
    })
    // A ceiling of one character has room for nothing; the guarantee yields.
    expect(projected.elements).toHaveLength(0)
  })

  it("expands a focused region in full while others stay at overview", () => {
    const elements = [
      ...many(100, { group: 'form "a"' }),
      ...many(100, { group: 'form "b"' }).map((one, index) => ({
        ...one,
        ref: `b${index}`
      }))
    ]
    const projected = projectAgentObservation(observation({ elements }), {
      pageContentChars: 2_000,
      pageContentMaxChars: 20_000,
      focus: { region: 'form "b"' }
    })
    const shownB = projected.elements.filter(
      (one) => one.group === 'form "b"'
    ).length
    const shownA = projected.elements.filter(
      (one) => one.group === 'form "a"'
    ).length
    expect(shownB).toBe(100)
    expect(shownA).toBeLessThan(100)
  })

  it("stops expanding a region at the hard ceiling, not the overview budget", () => {
    const elements = many(2_000, { group: 'form "b"' })
    const projected = projectAgentObservation(observation({ elements }), {
      pageContentChars: 2_000,
      pageContentMaxChars: 6_000,
      focus: { region: 'form "b"' }
    })
    // A huge inspected region is bounded by the ceiling so the prompt fits.
    const size = JSON.stringify(projected.elements).length
    expect(size).toBeLessThanOrEqual(6_500)
    expect(projected.elements.length).toBeLessThan(2_000)
  })

  it("caps extracted page text at the ceiling", () => {
    const projected = projectAgentObservation(
      observation({
        visibleText: "v".repeat(50_000),
        documentText: "d".repeat(50_000)
      }),
      {
        pageContentChars: 2_000,
        pageContentMaxChars: 8_000,
        focus: { text: true }
      }
    )
    expect(
      projected.text.length + (projected.documentText?.length ?? 0)
    ).toBeLessThanOrEqual(8_000)
  })

  it("marks the text truncated when the budget cut it", () => {
    const projected = projectAgentObservation(
      observation({ visibleText: "y".repeat(10_000) }),
      { pageContentChars: 1_000 }
    )
    expect(projected.textTruncated).toBe(true)
    expect(projected.text.length).toBeLessThan(10_000)
  })
})

describe("projectAgentObservation inspection focus", () => {
  const many = (
    count: number,
    base: Partial<AgentElement> = {}
  ): AgentElement[] =>
    Array.from({ length: count }, (_value, index) =>
      element({ ref: `e${index + 1}`, name: `Field ${index + 1}`, ...base })
    )

  it("surfaces controls matching a find query past the budget", () => {
    const elements = [
      ...many(200),
      element({ ref: "target", name: "Submit application", tag: "button" })
    ]
    const projected = projectAgentObservation(observation({ elements }), {
      pageContentChars: 500,
      focus: { query: "submit" }
    })
    expect(projected.elements.map((one) => one.ref)).toContain("target")
  })

  it("returns the whole document text when text is requested", () => {
    const projected = projectAgentObservation(
      observation({
        visibleText: "top of page",
        documentText: "below the fold",
        documentTextTruncated: true
      }),
      { pageContentChars: 500, focus: { text: true } }
    )
    expect(projected.text).toBe("top of page")
    expect(projected.documentText).toBe("below the fold")
    expect(projected.documentTextTruncated).toBe(true)
  })

  it("omits the document text by default under a budget", () => {
    const projected = projectAgentObservation(
      observation({ visibleText: "top", documentText: "below the fold" }),
      { pageContentChars: 500 }
    )
    expect(projected.documentText).toBeUndefined()
  })
})
