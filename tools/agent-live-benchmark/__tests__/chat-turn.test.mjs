import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { sendChatTask, waitForChatState } from "../chat-turn.mjs"

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
