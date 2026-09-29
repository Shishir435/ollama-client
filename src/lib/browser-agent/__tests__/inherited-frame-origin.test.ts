import { describe, expect, it } from "vitest"

import {
  frameAccessUrl,
  httpOrigin,
  inheritsFrameOrigin
} from "../inherited-frame-origin"

describe("inherited frame origins", () => {
  it("names the documents that inherit", () => {
    expect(inheritsFrameOrigin("about:srcdoc")).toBe(true)
    expect(inheritsFrameOrigin("about:blank")).toBe(true)
    expect(inheritsFrameOrigin("https://example.com/")).toBe(false)
    expect(inheritsFrameOrigin("data:text/html,x")).toBe(false)
  })

  it("accepts only an http(s) origin, never an opaque one", () => {
    expect(httpOrigin("https://example.com")).toBe("https://example.com")
    expect(httpOrigin("null")).toBeUndefined()
    expect(httpOrigin(undefined)).toBeUndefined()
    expect(httpOrigin("chrome-extension://abc")).toBeUndefined()
  })

  it("judges an inheriting frame by its nearest addressed ancestor", async () => {
    const frames = new Map([
      [0, { url: "https://example.com/page", parentFrameId: -1 }],
      [2, { url: "about:blank", parentFrameId: 0 }]
    ])
    const parentOf = async (id: number) => frames.get(id)
    await expect(
      frameAccessUrl({ url: "about:srcdoc", parentFrameId: 2 }, parentOf)
    ).resolves.toBe("https://example.com/page")
    await expect(
      frameAccessUrl(
        { url: "https://ads.example/x", parentFrameId: 0 },
        parentOf
      )
    ).resolves.toBe("https://ads.example/x")
  })

  it("reaches an addressed root four inheriting levels below it", async () => {
    const frames = new Map<number, { url: string; parentFrameId: number }>([
      [0, { url: "https://example.com/page", parentFrameId: -1 }],
      [1, { url: "about:blank", parentFrameId: 0 }],
      [2, { url: "about:srcdoc", parentFrameId: 1 }],
      [3, { url: "about:blank", parentFrameId: 2 }]
    ])

    await expect(
      frameAccessUrl({ url: "about:srcdoc", parentFrameId: 3 }, async (id) =>
        frames.get(id)
      )
    ).resolves.toBe("https://example.com/page")
  })

  it("answers with the frame's own address when the chain never reaches one", async () => {
    await expect(
      frameAccessUrl(
        { url: "about:srcdoc", parentFrameId: 9 },
        async () => null
      )
    ).resolves.toBe("about:srcdoc")
  })
})
