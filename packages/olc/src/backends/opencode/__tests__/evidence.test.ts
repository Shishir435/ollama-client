import { describe, expect, it } from "vitest"
import {
  collectOpencodeSources,
  MAX_OPENCODE_SOURCES,
  readOpencodeFailureStatus,
  readOpencodeUsage,
  readSearchOutput
} from "../evidence.js"

/**
 * The `step-finish` part a live OpenCode 1.18.31 session stored for one model
 * call (local qwen3.5 through Ollama), with cache and reasoning filled in.
 */
const stepFinish = (tokens: Record<string, unknown>, cost = 0) => ({
  type: "step-finish",
  reason: "stop",
  tokens,
  cost
})

const assistant = (parts: unknown[], info: Record<string, unknown> = {}) => ({
  info: { role: "assistant", ...info },
  parts
})

/** Exa's text result format, with a link quoted inside a result body. */
const EXA_OUTPUT = `Title: Node.js — Node.js 24.21.0 (LTS)
URL: https://nodejs.org/en/blog/release/v24.21.0
Published Date: 2026-09-08
Text: Other release files: https://nodejs.org/dist/v24.21.0/

Title: Node.js Releases
URL: https://nodejs.org/en/about/previous-releases
Text: Major Node.js versions enter Current release status`

describe("OpenCode usage", () => {
  it("adds back what OpenCode splits out of input and output", () => {
    const usage = readOpencodeUsage([
      assistant([
        stepFinish(
          {
            input: 200,
            output: 50,
            reasoning: 30,
            cache: { read: 8000, write: 100 }
          },
          0.002
        )
      ])
    ])
    expect(usage).toEqual({
      promptTokens: 8300,
      completionTokens: 80,
      cachedPromptTokens: 8000,
      reasoningTokens: 30,
      cost: 0.002
    })
  })

  it("sums every step across the session's assistant messages", () => {
    const step = stepFinish({ input: 100, output: 10, cache: {} })
    expect(
      readOpencodeUsage([
        { info: { role: "user" }, parts: [step] },
        assistant([step, step]),
        assistant([step])
      ])
    ).toEqual({ promptTokens: 300, completionTokens: 30 })
  })

  it("falls back to the message's own tokens when no step has finished", () => {
    expect(
      readOpencodeUsage([
        assistant([], {
          tokens: { input: 8194, output: 98, reasoning: 0, cache: {} },
          cost: 0
        })
      ])
    ).toEqual({ promptTokens: 8194, completionTokens: 98 })
  })
})

describe("OpenCode search output", () => {
  it("reads Exa's result fields and ignores links quoted in a body", () => {
    expect(readSearchOutput(EXA_OUTPUT)).toEqual([
      {
        url: "https://nodejs.org/en/blog/release/v24.21.0",
        title: "Node.js — Node.js 24.21.0 (LTS)"
      },
      {
        url: "https://nodejs.org/en/about/previous-releases",
        title: "Node.js Releases"
      }
    ])
  })

  it("reads a JSON result list, whatever order its keys are in", () => {
    const output = JSON.stringify({
      results: [
        {
          url: "https://a.example/one",
          title: "One",
          excerpts: ["see https://b.example"]
        },
        { title: "Two", url: "https://a.example/two" }
      ]
    })
    expect(readSearchOutput(output)).toEqual([
      { url: "https://a.example/one", title: "One" },
      { url: "https://a.example/two", title: "Two" }
    ])
  })

  it("yields nothing from text in neither shape", () => {
    expect(
      readSearchOutput("Some prose mentioning https://example.com in passing.")
    ).toEqual([])
  })
})

describe("OpenCode sources", () => {
  const tool = (name: string, state: Record<string, unknown>) => ({
    type: "tool",
    tool: name,
    state
  })

  it("lists fetched pages before search hits, deduplicated", () => {
    expect(
      collectOpencodeSources([
        assistant([
          tool("websearch", { status: "completed", output: EXA_OUTPUT }),
          tool("webfetch", {
            status: "completed",
            input: { url: "https://nodejs.org/en/blog/release/v24.21.0" },
            output: "# Node.js 24.21.0"
          })
        ])
      ])
    ).toEqual([
      {
        url: "https://nodejs.org/en/blog/release/v24.21.0",
        title: "Node.js — Node.js 24.21.0 (LTS)"
      },
      {
        url: "https://nodejs.org/en/about/previous-releases",
        title: "Node.js Releases"
      }
    ])
  })

  it("skips tool calls that did not complete and tools that read no web", () => {
    expect(
      collectOpencodeSources([
        assistant([
          tool("webfetch", {
            status: "error",
            input: { url: "https://down.example" },
            error: "fetch failed"
          }),
          tool("read", {
            status: "completed",
            output: "URL: https://x.example"
          })
        ])
      ])
    ).toEqual([])
  })

  it("caps the list", () => {
    const fetches = Array.from({ length: 20 }, (_, index) =>
      tool("webfetch", {
        status: "completed",
        input: { url: `https://example.com/${index}` }
      })
    )
    expect(collectOpencodeSources([assistant(fetches)])).toHaveLength(
      MAX_OPENCODE_SOURCES
    )
  })
})

describe("OpenCode failures", () => {
  it("reads the upstream status and Retry-After from an APIError", () => {
    expect(
      readOpencodeFailureStatus({
        name: "APIError",
        data: {
          message: "Rate limit exceeded",
          statusCode: 429,
          isRetryable: true,
          responseHeaders: { "Retry-After": "30" }
        }
      })
    ).toEqual({ status: 429, retryAfterSeconds: 30 })
  })

  it("claims nothing for an error that carries no status", () => {
    expect(
      readOpencodeFailureStatus({
        name: "UnknownError",
        data: { message: "boom" }
      })
    ).toEqual({})
  })
})
