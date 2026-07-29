import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getTranscript } from "../transcript-extractor"

describe("Transcript Extractor", () => {
  const originalLocation = window.location

  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = ""
    document.head.innerHTML = ""
    vi.clearAllMocks()

    // Mock console to keep output clean
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
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

      it("should extract transcript from legacy segment renderers", async () => {
        const renderer = document.createElement("ytd-transcript-renderer")
        renderer.innerHTML = `
          <ytd-transcript-segment-renderer>
            <yt-formatted-string>Legacy line one.</yt-formatted-string>
          </ytd-transcript-segment-renderer>
          <ytd-transcript-segment-renderer>
            <yt-formatted-string>Legacy line two.</yt-formatted-string>
          </ytd-transcript-segment-renderer>
        `
        document.body.appendChild(renderer)

        const result = await getTranscript()
        expect(result).toBe("Legacy line one.\nLegacy line two.")
      })

      it("should extract transcript from YouTube caption tracks", async () => {
        const script = document.createElement("script")
        script.textContent = `var ytInitialPlayerResponse = ${JSON.stringify({
          // Real payloads always name their video; the resolver requires it.
          videoDetails: { videoId: "123" },
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [
                {
                  baseUrl: "https://www.youtube.com/api/timedtext?v=123",
                  languageCode: "en",
                  name: { simpleText: "English" }
                }
              ]
            }
          }
        })};`
        document.head.appendChild(script)

        vi.stubGlobal(
          "fetch",
          vi.fn().mockResolvedValue({
            ok: true,
            text: vi.fn().mockResolvedValue(
              JSON.stringify({
                events: [
                  {
                    tStartMs: 0,
                    segs: [{ utf8: "Hello " }, { utf8: "world" }]
                  },
                  { tStartMs: 7000, segs: [{ utf8: "Next line" }] }
                ]
              })
            )
          })
        )

        const result = await getTranscript()
        expect(result).toBe("0:00 Hello world\n0:07 Next line")
      })

      it("should keep timestamps from XML caption tracks", async () => {
        const script = document.createElement("script")
        script.textContent = `var ytInitialPlayerResponse = ${JSON.stringify({
          // Real payloads always name their video; the resolver requires it.
          videoDetails: { videoId: "123" },
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [
                {
                  baseUrl: "https://www.youtube.com/api/timedtext?v=123",
                  languageCode: "en",
                  name: { simpleText: "English" }
                }
              ]
            }
          }
        })};`
        document.head.appendChild(script)

        vi.stubGlobal(
          "fetch",
          vi.fn().mockResolvedValue({
            ok: true,
            text: vi
              .fn()
              .mockResolvedValue(
                `<transcript><text start="65">Late line</text></transcript>`
              )
          })
        )

        const result = await getTranscript()
        expect(result).toBe("1:05 Late line")
      })

      it("should not add 0:00 for XML caption nodes without start", async () => {
        const script = document.createElement("script")
        script.textContent = `var ytInitialPlayerResponse = ${JSON.stringify({
          // Real payloads always name their video; the resolver requires it.
          videoDetails: { videoId: "123" },
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [
                {
                  baseUrl: "https://www.youtube.com/api/timedtext?v=123",
                  languageCode: "en",
                  name: { simpleText: "English" }
                }
              ]
            }
          }
        })};`
        document.head.appendChild(script)

        vi.stubGlobal(
          "fetch",
          vi.fn().mockResolvedValue({
            ok: true,
            text: vi
              .fn()
              .mockResolvedValue(
                `<transcript><text>Untimed line</text></transcript>`
              )
          })
        )

        const result = await getTranscript()
        expect(result).toBe("Untimed line")
      })

      it("refetches the watch page when the inline payload is for another video", async () => {
        // YouTube navigates without a reload, so after moving from one video to
        // the next this script still describes the first one — and its caption
        // baseUrl still points there. Trusting it answers a question about the
        // open video with a different video's transcript, and nothing looks
        // wrong from the outside.
        const staleScript = document.createElement("script")
        staleScript.textContent = `var ytInitialPlayerResponse = ${JSON.stringify(
          {
            videoDetails: { videoId: "previous-video" },
            captions: {
              playerCaptionsTracklistRenderer: {
                captionTracks: [
                  {
                    baseUrl:
                      "https://www.youtube.com/api/timedtext?v=previous-video",
                    languageCode: "en",
                    name: { simpleText: "English" }
                  }
                ]
              }
            }
          }
        )};`
        document.head.appendChild(staleScript)

        const fetchMock = vi.fn(async (url: string) => {
          if (url.includes("/watch")) {
            return {
              ok: true,
              text: async () =>
                `<html><script>var ytInitialPlayerResponse = ${JSON.stringify({
                  videoDetails: { videoId: "123" },
                  captions: {
                    playerCaptionsTracklistRenderer: {
                      captionTracks: [
                        {
                          baseUrl:
                            "https://www.youtube.com/api/timedtext?v=123",
                          languageCode: "en",
                          name: { simpleText: "English" }
                        }
                      ]
                    }
                  }
                })};</script></html>`
            }
          }
          return {
            ok: true,
            text: async () =>
              JSON.stringify({
                events: [{ tStartMs: 3000, segs: [{ utf8: "Current video" }] }]
              })
          }
        })
        vi.stubGlobal("fetch", fetchMock)

        const result = await getTranscript()

        expect(result).toBe("0:03 Current video")
        const captionUrl = fetchMock.mock.calls
          .map(([url]) => String(url))
          .find((url) => url.includes("timedtext"))
        expect(captionUrl).toContain("v=123")
        expect(captionUrl).not.toContain("previous-video")
      })

      it("refetches when the inline payload names no video at all", async () => {
        // Unverifiable is not the same as current: without an id there is no way
        // to tell a stale payload from a fresh one, and the stale one's caption
        // URL points at the previously loaded video.
        const script = document.createElement("script")
        script.textContent = `var ytInitialPlayerResponse = ${JSON.stringify({
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [
                {
                  baseUrl:
                    "https://www.youtube.com/api/timedtext?v=unverifiable",
                  languageCode: "en",
                  name: { simpleText: "English" }
                }
              ]
            }
          }
        })};`
        document.head.appendChild(script)

        const fetchMock = vi.fn(async (url: string) => {
          if (url.includes("/watch")) {
            return {
              ok: true,
              text: async () =>
                `<script>var ytInitialPlayerResponse = ${JSON.stringify({
                  videoDetails: { videoId: "123" },
                  captions: {
                    playerCaptionsTracklistRenderer: {
                      captionTracks: [
                        {
                          baseUrl:
                            "https://www.youtube.com/api/timedtext?v=123",
                          languageCode: "en",
                          name: { simpleText: "English" }
                        }
                      ]
                    }
                  }
                })};</script>`
            }
          }
          return {
            ok: true,
            text: async () =>
              JSON.stringify({
                events: [{ tStartMs: 0, segs: [{ utf8: "Confirmed video" }] }]
              })
          }
        })
        vi.stubGlobal("fetch", fetchMock)

        const result = await getTranscript()

        expect(result).toBe("0:00 Confirmed video")
        const captionUrl = fetchMock.mock.calls
          .map(([url]) => String(url))
          .find((url) => url.includes("timedtext"))
        expect(captionUrl).toContain("v=123")
        expect(captionUrl).not.toContain("unverifiable")
      })

      it("discards a caption track whose url belongs to another video", async () => {
        // The track URL is what decides whose words arrive, so it is checked on
        // its own rather than trusted because the payload looked right.
        const script = document.createElement("script")
        script.textContent = `var ytInitialPlayerResponse = ${JSON.stringify({
          videoDetails: { videoId: "123" },
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [
                {
                  baseUrl:
                    "https://www.youtube.com/api/timedtext?v=other-video",
                  languageCode: "en",
                  name: { simpleText: "English" }
                }
              ]
            }
          }
        })};`
        document.head.appendChild(script)

        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          text: vi.fn().mockResolvedValue(
            JSON.stringify({
              events: [{ tStartMs: 0, segs: [{ utf8: "Wrong video" }] }]
            })
          )
        })
        vi.stubGlobal("fetch", fetchMock)

        const result = await getTranscript()

        expect(result).toBeNull()
        expect(
          fetchMock.mock.calls.filter(([url]) =>
            String(url).includes("timedtext")
          )
        ).toHaveLength(0)
      })

      it("uses the inline payload when it names the video being watched", async () => {
        const script = document.createElement("script")
        script.textContent = `var ytInitialPlayerResponse = ${JSON.stringify({
          videoDetails: { videoId: "123" },
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [
                {
                  baseUrl: "https://www.youtube.com/api/timedtext?v=123",
                  languageCode: "en",
                  name: { simpleText: "English" }
                }
              ]
            }
          }
        })};`
        document.head.appendChild(script)

        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          text: vi.fn().mockResolvedValue(
            JSON.stringify({
              events: [{ tStartMs: 0, segs: [{ utf8: "Inline line" }] }]
            })
          )
        })
        vi.stubGlobal("fetch", fetchMock)

        const result = await getTranscript()

        expect(result).toBe("0:00 Inline line")
        // Matching id means no extra document fetch: only the caption request.
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(String(fetchMock.mock.calls[0][0])).toContain("timedtext")
      })

      it("prefers captions in the reader's own language over the English track", async () => {
        const languageSpy = vi
          .spyOn(navigator, "language", "get")
          .mockReturnValue("de-AT")
        const script = document.createElement("script")
        script.textContent = `var ytInitialPlayerResponse = ${JSON.stringify({
          videoDetails: { videoId: "123" },
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [
                {
                  baseUrl:
                    "https://www.youtube.com/api/timedtext?v=123&lang=en",
                  languageCode: "en",
                  name: { simpleText: "English" }
                },
                {
                  baseUrl:
                    "https://www.youtube.com/api/timedtext?v=123&lang=de",
                  languageCode: "de",
                  name: { simpleText: "Deutsch" }
                }
              ]
            }
          }
        })};`
        document.head.appendChild(script)

        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          text: vi.fn().mockResolvedValue(
            JSON.stringify({
              events: [{ tStartMs: 0, segs: [{ utf8: "Guten Tag" }] }]
            })
          )
        })
        vi.stubGlobal("fetch", fetchMock)

        await getTranscript()

        expect(String(fetchMock.mock.calls[0][0])).toContain("lang=de")
        languageSpy.mockRestore()
      })

      it("falls back to the English track when none matches the reader", async () => {
        const languageSpy = vi
          .spyOn(navigator, "language", "get")
          .mockReturnValue("hi-IN")
        const script = document.createElement("script")
        script.textContent = `var ytInitialPlayerResponse = ${JSON.stringify({
          videoDetails: { videoId: "123" },
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [
                {
                  baseUrl:
                    "https://www.youtube.com/api/timedtext?v=123&lang=ja",
                  languageCode: "ja",
                  name: { simpleText: "日本語" }
                },
                {
                  baseUrl:
                    "https://www.youtube.com/api/timedtext?v=123&lang=en",
                  languageCode: "en",
                  name: { simpleText: "English" }
                }
              ]
            }
          }
        })};`
        document.head.appendChild(script)

        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          text: vi.fn().mockResolvedValue(
            JSON.stringify({
              events: [{ tStartMs: 0, segs: [{ utf8: "Hello" }] }]
            })
          )
        })
        vi.stubGlobal("fetch", fetchMock)

        await getTranscript()

        expect(String(fetchMock.mock.calls[0][0])).toContain("lang=en")
        languageSpy.mockRestore()
      })

      it("should extract transcript from modern YouTube transcript panel", async () => {
        const panel = document.createElement("yt-section-list-renderer")
        panel.setAttribute("data-target-id", "PAmodern_transcript_view")
        panel.innerHTML = `
          <transcript-segment-view-model>
            <div aria-hidden="true">0:00</div>
            <span class="ytAttributedStringHost" role="text">
              First transcript line.
            </span>
          </transcript-segment-view-model>
          <transcript-segment-view-model>
            <div aria-hidden="true">0:07</div>
            <span class="ytAttributedStringHost" role="text">
              Second transcript line.
            </span>
          </transcript-segment-view-model>
        `
        document.body.appendChild(panel)

        const result = await getTranscript()
        expect(result).toBe(
          "0:00 First transcript line.\n0:07 Second transcript line."
        )
      })

      it("should not infer timestamp from transcript text content", async () => {
        const panel = document.createElement("yt-section-list-renderer")
        panel.setAttribute("data-target-id", "PAmodern_transcript_view")
        panel.innerHTML = `
          <transcript-segment-view-model>
            <span class="ytAttributedStringHost" role="text">
              Finished in 1:30 after launch.
            </span>
          </transcript-segment-view-model>
        `
        document.body.appendChild(panel)

        const result = await getTranscript()
        expect(result).toBe("Finished in 1:30 after launch.")
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

      it("should open Udemy transcript tab before extracting cues", async () => {
        const transcriptTab = document.createElement("button")
        transcriptTab.setAttribute("role", "tab")
        transcriptTab.innerHTML = `<span class="ud-btn-label">Transcript</span>`
        transcriptTab.addEventListener("click", () => {
          if (document.querySelector('[data-purpose="transcript-panel"]')) {
            return
          }

          const panel = document.createElement("div")
          panel.setAttribute("data-purpose", "transcript-panel")
          panel.innerHTML = `
            <div class="transcript--cue-container--Vuwj6">
              <p data-purpose="transcript-cue-active" role="button">
                <span data-purpose="cue-text">All right, guys.</span>
              </p>
            </div>
            <div class="transcript--cue-container--Vuwj6">
              <p data-purpose="transcript-cue" role="button">
                <span data-purpose="cue-text">
                  So pending callbacks, the third phase.
                </span>
              </p>
            </div>
          `
          document.body.appendChild(panel)
        })
        document.body.appendChild(transcriptTab)

        const result = await getTranscript()
        expect(result).toBe(
          "All right, guys.\nSo pending callbacks, the third phase."
        )
      })

      it("should open Udemy transcript from icon-only toggle", async () => {
        const transcriptToggle = document.createElement("button")
        transcriptToggle.setAttribute("type", "button")
        transcriptToggle.setAttribute("data-purpose", "transcript-toggle")
        transcriptToggle.setAttribute("aria-expanded", "false")
        transcriptToggle.innerHTML = `
          <svg aria-label="Transcript in sidebar region" role="img">
            <use xlink:href="#icon-transcript"></use>
          </svg>
        `
        transcriptToggle.addEventListener("click", () => {
          const panel = document.createElement("div")
          panel.setAttribute("data-purpose", "transcript-panel")
          panel.innerHTML = `
            <div class="transcript--cue-container--Vuwj6">
              <p data-purpose="transcript-cue" role="button">
                <span data-purpose="cue-text">Icon toggle transcript.</span>
              </p>
            </div>
          `
          document.body.appendChild(panel)
        })
        document.body.appendChild(transcriptToggle)

        const result = await getTranscript()
        expect(result).toBe("Icon toggle transcript.")
      })

      it("should press Udemy icon-only transcript control with pointer events", async () => {
        const transcriptToggle = document.createElement("button")
        transcriptToggle.setAttribute("type", "button")
        transcriptToggle.setAttribute("aria-expanded", "false")
        transcriptToggle.innerHTML = `
          <svg aria-label="Transcript in sidebar region" role="img">
            <use xlink:href="#icon-transcript"></use>
          </svg>
        `
        transcriptToggle.addEventListener("mousedown", () => {
          const panel = document.createElement("div")
          panel.setAttribute("data-purpose", "transcript-panel")
          panel.innerHTML = `
            <div class="transcript--cue-container--Vuwj6">
              <p data-purpose="transcript-cue" role="button">
                <span data-purpose="cue-text">Pressed transcript.</span>
              </p>
            </div>
          `
          document.body.appendChild(panel)
        })
        document.body.appendChild(transcriptToggle)

        const result = await getTranscript()
        expect(result).toBe("Pressed transcript.")
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
