import { describe, expect, it } from "vitest"
import {
  AGENT_CONTEXT_AUTO_MAX_TOKENS,
  AGENT_CONTEXT_FALLBACK_TOKENS,
  AGENT_CONTEXT_MAX_TOKENS,
  AGENT_CONTEXT_MIN_TOKENS,
  resolveAgentContextWindow
} from "../agent-context-window"

const details = (input: {
  parameters?: string
  model_info?: Record<string, unknown>
}) => input

describe("resolveAgentContextWindow", () => {
  it("falls back to what the agent has always been able to reach", () => {
    /**
     * Not a cautious guess: it is the window every shipped run of this agent
     * has used. Setting it lower halved the page budget for the models that
     * report nothing — most hosted ones — and a browser gate caught the run
     * re-reading a page it had already found its control on.
     */
    expect(resolveAgentContextWindow({})).toEqual({
      tokens: AGENT_CONTEXT_FALLBACK_TOKENS,
      source: "fallback"
    })
    expect(AGENT_CONTEXT_FALLBACK_TOKENS).toBe(AGENT_CONTEXT_AUTO_MAX_TOKENS)
  })

  it("takes the smallest window it was told, not the largest", () => {
    /**
     * The three sources answer three different questions — what this server
     * allocated, what the weights allow, what the catalog advertises — and a
     * run has to fit inside every answer it got.
     */
    expect(
      resolveAgentContextWindow({
        evidence: {
          catalogContextLength: 131_072,
          details: details({
            parameters: "num_ctx 8192\nstop <|end|>",
            model_info: { "qwen3.context_length": 32_768 }
          })
        }
      })
    ).toEqual({ tokens: 8_192, source: "allocated" })
  })

  it("reads an architecture-prefixed context length from model_info", () => {
    expect(
      resolveAgentContextWindow({
        evidence: {
          details: details({ model_info: { "llama.context_length": 16_384 } })
        }
      })
    ).toEqual({ tokens: 16_384, source: "metadata" })
  })

  it("keeps the catalog's figure when it is the only one", () => {
    expect(
      resolveAgentContextWindow({ evidence: { catalogContextLength: 24_576 } })
    ).toEqual({ tokens: 24_576, source: "catalog" })
  })

  it("holds automatic resolution below the automatic maximum", () => {
    /**
     * A model is believed about its own capacity and still held here: the
     * memory is this machine's to spend, and nothing in a catalog knows how
     * much of it there is.
     */
    expect(
      resolveAgentContextWindow({
        evidence: { catalogContextLength: 1_000_000 }
      })
    ).toEqual({ tokens: AGENT_CONTEXT_AUTO_MAX_TOKENS, source: "catalog" })
  })

  it("lets an explicit setting override the model in both directions", () => {
    /**
     * A user who raised their server's own num_ctx knows something no catalog
     * does, and one who has hit an out-of-memory failure knows something the
     * metadata does not.
     */
    expect(
      resolveAgentContextWindow({
        setting: 131_072,
        evidence: { catalogContextLength: 8_192 }
      })
    ).toEqual({ tokens: 131_072, source: "user" })
    expect(
      resolveAgentContextWindow({
        setting: 8_192,
        evidence: { catalogContextLength: 131_072 }
      })
    ).toEqual({ tokens: 8_192, source: "user" })
  })

  it("refuses a setting smaller than a window has to be, or larger than the cap", () => {
    expect(resolveAgentContextWindow({ setting: 512 }).tokens).toBe(
      AGENT_CONTEXT_MIN_TOKENS
    )
    expect(resolveAgentContextWindow({ setting: 5_000_000 }).tokens).toBe(
      AGENT_CONTEXT_MAX_TOKENS
    )
  })

  it("ignores a malformed reported window rather than reading it as a small one", () => {
    expect(
      resolveAgentContextWindow({
        evidence: {
          details: details({
            parameters: "num_ctx not-a-number",
            model_info: { "llama.context_length": "many" }
          })
        }
      })
    ).toEqual({ tokens: AGENT_CONTEXT_FALLBACK_TOKENS, source: "fallback" })
  })

  it("takes the last num_ctx a Modelfile states, as a Modelfile does", () => {
    expect(
      resolveAgentContextWindow({
        evidence: {
          details: details({ parameters: "num_ctx 8192\nnum_ctx 16384" })
        }
      })
    ).toEqual({ tokens: 16_384, source: "allocated" })
  })
})
