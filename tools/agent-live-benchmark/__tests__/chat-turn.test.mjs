import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  agentObservedText,
  chatAnswered,
  chatAnswerFromWire,
  chatToolText,
  sendChatTask,
  upstreamAuthorization,
  waitForChatState,
  withReasoningEffort
} from "../chat-turn.mjs"

/** A clock the wait advances, so a poll costs no real time. */
const fakeClock = () => {
  let at = 0
  return {
    now: () => at,
    wait: async (ms) => {
      at += ms
    }
  }
}

const idle = { busy: false, sendReady: true, goalTurns: 0 }
const busy = { busy: true, sendReady: false, goalTurns: 0 }

describe("waitForChatState", () => {
  it("needs the state to hold for the whole window, not one read", async () => {
    const clock = fakeClock()
    /** Idle for one read between two busy stretches, then idle for good. */
    const states = [busy, idle, busy, busy, idle, idle, idle, idle, idle]
    let reads = 0
    const held = await waitForChatState(
      async () => states[Math.min(reads++, states.length - 1)],
      (state) => !state.busy,
      { stableMs: 750, timeoutMs: 10_000, ...clock }
    )
    assert.equal(held, true)
    assert.equal(reads, 8)
  })

  it("gives up at the deadline", async () => {
    const clock = fakeClock()
    const held = await waitForChatState(
      async () => busy,
      (state) => !state.busy,
      { timeoutMs: 1_000, ...clock }
    )
    assert.equal(held, false)
  })
})

/** A panel whose composer records what was sent and the turn it produced. */
const fakePanel = (onEnter) => {
  const pressed = []
  return {
    pressed,
    getByPlaceholder: () => ({
      fill: async () => {},
      press: async (key) => {
        pressed.push(key)
        onEnter(pressed.length)
      }
    }),
    getByRole: () => ({ click: async () => {} })
  }
}

describe("sendChatTask", () => {
  it("reports a send the composer ignored as not started", async () => {
    const panel = fakePanel(() => {})
    const sent = await sendChatTask(panel, "goal", {
      idleMs: 0,
      startTimeoutMs: 0,
      read: async () => idle,
      log: () => {}
    })
    assert.deepEqual(sent, { started: false, attempts: 2 })
    assert.equal(panel.pressed.length, 2)
  })

  it("does not press Enter again once the goal's row appeared", async () => {
    let state = idle
    const panel = fakePanel(() => {
      state = { ...idle, goalTurns: 1 }
    })
    const sent = await sendChatTask(panel, "goal", {
      idleMs: 0,
      read: async () => state,
      log: () => {}
    })
    assert.deepEqual(sent, { started: true, attempts: 1 })
    assert.equal(panel.pressed.length, 1)
  })
})

describe("chatAnswerFromWire", () => {
  const sse = (...parts) =>
    parts
      .map(
        (content) =>
          `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
      )
      .join("") + "data: [DONE]\n\n"

  it("reads the last chat call, not an agent decision after it", () => {
    const chatTools = [{ function: { name: "browser_task" } }]
    const wire = [
      {
        path: "/v1/chat/completions",
        request: { tools: chatTools },
        response: sse("first")
      },
      {
        path: "/v1/chat/completions",
        request: { tools: chatTools },
        response: sse("Version ", "0.14.0")
      },
      {
        path: "/v1/chat/completions",
        request: { tools: [{ function: { name: "click" } }] },
        response: sse("agent")
      }
    ]
    assert.equal(chatAnswerFromWire(wire), "Version 0.14.0")
  })

  it("answers nothing when no chat call was recorded", () => {
    assert.equal(chatAnswerFromWire([]), "")
  })
})

describe("withReasoningEffort", () => {
  it("sets one effort on chat calls and leaves everything else alone", () => {
    const body = JSON.stringify({
      model: "codex/gpt-6-luna",
      reasoning: { effort: "high" }
    })
    assert.deepEqual(
      JSON.parse(withReasoningEffort("/v1/chat/completions", body, "medium")),
      { model: "codex/gpt-6-luna", reasoning_effort: "medium" }
    )
    assert.equal(withReasoningEffort("/v1/models", body, "medium"), body)
    assert.equal(withReasoningEffort("/v1/chat/completions", body, ""), body)
  })
})

describe("chatAnswered", () => {
  const chat = (response, elapsedMs) => ({
    path: "/v1/chat/completions",
    request: { tools: [{ function: { name: "browser_task" } }] },
    response,
    elapsedMs
  })

  it("waits out a chat whose last call asked for a tool", () => {
    assert.equal(
      chatAnswered([chat('"finish_reason":"tool_calls"', 900)]),
      false
    )
    assert.equal(
      chatAnswered([chat('"finish_reason":"stop"', undefined)]),
      false
    )
    assert.equal(chatAnswered([chat('"finish_reason":"stop"', 900)]), true)
  })
})

describe("chatToolText", () => {
  it("collects only what page-reading tools returned", () => {
    const wire = [
      {
        path: "/v1/chat/completions",
        request: {
          tools: [{ function: { name: "browser_task" } }],
          messages: [
            { role: "user", content: "read it" },
            {
              role: "assistant",
              tool_calls: [
                { id: "c1", function: { name: "current_tab" } },
                { id: "c2", function: { name: "browser_task" } },
                { id: "c3", function: { name: "read_tab" } }
              ]
            },
            {
              role: "tool",
              tool_call_id: "c1",
              content: "Reference code: QP-719"
            },
            { role: "tool", tool_call_id: "c2", content: "Found ZX-482" },
            { role: "tool", tool_call_id: "c3", content: "Status code: ZX-482" }
          ]
        }
      }
    ]
    assert.equal(
      chatToolText(wire),
      "Reference code: QP-719\nStatus code: ZX-482"
    )
  })
})

describe("agentObservedText", () => {
  it("collects the visible text each decision request carried", () => {
    const decision = (content) => ({
      path: "/v1/chat/completions",
      request: {
        tools: [{ function: { name: "agent_decision" } }],
        messages: [
          { role: "system", content: "Status code: ZX-999" },
          { role: "user", content }
        ]
      }
    })
    const wire = [
      decision(
        JSON.stringify({
          task: "Report QP-000",
          observation: { text: "Reference code: QP-719" }
        })
      ),
      decision(
        JSON.stringify({ observation: { documentText: "Status code: ZX-482" } })
      ),
      decision("not json"),
      {
        path: "/v1/chat/completions",
        request: {
          tools: [{ function: { name: "not_agent_decision" } }],
          messages: [
            {
              role: "user",
              content: JSON.stringify({ observation: { text: "QP-000" } })
            }
          ]
        }
      },
      {
        path: "/v1/chat/completions",
        request: {
          tools: [{ function: { name: "browser_task" } }],
          messages: [{ role: "user", content: "Status code: ZX-482" }]
        }
      }
    ]
    assert.equal(
      agentObservedText(wire),
      "Reference code: QP-719\nStatus code: ZX-482"
    )
  })
})

describe("upstreamAuthorization", () => {
  it("sends a key only over https or to loopback", () => {
    assert.deepEqual(upstreamAuthorization("http://example.com", ""), {})
    assert.deepEqual(upstreamAuthorization("https://openrouter.ai/api", "k"), {
      Authorization: "Bearer k"
    })
    assert.deepEqual(upstreamAuthorization("http://127.0.0.1:8084", "k"), {
      Authorization: "Bearer k"
    })
    assert.throws(() => upstreamAuthorization("http://example.com", "k"))
  })
})
