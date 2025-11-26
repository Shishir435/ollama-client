import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { getTranscript } from "../transcript-extractor"

describe("Transcript Extractor", () => {
  const originalLocation = window.location

  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = ""
    vi.clearAllMocks()
    
    // Mock console to keep output clean
    vi.spyOn(console, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    // Restore location
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true
    })
  })

  const mockLocation = (href: string) => {
    Object.defineProperty(window, "location", {
      value: { href },
      writable: true
    })
  }

  describe("getTranscript", () => {
    it("should return null for unsupported sites", async () => {
      mockLocation("https://example.com")
      const result = await getTranscript()
      expect(result).toBeNull()
    })

    describe("YouTube", () => {
      beforeEach(() => {
        mockLocation("https://www.youtube.com/watch?v=123")
      })

      it("should extract existing transcript", async () => {
        // Setup DOM with existing transcript
        const renderer = document.createElement("ytd-transcript-renderer")
        const cueGroup = document.createElement("div")
        cueGroup.className = "cue-group"
        const cue = document.createElement("div")
        cue.className = "cue"
        cue.textContent = "Hello world"
        cueGroup.appendChild(cue)
        renderer.appendChild(cueGroup)
        document.body.appendChild(renderer)

        const result = await getTranscript()
        expect(result).toBe("Hello world")
      })

      it("should handle empty transcript", async () => {
        // Setup DOM with empty transcript renderer
        const renderer = document.createElement("ytd-transcript-renderer")
        document.body.appendChild(renderer)

        const result = await getTranscript()
        expect(result).toBeNull()
      })

      it("should attempt to open transcript if not found", async () => {
        // This is tricky to test fully without complex DOM mocking for the "open" flow
        // But we can verify it returns null if it fails to open (which it will in this empty DOM)
        const result = await getTranscript()
        expect(result).toBeNull()
      })
    })

    describe("Udemy", () => {
      beforeEach(() => {
        mockLocation("https://www.udemy.com/course/test/learn/lecture/123")
      })

      it("should extract transcript from panel", async () => {
        const panel = document.createElement("div")
        panel.setAttribute("data-purpose", "transcript-panel")
        
        const cue1 = document.createElement("span")
        cue1.setAttribute("data-purpose", "cue-text")
        cue1.textContent = "Line 1"
        
        const cue2 = document.createElement("span")
        cue2.setAttribute("data-purpose", "cue-text")
        cue2.textContent = "Line 2"
        
        panel.appendChild(cue1)
        panel.appendChild(cue2)
        document.body.appendChild(panel)

        const result = await getTranscript()
        expect(result).toBe("Line 1\nLine 2")
      })

      it("should return null if panel missing", async () => {
        const result = await getTranscript()
        expect(result).toBeNull()
      })
    })

    describe("Coursera", () => {
      beforeEach(() => {
        mockLocation("https://www.coursera.org/learn/test/lecture/123")
      })

      it("should extract transcript phrases", async () => {
        const phrase1 = document.createElement("span")
        phrase1.className = "rc-Phrase"
        phrase1.textContent = "Hello"
        
        const phrase2 = document.createElement("span")
        phrase2.className = "rc-Phrase"
        phrase2.textContent = "world"
        
        document.body.appendChild(phrase1)
        document.body.appendChild(phrase2)

        const result = await getTranscript()
        expect(result).toBe("Hello world")
      })

      it("should return null if no phrases found", async () => {
        const result = await getTranscript()
        expect(result).toBeNull()
      })
    })
  })
})
