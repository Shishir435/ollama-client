import { describe, expect, it, vi } from "vitest"
import type { ChatMessage } from "@/types"
import {
  type ErrorRecoveryContext,
  RECOVERY_ACTION_MAX_AGE_MS,
  resolveErrorRecoveryActions
} from "../error-recovery-actions"
import { hasPartialOutput } from "../partial-output"
import { hasConsequentialToolEffects } from "../retry-safety"

const context = (
  overrides: Partial<ErrorRecoveryContext> = {}
): ErrorRecoveryContext => ({
  error: {},
  openSettings: vi.fn(),
  ageMs: 0,
  ...overrides
})

const ids = (value: ErrorRecoveryContext) =>
  resolveErrorRecoveryActions(value).map((action) => action.id)

describe("failed-turn recovery actions", () => {
  it.each([
    ["a 5xx from the server", { status: 503, code: "OLC-PROVIDER-HTTP" }],
    [
      "an unreachable server",
      { code: "OLC-PROVIDER-UNREACHABLE", recoveryAction: "test-connection" }
    ],
    [
      "a stream that broke part-way",
      { code: "OLC-STREAM-DROPPED", phase: "read-stream" }
    ],
    ["an error with no classification at all", {}]
  ] as const)("offers Retry for %s", (_name, error) => {
    expect(ids(context({ error: { ...error }, retry: vi.fn() }))).toContain(
      "retry-turn"
    )
  })

  it("keeps Retry available long after the failure", () => {
    const threeDays = 3 * 24 * 60 * 60 * 1000
    expect(threeDays).toBeGreaterThan(RECOVERY_ACTION_MAX_AGE_MS)

    expect(
      ids(context({ error: { status: 500 }, retry: vi.fn(), ageMs: threeDays }))
    ).toContain("retry-turn")
  })

  it("offers no Retry when the turn cannot be safely repeated", () => {
    expect(
      ids(context({ error: { status: 500 }, retry: undefined }))
    ).not.toContain("retry-turn")
  })

  it("holds Retry for a provider's back-off, not for the whole failure", () => {
    const [retry] = resolveErrorRecoveryActions(
      context({
        error: { recoveryAction: "wait-retry", retryAfterMs: 5_000 },
        retry: vi.fn()
      })
    )

    expect(retry.id).toBe("retry-turn")
    expect(
      retry.cooldownMs?.(
        context({
          error: { recoveryAction: "wait-retry", retryAfterMs: 5_000 }
        })
      )
    ).toBe(5_000)
  })

  it("offers Continue beside Retry when the answer kept partial text", () => {
    const run = vi.fn()
    const actions = resolveErrorRecoveryActions(
      context({
        error: { code: "OLC-STREAM-DROPPED" },
        retry: vi.fn(),
        continueTurn: run
      })
    )

    expect(actions.map((action) => action.id)).toEqual([
      "retry-turn",
      "continue-turn"
    ])
    actions[1].run(context({ continueTurn: run }))
    expect(run).toHaveBeenCalledOnce()
  })

  it("offers no Continue without a partial answer to resume", () => {
    expect(ids(context({ retry: vi.fn() }))).not.toContain("continue-turn")
  })

  it("sends a missing model to settings before anything else", () => {
    expect(
      ids(
        context({ error: { recoveryAction: "choose-model" }, retry: vi.fn() })
      )
    ).toEqual(["open-settings-first", "retry-turn"])
  })

  it("shows the settings chip once for a missing model when Retry is withheld", () => {
    expect(ids(context({ error: { recoveryAction: "choose-model" } }))).toEqual(
      ["open-settings-first"]
    )
  })

  it("keeps the settings fix reachable beside Retry for a connection failure", () => {
    expect(
      ids(
        context({
          error: { recoveryAction: "test-connection" },
          retry: vi.fn()
        })
      )
    ).toEqual(["retry-turn", "open-settings"])
  })

  it("still expires the in-place provider enable, which changes configuration", () => {
    const failure = {
      recoveryAction: "enable-provider",
      providerId: "ollama"
    } as const

    expect(ids(context({ error: failure, retry: vi.fn() }))[0]).toBe(
      "enable-provider-inline"
    )
    expect(
      ids(
        context({
          error: failure,
          retry: vi.fn(),
          ageMs: RECOVERY_ACTION_MAX_AGE_MS + 1
        })
      )
    ).not.toContain("enable-provider-inline")
  })
})

const message = (overrides: Partial<ChatMessage>): ChatMessage => ({
  role: "assistant",
  content: "",
  ...overrides
})

describe("hasPartialOutput", () => {
  it("is true when text the model wrote stayed beside the failure", () => {
    expect(
      hasPartialOutput(
        message({
          content: "The first half of the answer",
          error: { userMessage: "The stream dropped." }
        })
      )
    ).toBe(true)
  })

  it("is false when the body is only the failure's own explanation", () => {
    expect(
      hasPartialOutput(
        message({
          content: "Can't reach Ollama.",
          error: { userMessage: "Can't reach Ollama." }
        })
      )
    ).toBe(false)
  })

  it("is false when the body is a failure's raw message, as stored without a userMessage", () => {
    expect(
      hasPartialOutput(
        message({
          content: "upstream error",
          error: { message: "upstream error" }
        })
      )
    ).toBe(false)
  })

  it("is false for a message that did not fail", () => {
    expect(hasPartialOutput(message({ content: "A complete answer" }))).toBe(
      false
    )
  })
})

describe("hasConsequentialToolEffects", () => {
  const run = (
    toolId: string,
    status: string,
    risk?: "low" | "medium" | "high" | "critical"
  ) => ({
    toolId,
    label: toolId,
    ...(risk ? { risk } : {}),
    status: status as "done",
    startedAt: 1
  })
  const ran = (...toolRuns: ReturnType<typeof run>[]) =>
    hasConsequentialToolEffects(message({ metrics: { toolRuns } }))

  it("flags a high-risk tool that ran, or may have", () => {
    for (const status of ["done", "running", "error"]) {
      expect(ran(run("mcp:send", status, "high"))).toBe(true)
    }
  })

  it.each(["save_artifact", "schedule_reminder", "restore_session"])(
    "flags %s, which changes state outside the chat at medium risk",
    (toolId) => {
      expect(ran(run(toolId, "done", "medium"))).toBe(true)
    }
  )

  it("flags a tool with no declared risk, or one it does not know", () => {
    expect(ran(run("mcp:create_ticket", "done"))).toBe(true)
    expect(ran(run("some_new_tool", "done", "low"))).toBe(true)
  })

  it("ignores a call that never started, and tools known to be read-only", () => {
    expect(
      ran(
        run("mcp:send", "awaiting-confirmation", "critical"),
        run("save_artifact", "pending", "medium"),
        run("read_tab", "done", "low"),
        run("web_search", "error", "medium"),
        run("rag_search", "done")
      )
    ).toBe(false)
    expect(hasConsequentialToolEffects(message({}))).toBe(false)
  })

  it("ignores a call the user declined, but not one that failed after running", () => {
    const declined = {
      ...run("save_artifact", "error", "medium"),
      declined: true
    }
    expect(ran(declined)).toBe(false)
    expect(ran(declined, run("save_artifact", "error", "medium"))).toBe(true)
    const ranThenRefused = { ...declined, executed: true }
    expect(ran(ranThenRefused)).toBe(true)
  })
})
