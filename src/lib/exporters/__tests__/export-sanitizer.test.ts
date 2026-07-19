import { describe, expect, it } from "vitest"

import {
  escapeHtml,
  sanitizeExportFragment,
  stripRemoteImages
} from "../export-sanitizer"

describe("escapeHtml", () => {
  it("escapes markup so a title cannot inject elements", () => {
    expect(escapeHtml(`<img src=x onerror=alert(1)>"'&`)).toBe(
      "&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;"
    )
  })
})

describe("sanitizeExportFragment", () => {
  // Script removal and attribute stripping are asserted on separate inputs:
  // happy-dom's NodeIterator skips the element after a removed node, so a
  // combined fixture would pass/fail on the test DOM, not on the config.
  it("removes script elements", () => {
    const clean = sanitizeExportFragment(
      "<div><script>alert(1)</script><p>hi</p></div>"
    )
    expect(clean).not.toContain("script")
    expect(clean).not.toContain("alert(1)")
  })

  it("removes event-handler attributes", () => {
    const clean = sanitizeExportFragment(
      '<div><p onclick="x()">hi</p><img src="data:image/png;base64,AA" onerror="y()"></div>'
    )
    expect(clean).not.toContain("onclick")
    expect(clean).not.toContain("onerror")
    expect(clean).toContain("<p>hi</p>")
  })

  it("drops javascript: links but keeps http(s) and mailto", () => {
    const clean = sanitizeExportFragment(
      '<a href="javascript:alert(1)">a</a><a href="https://example.com/x">b</a><a href="mailto:x@y.z">c</a>'
    )
    expect(clean).not.toContain("javascript:")
    expect(clean).toContain('href="https://example.com/x"')
    expect(clean).toContain('href="mailto:x@y.z"')
  })

  it("keeps the export stylesheet", () => {
    const clean = sanitizeExportFragment("<style>.x{color:red}</style><p>t</p>")
    expect(clean).toContain("<style>")
    expect(clean).toContain(".x{color:red}")
  })

  it("replaces remote images with a placeholder by default", () => {
    const clean = sanitizeExportFragment(
      '<img src="https://tracker.example.com/pixel.png" alt="pic"><img src="data:image/png;base64,AA" alt="inline">',
      { blockedImageLabel: "Remote image blocked" }
    )
    expect(clean).not.toContain("tracker.example.com/pixel.png")
    expect(clean).toContain("blocked-remote-image")
    expect(clean).toContain("[Remote image blocked: tracker.example.com]")
    expect(clean).toContain('src="data:image/png;base64,AA"')
  })

  it("keeps remote images when the user opted in", () => {
    const clean = sanitizeExportFragment(
      '<img src="https://example.com/a.png" alt="pic">',
      { allowRemoteImages: true }
    )
    expect(clean).toContain('src="https://example.com/a.png"')
    expect(clean).not.toContain("blocked-remote-image")
  })
})

describe("stripRemoteImages", () => {
  it("falls back to the image alt text when no label is given", () => {
    const out = stripRemoteImages(
      '<img src="http://a.example/x.png" alt="chart">'
    )
    expect(out).toContain("[chart: a.example]")
  })

  it("leaves local and data images untouched", () => {
    const html = '<img src="data:image/png;base64,AA"><img src="blob:x">'
    expect(stripRemoteImages(html)).toBe(html)
  })
})
