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

const build = (minimumGeneration = 0, now?: () => number) =>
  buildAgentObservation({
    document,
    tabId: 7,
    documentId: "document-1",
    minimumGeneration,
    references: createAgentElementReferenceStore({
      documentId: "document-1"
    }),
    createSnapshotId: () => "snapshot-1",
    capturedAt: 1,
    ...(now ? { now } : {})
  })

/** A scale fixture asserts coverage, not timing, so its clock never advances. */
const unhurried = () => 0

/** Past the budget from the pass's very first check, and no earlier. */
const stalledClock = () => {
  let reads = 0
  return () => {
    reads += 1
    return reads === 1 ? 0 : AGENT_OBSERVATION_LIMITS.passBudgetMs + 1
  }
}

const appendButtons = (count: number) => {
  for (let index = 0; index < count; index += 1) {
    const button = document.createElement("button")
    button.textContent = `Act ${index}`
    document.body.append(button)
  }
}

describe("Agent observation builder", () => {
  it("names standard labelled fields and excludes hidden label text", () => {
    document.body.innerHTML =
      '<label for="name">Name</label><input id="name"><span id="visible">Account</span><span id="hidden" hidden>private</span><input aria-labelledby="visible hidden">'
    expect(build().elements.map((element) => element.name)).toEqual([
      "Name",
      "Account"
    ])
  })

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
    const result = build(0, unhurried)
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

  it("captures checked, focus, select options, and form semantics", () => {
    const form = document.createElement("form")
    form.action = "/submit"
    form.method = "post"
    const text = document.createElement("input")
    text.name = "query"
    const checkbox = document.createElement("input")
    checkbox.type = "checkbox"
    checkbox.checked = true
    const select = document.createElement("select")
    const first = document.createElement("option")
    first.value = "one"
    first.textContent = "First"
    const second = document.createElement("option")
    second.value = "two"
    second.textContent = "Second"
    second.selected = true
    select.append(first, second)
    const submit = document.createElement("button")
    submit.textContent = "Continue"
    submit.formAction = "/finish"
    form.append(text, checkbox, select, submit)
    document.body.append(form)
    text.focus()

    const result = build()
    expect(result.elements[0]).toMatchObject({
      focused: true,
      maySubmit: true,
      formAction: new URL("/finish", location.href).href,
      formMethod: "post"
    })
    expect(result.elements[1]).toMatchObject({ checked: true })
    expect(result.elements[2]).toMatchObject({
      value: "two",
      options: [
        { value: "one", label: "First", disabled: false },
        { value: "two", label: "Second", disabled: false }
      ]
    })
    expect(result.elements[3]).toMatchObject({
      submitter: true,
      maySubmit: true,
      formAction: new URL("/finish", location.href).href,
      formMethod: "post"
    })
  })

  it("keeps repeated controls distinct across observation generations", () => {
    const first = document.createElement("input")
    const second = document.createElement("input")
    first.setAttribute("aria-label", "Quantity")
    second.setAttribute("aria-label", "Quantity")
    document.body.append(first, second)
    let nextVerificationId = 0
    let nextSnapshotId = 0
    const references = createAgentElementReferenceStore({
      documentId: "document-1",
      createVerificationId: () => `control-${++nextVerificationId}`
    })
    const observe = () =>
      buildAgentObservation({
        document,
        tabId: 7,
        documentId: "document-1",
        minimumGeneration: 0,
        references,
        createSnapshotId: () => `snapshot-${++nextSnapshotId}`,
        capturedAt: 1
      })

    const before = observe()
    const after = observe()
    expect(before.elements.map((element) => element.verificationId)).toEqual([
      "control-1",
      "control-2"
    ])
    expect(after.elements.map((element) => element.verificationId)).toEqual([
      "control-1",
      "control-2"
    ])
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

  it("reports absolute destinations for rendered links only", () => {
    const visible = document.createElement("a")
    visible.setAttribute("href", "/docs?page=2")
    visible.textContent = "Docs"
    const download = document.createElement("a")
    download.setAttribute("href", "/export")
    download.setAttribute("download", "")
    download.textContent = "Export"
    const script = document.createElement("a")
    script.setAttribute("href", "javascript:alert(1)")
    script.textContent = "Run"
    document.body.append(visible, download, script)

    const elements = build().elements
    expect(elements[0]?.href).toBe("http://localhost:3000/docs?page=2")
    expect(elements[0]?.download).toBeUndefined()
    expect(elements[1]?.href).toBe("http://localhost:3000/export")
    expect(elements[1]?.download).toBe(true)
    expect(elements[2]?.href).toBeUndefined()
  })

  it("omits destinations for links the user cannot see", () => {
    const hidden = document.createElement("a")
    hidden.setAttribute("href", "/hidden")
    hidden.textContent = "Hidden"
    document.body.append(hidden)
    vi.spyOn(Element.prototype, "getClientRects").mockReturnValue(
      [] as unknown as DOMRectList
    )

    expect(build().elements[0]?.href).toBeUndefined()
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

  it("derives observation fields for a candidate that is not an HTMLElement", () => {
    document.body.innerHTML =
      '<svg role="img" aria-label="Logo"><rect width="10" height="10"/></svg><button>Continue</button>'
    const svg = document.querySelector("svg")
    expect(svg).toBeInstanceOf(SVGElement)
    expect(svg).not.toBeInstanceOf(HTMLElement)
    expect(typeof (svg as unknown as HTMLElement).isContentEditable).not.toBe(
      "boolean"
    )

    const elements = build().elements
    expect(elements[0]).toMatchObject({
      tag: "svg",
      role: "img",
      name: "Logo",
      editable: false,
      enabled: true,
      visible: true
    })
    expect(elements[0].type).toBeUndefined()
    expect(elements.map((element) => element.tag)).toContain("button")
  })

  it("observes an SVG link and resolves its destination", () => {
    document.body.innerHTML =
      '<svg role="img"><a href="/next"><text>Go</text></a></svg>'
    const anchor = build().elements.find((element) => element.href)
    expect(anchor).toMatchObject({
      tag: "a",
      href: "http://localhost:3000/next",
      editable: false,
      enabled: true
    })
  })

  it("keeps visible controls when hidden ones outnumber the element cap", () => {
    for (let index = 0; index < AGENT_OBSERVATION_LIMITS.elements; index += 1) {
      const hidden = document.createElement("input")
      hidden.type = "hidden"
      hidden.name = `hidden-${index}`
      document.body.append(hidden)
    }
    const button = document.createElement("button")
    button.textContent = "Continue"
    document.body.append(button)

    const elements = build(0, unhurried).elements
    expect(elements).toHaveLength(AGENT_OBSERVATION_LIMITS.elements)
    expect(
      elements
        .filter((element) => element.visible)
        .map((element) => element.name)
    ).toEqual(["Continue"])
  })

  it("keeps hidden controls while the element cap has room and holds document order", () => {
    document.body.innerHTML =
      '<input type="hidden" name="token"><button>First</button><input type="hidden" name="csrf"><button>Second</button>'
    const elements = build().elements
    expect(elements.map((element) => [element.tag, element.visible])).toEqual([
      ["input", false],
      ["button", true],
      ["input", false],
      ["button", true]
    ])
    expect(elements.map((element) => element.ref)).toEqual([
      "e1",
      "e2",
      "e3",
      "e4"
    ])
  })

  it("surfaces a visible control behind more hidden ones than any cap", () => {
    // A positional bound on the scan is the starvation defect one page-size
    // later, so the control is placed past every plausible cutoff.
    const buried = 20_100
    const parts: string[] = []
    for (let index = 0; index < buried; index += 1)
      parts.push(`<input type="hidden" name="token-${index}">`)
    parts.push("<button>Continue</button>")
    document.body.innerHTML = parts.join("")

    const elements = build(0, unhurried).elements
    expect(elements).toHaveLength(AGENT_OBSERVATION_LIMITS.elements)
    expect(
      elements
        .filter((element) => element.visible)
        .map((element) => element.name)
    ).toEqual(["Continue"])
  })

  it("stops scanning once the visible budget is full", () => {
    appendButtons(AGENT_OBSERVATION_LIMITS.elements + 50)
    const elements = build(0, unhurried).elements
    expect(elements).toHaveLength(AGENT_OBSERVATION_LIMITS.elements)
    expect(elements.every((element) => element.visible)).toBe(true)
    expect(elements.at(-1)?.name).toBe(
      `Act ${AGENT_OBSERVATION_LIMITS.elements - 1}`
    )
  })

  it("refuses a document it cannot finish selecting within its budget", () => {
    appendButtons(AGENT_OBSERVATION_LIMITS.budgetCheckInterval + 10)
    // A truncated selection is the defect this guards, so the pass fails
    // instead of returning a snapshot missing the control the run needs.
    expect(() => build(0, stalledClock())).toThrow("budget")
  })

  it("keeps the clock cost off a document that stays inside the budget", () => {
    appendButtons(AGENT_OBSERVATION_LIMITS.budgetCheckInterval - 1)
    let reads = 0
    const observation = build(0, () => {
      reads += 1
      return 0
    })
    expect(observation.elements).toHaveLength(
      AGENT_OBSERVATION_LIMITS.budgetCheckInterval - 1
    )
    // Read per interval across both walks, never per element.
    expect(reads).toBeLessThan(5)
  })

  it("truncates page text rather than failing when the budget runs out", () => {
    document.body.innerHTML = `<button>Continue</button>${Array.from(
      { length: AGENT_OBSERVATION_LIMITS.budgetCheckInterval + 10 },
      (_value, index) => `<p>paragraph ${index}</p>`
    ).join("")}`
    const observation = build(0, stalledClock())
    expect(observation.elements).toHaveLength(1)
    // visibleText already truncates at its own cap, so stopping early there
    // is the behaviour that field always had.
    expect(observation.visibleText).toContain("paragraph 0")
    expect(observation.visibleText).not.toContain(
      `paragraph ${AGENT_OBSERVATION_LIMITS.budgetCheckInterval + 9}`
    )
  })
})
