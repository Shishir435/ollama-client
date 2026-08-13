import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { extractUdemyTranscript } from "../udemy"

describe("Udemy transcript extractor", () => {
  const originalLocation = window.location

  beforeEach(() => {
    document.body.innerHTML = ""
    vi.clearAllMocks()
    Object.defineProperty(window, "location", {
      value: {
        href: "https://www.udemy.com/course/test/learn/lecture/123"
      },
      writable: true
    })
  })

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true
    })
    vi.unstubAllGlobals()
  })

  it("extracts and normalizes transcript cues from an open panel", async () => {
    document.body.innerHTML = `
      <div data-purpose="transcript-panel">
        <span data-purpose="cue-text"> Line  1 </span>
        <span data-purpose="cue-text">Line 2</span>
      </div>
    `

    expect(await extractUdemyTranscript()).toBe("Line 1\nLine 2")
  })

  it("opens a transcript tab before extracting cues", async () => {
    const transcriptTab = document.createElement("button")
    transcriptTab.setAttribute("role", "tab")
    transcriptTab.innerHTML = `<span class="ud-btn-label">Transcript</span>`
    transcriptTab.addEventListener("click", () => {
      if (document.querySelector('[data-purpose="transcript-panel"]')) return
      const panel = document.createElement("div")
      panel.setAttribute("data-purpose", "transcript-panel")
      panel.innerHTML = `
        <span data-purpose="cue-text">All right, guys.</span>
        <span data-purpose="cue-text">
          So pending callbacks, the third phase.
        </span>
      `
      document.body.appendChild(panel)
    })
    document.body.appendChild(transcriptTab)

    expect(await extractUdemyTranscript()).toBe(
      "All right, guys.\nSo pending callbacks, the third phase."
    )
  })

  it("opens an icon-only transcript toggle", async () => {
    const transcriptToggle = document.createElement("button")
    transcriptToggle.setAttribute("data-purpose", "transcript-toggle")
    transcriptToggle.innerHTML = `
      <svg aria-label="Transcript in sidebar region" role="img"></svg>
    `
    transcriptToggle.addEventListener("click", () => {
      const panel = document.createElement("div")
      panel.setAttribute("data-purpose", "transcript-panel")
      panel.innerHTML =
        '<span data-purpose="cue-text">Icon toggle transcript.</span>'
      document.body.appendChild(panel)
    })
    document.body.appendChild(transcriptToggle)

    expect(await extractUdemyTranscript()).toBe("Icon toggle transcript.")
  })

  it("supports controls that respond to pointer-compatible mouse events", async () => {
    const transcriptToggle = document.createElement("button")
    transcriptToggle.innerHTML = `
      <svg aria-label="Transcript in sidebar region" role="img"></svg>
    `
    transcriptToggle.addEventListener("mousedown", () => {
      const panel = document.createElement("div")
      panel.setAttribute("data-purpose", "transcript-panel")
      panel.innerHTML =
        '<span data-purpose="cue-text">Pressed transcript.</span>'
      document.body.appendChild(panel)
    })
    document.body.appendChild(transcriptToggle)

    expect(await extractUdemyTranscript()).toBe("Pressed transcript.")
  })

  it("returns null on non-Udemy pages without touching controls", async () => {
    Object.defineProperty(window, "location", {
      value: { href: "https://example.com" },
      writable: true
    })
    const click = vi.fn()
    const button = document.createElement("button")
    button.textContent = "Transcript"
    button.addEventListener("click", click)
    document.body.appendChild(button)

    expect(await extractUdemyTranscript()).toBeNull()
    expect(click).not.toHaveBeenCalled()
  })
})
