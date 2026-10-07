import {
  AGENT_RUN_ACTIVE_BUDGET_MS,
  AGENT_STEP_ACTIVE_BUDGET_MS,
  initialAgentDeadlineState
} from "@ollama-client/agent-runtime"
import type { AgentRunState } from "@ollama-client/contracts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createAppError } from "@/lib/error-utils"
import { AgentDecisionFormatError } from "../agent-decision-parser"
import { AgentModelCompatibilityError } from "../agent-model-compatibility"
import {
  classifyAgentModelFailure,
  runAgentModelRequest
} from "../agent-model-retry"

const state: AgentRunState = {
  version: 1,
  id: "retry-run",
  goal: "Read",
  status: "deciding",
  stepCount: 0,
  observationCount: 1,
  controlledTabId: 7,
  providerId: "custom:chosen",
  modelId: "model",
  allowedOrigins: ["https://example.com"],
  createdAt: 1,
  updatedAt: 1
}
const transient = (status = 503, retryAfterMs?: number) =>
  createAppError("private provider body", {
    kind: "provider",
    status,
    retryAfterMs,
    retryable: true,
    userMessage: "The service is temporarily unavailable."
  })

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("inference failure classification", () => {
  it.each([
    [new AgentDecisionFormatError("bad"), "malformed"],
    [new AgentModelCompatibilityError("unsupported"), "capability"],
    [createAppError("refused", { code: "OLC-MODEL-REFUSED" }), "refusal"],
    [
      createAppError("auth", { status: 401, retryable: true }),
      "authentication"
    ],
    [
      createAppError("CORS", { status: 403, retryable: true }),
      "authentication"
    ],
    [
      createAppError("too large", {
        status: 503,
        code: "OLC-CONTEXT-TOO-LARGE",
        retryable: true
      }),
      "configuration"
    ],
    [
      createAppError("image", {
        code: "OLC-INPUT-UNSUPPORTED",
        retryable: true
      }),
      "capability"
    ],
    [createAppError("invalid", { status: 400 }), "configuration"],
    [transient(429), "rate_limit"],
    [transient(503), "service"],
    [
      createAppError("offline", { kind: "network", retryable: true }),
      "transport"
    ],
    [new DOMException("stopped", "AbortError"), "cancelled"],
    [new Error("untyped failure"), "unknown"]
  ])("classifies %s as %s", (error, kind) => {
    expect(classifyAgentModelFailure(error)).toBe(kind)
  })
})

