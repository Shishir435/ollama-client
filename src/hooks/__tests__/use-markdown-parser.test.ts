// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const parserBuilds = vi.hoisted(() => ({ count: 0 }))

vi.mock("markdown-it", async (importOriginal) => {
  const actual = await importOriginal<typeof import("markdown-it")>()
  const Actual = actual.default as unknown as new (...args: any[]) => any
  class Tracked extends Actual {
    constructor(...args: any[]) {
      super(...args)
      parserBuilds.count += 1
    }
  }
  return { ...actual, default: Tracked }
})

import { useMarkdownParser } from "../use-markdown-parser"

/**
 * Render the hook while recording every distinct html value it produced, so a
 * test can count parses rather than only inspect the latest one.
 */
const renderParser = (initial: string) => {
  const seen: string[] = []
  const view = renderHook(
    ({ markdown }) => {
      const html = useMarkdownParser(markdown)
      if (seen[seen.length - 1] !== html) seen.push(html)
      return html
    },
    { initialProps: { markdown: initial } }
  )
  return { ...view, seen }
}

const stream = (length: number) => `token${"x".repeat(length)}`

describe("useMarkdownParser", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("parses static content on the first render with no deferred work", () => {
    const { result, seen } = renderParser("# Title")

    expect(result.current).toContain("<h1>Title</h1>")
    expect(seen).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("coalesces a burst of streamed updates into a single trailing parse", () => {
    const { seen, rerender } = renderParser(stream(0))

    for (let step = 1; step <= 20; step += 1) {
      rerender({ markdown: stream(step) })
      act(() => {
        vi.advanceTimersByTime(5)
      })
    }

    expect(seen).toHaveLength(1)
    expect(seen[0]).toBe("<p>token</p>\n")
  })

  it("renders the final content exactly once after changes stop", () => {
    const { result, seen, rerender } = renderParser(stream(0))

    for (let step = 1; step <= 20; step += 1) {
      rerender({ markdown: stream(step) })
      act(() => {
        vi.advanceTimersByTime(5)
      })
    }

    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(seen).toHaveLength(2)
    expect(seen[1]).toContain(stream(20))
    expect(result.current).toContain(stream(20))
    expect(vi.getTimerCount()).toBe(0)

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(seen).toHaveLength(2)
  })

  it("never leaves a settled message on an intermediate parse", () => {
    const { result, rerender } = renderParser("partial answ")

    rerender({ markdown: "partial answer" })
    rerender({ markdown: "partial answer." })
    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(result.current).toContain("partial answer.")
    expect(result.current).not.toContain("partial answ<")
  })

  it("renders immediately when a change arrives after an idle gap", () => {
    const { seen, rerender } = renderParser("first")

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    rerender({ markdown: "second" })

    expect(seen).toHaveLength(2)
    expect(seen[1]).toContain("second")
    expect(vi.getTimerCount()).toBe(0)
  })

  it("drops a pending trailing parse on unmount", () => {
    const { rerender, unmount } = renderParser("a")

    rerender({ markdown: "ab" })
    expect(vi.getTimerCount()).toBe(1)

    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("configures one MarkdownIt instance for every renderer", () => {
    renderParser("one")
    renderParser("two")

    expect(parserBuilds.count).toBe(1)
  })
})
