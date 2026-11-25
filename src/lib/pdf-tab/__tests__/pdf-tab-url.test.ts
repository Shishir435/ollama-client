import { describe, expect, it } from "vitest"
import { isFileUrl, isPdfTabUrl, pdfFileName } from "../pdf-tab-url"

describe("isPdfTabUrl", () => {
  it.each([
    "https://example.com/paper.pdf",
    "http://example.com/a/b/Report.PDF",
    "file:///Users/me/Documents/notes.pdf",
    "https://example.com/files/paper%20one.pdf",
    "https://example.com/paper.pdf?download=1#page=3"
  ])("recognises %s", (url) => {
    expect(isPdfTabUrl(url)).toBe(true)
  })

  it.each([
    undefined,
    "",
    "https://example.com/",
    "https://example.com/pdf/viewer",
    "https://example.com/paper.pdf.html",
    "chrome://pdf-viewer/index.html?src=x.pdf",
    "chrome-extension://abc/viewer.html?file=paper.pdf",
    "javascript:alert(1)//.pdf",
    "not a url.pdf"
  ])("does not treat %s as a PDF tab", (url) => {
    expect(isPdfTabUrl(url)).toBe(false)
  })
})

describe("isFileUrl", () => {
  it("separates local files from web addresses", () => {
    expect(isFileUrl("file:///tmp/a.pdf")).toBe(true)
    expect(isFileUrl("https://example.com/a.pdf")).toBe(false)
    expect(isFileUrl(undefined)).toBe(false)
  })
})

describe("pdfFileName", () => {
  it("names the file from the last path segment", () => {
    expect(pdfFileName("https://example.com/dir/paper%20one.pdf?x=1")).toBe(
      "paper one.pdf"
    )
  })

  it("falls back when the address has no file", () => {
    expect(pdfFileName("https://example.com/")).toBe("document.pdf")
    expect(pdfFileName("nonsense")).toBe("document.pdf")
  })
})