describe("bounded model retries", () => {
  it("honors provider guidance, then succeeds with measured backoff", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(transient(429, 2_000))
      .mockResolvedValue("answer")
    const measured = vi.fn()
    const pending = runAgentModelRequest({
      state,
      signal: new AbortController().signal,
      malformedRetries: 2,
      request,
      measured
    })
    await vi.advanceTimersByTimeAsync(1_999)
    expect(request).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toBe("answer")
    expect(measured).toHaveBeenCalledWith({
      providerRetries: 1,
      providerBackoffMs: 2_000
    })
    expect(vi.getTimerCount()).toBe(0)
  })

  it("does not reset the provider retry counter after malformed output", async () => {
    const failure = transient()
    const request = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockRejectedValueOnce(new AgentDecisionFormatError("bad"))
      .mockRejectedValueOnce(failure)
      .mockRejectedValue(failure)
    const pending = runAgentModelRequest({
      state,
      signal: new AbortController().signal,
      malformedRetries: 2,
      request
    })
    const rejected = expect(pending).rejects.toBe(failure)
    await vi.runAllTimersAsync()
    await rejected
    expect(request).toHaveBeenCalledTimes(4)
    expect(request.mock.calls[2][1]).toBeInstanceOf(AgentDecisionFormatError)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    createAppError("auth", { status: 401, retryable: true }),
    createAppError("auth", { status: 403, retryable: true }),
    createAppError("disabled", {
      kind: "validation",
      code: "OLC-PROVIDER-DISABLED"
    }),
    createAppError("no model", {
      status: 503,
      code: "OLC-MODEL-NOT-FOUND",
      retryable: true
    }),
    createAppError("refused", { code: "OLC-MODEL-REFUSED", retryable: true }),
    createAppError("permanent", { status: 503, retryable: false }),
    new Error("unknown")
  ])("does not retry a permanent or untyped failure: %s", async (error) => {
    const request = vi.fn().mockRejectedValue(error)
    await expect(
      runAgentModelRequest({
        state,
        signal: new AbortController().signal,
        malformedRetries: 2,
        request
      })
    ).rejects.toBe(error)
    expect(request).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("cancels during backoff without starting another request or leaving a timer", async () => {
    const owner = new AbortController()
    const request = vi.fn().mockRejectedValue(transient())
    const measured = vi.fn()
    const pending = runAgentModelRequest({
      state,
      signal: owner.signal,
      malformedRetries: 2,
      request,
      measured
    })
    const rejected = expect(pending).rejects.toThrow("cancelled")
    await vi.advanceTimersByTimeAsync(100)
    owner.abort()
    await rejected
    await vi.advanceTimersByTimeAsync(10_000)
    expect(request).toHaveBeenCalledOnce()
    expect(measured).toHaveBeenCalledWith({
      providerRetries: 0,
      providerBackoffMs: 100
    })
    expect(vi.getTimerCount()).toBe(0)
  })

  it("does not send anything for a cancelled owner", async () => {
    const owner = new AbortController()
    owner.abort()
    const request = vi.fn()
    await expect(
      runAgentModelRequest({
        state,
        signal: owner.signal,
        malformedRetries: 2,
        request
      })
    ).rejects.toThrow("cancelled")
    expect(request).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    "run",
    "step"
  ] as const)("honors the remaining %s ceiling rather than granting a fresh decision timeout", async (kind) => {
    const now = Date.now()
    const deadline = initialAgentDeadlineState(now)
    if (kind === "run")
      deadline.runStartedAt -= AGENT_RUN_ACTIVE_BUDGET_MS - 300
    else deadline.stepStartedAt -= AGENT_STEP_ACTIVE_BUDGET_MS - 300
    const failure = transient(503, 1_000)
    const request = vi.fn().mockRejectedValue(failure)
    await expect(
      runAgentModelRequest({
        state: { ...state, deadline },
        signal: new AbortController().signal,
        malformedRetries: 2,
        request
      })
    ).rejects.toBe(failure)
    expect(request).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("never retries earlier than Retry-After when guidance cannot fit", async () => {
    const failure = transient(429, 120_000)
    const request = vi.fn().mockRejectedValue(failure)
    await expect(
      runAgentModelRequest({
        state,
        signal: new AbortController().signal,
        malformedRetries: 2,
        request
      })
    ).rejects.toBe(failure)
    expect(request).toHaveBeenCalledOnce()
  })

  it.each([
    "owner",
    "deadline"
  ] as const)("normalizes a typed stream failure after %s cancellation", async (cause) => {
    const owner = new AbortController()
    const request = vi.fn(
      async (signal: AbortSignal) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(transient()), {
            once: true
          })
        })
    )
    const pending = runAgentModelRequest({
      state,
      signal: owner.signal,
      malformedRetries: 2,
      request
    })
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError"
    })
    if (cause === "owner") owner.abort()
    else await vi.runAllTimersAsync()
    await rejected
    expect(request).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("treats an elapsed deadline as cancellation even before its timer fires", async () => {
    const request = vi.fn(async () => {
      vi.setSystemTime(Date.now() + 120_000)
      throw transient()
    })
    await expect(
      runAgentModelRequest({
        state,
        signal: new AbortController().signal,
        malformedRetries: 2,
        request
      })
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(request).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("aborts a request at the common deadline after time already spent waiting", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(transient())
      .mockImplementation(
        async (signal: AbortSignal) =>
          new Promise((resolve) =>
            signal.addEventListener("abort", () => resolve("late answer"), {
              once: true
            })
          )
      )
    const pending = runAgentModelRequest({
      state,
      signal: new AbortController().signal,
      malformedRetries: 2,
      request
    })
    const rejected = expect(pending).rejects.toThrow("cancelled")
    await vi.advanceTimersByTimeAsync(120_000)
    await rejected
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[1][0].aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})
