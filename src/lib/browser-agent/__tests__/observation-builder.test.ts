import { Window } from "happy-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createAgentElementReferenceStore } from "../element-references"
import {
  AGENT_OBSERVATION_LIMITS,
  buildAgentObservation
} from "../observation-builder"

beforeEach(() => {
  document.title = "Example"
  document.body.replaceChildren()
  history.replaceState({}, "", "/path")
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([
    {
      bottom: 20,
      height: 20,
      left: 0,
      right: 100,
      top: 0,
      width: 100
    } as DOMRect
  ] as unknown as DOMRectList)
})

afterEach(() => vi.restoreAllMocks())

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

  it.each([
    [
      "hidden input",
      (input: HTMLInputElement) => input.setAttribute("type", "hidden")
    ],
    [
      "hidden attribute",
      (input: HTMLInputElement) => input.setAttribute("hidden", "")
    ],
    [
      "hidden ancestor",
      (input: HTMLInputElement) =>
        input.parentElement?.setAttribute("hidden", "")
    ],
    [
      "display none",
      (input: HTMLInputElement) => input.style.setProperty("display", "none")
    ],
    [
      "visibility hidden",
      (input: HTMLInputElement) =>
        input.style.setProperty("visibility", "hidden")
    ],
    [
      "transparent",
      (input: HTMLInputElement) => input.style.setProperty("opacity", "0")
    ]
  ])("redacts values from a %s", (_label, hide) => {
    const wrapper = document.createElement("div")
    const input = document.createElement("input")
    input.value = "page-secret"
    wrapper.append(input)
    document.body.append(wrapper)
    hide(input)

    expect(build().elements[0]).toMatchObject({
      sensitive: true,
      visible: false
    })
    expect(build().elements[0]).not.toHaveProperty("value")
  })

  it("redacts values outside the viewport", () => {
    const input = document.createElement("input")
    input.value = "offscreen-secret"
    input.getClientRects = () =>
      [
        {
          bottom: 20,
          height: 20,
          left: window.innerWidth + 100,
          right: window.innerWidth + 200,
          top: 0,
          width: 100
        } as DOMRect
      ] as unknown as DOMRectList
    document.body.append(input)

    expect(build().elements[0]).toMatchObject({
      sensitive: true,
      visible: false
    })
    expect(build().elements[0]).not.toHaveProperty("value")
  })

  it("redacts values clipped by an overflow ancestor", () => {
    const wrapper = document.createElement("div")
    wrapper.style.overflow = "hidden"
    wrapper.getClientRects = () =>
      [
        {
          bottom: 50,
          height: 50,
          left: 0,
          right: 50,
          top: 0,
          width: 50
        } as DOMRect
      ] as unknown as DOMRectList
    const input = document.createElement("input")
    input.value = "clipped-secret"
    input.getClientRects = () =>
      [
        {
          bottom: 30,
          height: 20,
          left: 60,
          right: 100,
          top: 10,
          width: 40
        } as DOMRect
      ] as unknown as DOMRectList
    wrapper.append(input)
    document.body.append(wrapper)

    expect(build().elements[0]).toMatchObject({
      sensitive: true,
      visible: false
    })
    expect(build().elements[0]).not.toHaveProperty("value")
  })

  it.each([
    ["clip-path", "inset(100%)"],
    ["mask-image", "linear-gradient(transparent, transparent)"]
  ])("redacts values behind %s", (property, value) => {
    const input = document.createElement("input")
    input.value = "clipped-secret"
    input.style.setProperty(property, value)
    document.body.append(input)

    expect(build().elements[0]).toMatchObject({
      sensitive: true,
      visible: false
    })
    expect(build().elements[0]).not.toHaveProperty("value")
  })

  it.each([
    ["hidden", (element: HTMLElement) => element.setAttribute("hidden", "")],
    [
      "hidden ancestor",
      (element: HTMLElement) =>
        element.parentElement?.setAttribute("aria-hidden", "true")
    ],
    [
      "transparent",
      (element: HTMLElement) => element.style.setProperty("opacity", "0")
    ],
    [
      "content-hidden",
      (element: HTMLElement) =>
        element.style.setProperty("content-visibility", "hidden")
    ],
    [
      "offscreen",
      (element: HTMLElement) => {
        element.getClientRects = () =>
          [
            {
              bottom: 20,
              height: 20,
              left: window.innerWidth + 100,
              right: window.innerWidth + 200,
              top: 0,
              width: 100
            } as DOMRect
          ] as unknown as DOMRectList
      }
    ]
  ])("omits %s DOM text and element names", (_label, hide) => {
    const wrapper = document.createElement("div")
    const element = document.createElement("button")
    element.textContent = "hidden-page-secret"
    wrapper.append(element)
    document.body.append("visible page text", wrapper)
    hide(element)

    const observation = build()
    expect(observation.visibleText).toBe("visible page text")
    expect(observation.visibleText).not.toContain("hidden-page-secret")
    expect(observation.elements[0]).not.toHaveProperty("name")
  })

  it("excludes hidden descendants from visible element names", () => {
    const button = document.createElement("button")
    button.append("Visible label")
    const hidden = document.createElement("span")
    hidden.hidden = true
    hidden.textContent = " hidden-name-secret"
    button.append(hidden)
    document.body.append(button)

    const observation = build()
    expect(observation.visibleText).toBe("Visible label")
    expect(observation.elements[0]?.name).toBe("Visible label")
    expect(observation.elements[0]?.name).not.toContain("hidden-name-secret")
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
