import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { extractCourseraTranscript } from "../coursera"

describe("Coursera transcript extractor", () => {
  const originalLocation = window.location

  beforeEach(() => {
    document.body.innerHTML = ""
    Object.defineProperty(window, "location", {
      value: { href: "https://www.coursera.org/learn/test/lecture/123" },
      writable: true
    })
  })

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true
    })
  })

  it("extracts transcript phrases", () => {
    document.body.innerHTML = `
      <span class="rc-Phrase">Hello</span>
      <span class="rc-Phrase">world</span>
    `
    expect(extractCourseraTranscript()).toBe("Hello world")
  })

  it("returns null when no phrases are present", () => {
    expect(extractCourseraTranscript()).toBeNull()
  })

  it("ignores matching DOM on non-Coursera pages", () => {
    Object.defineProperty(window, "location", {
      value: { href: "https://example.com/lecture/123" },
      writable: true
    })
    document.body.innerHTML = '<span class="rc-Phrase">Wrong site</span>'
    expect(extractCourseraTranscript()).toBeNull()
  })
})
