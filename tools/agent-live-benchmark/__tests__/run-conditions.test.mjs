import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import {
  agentLocalSettings,
  parseContextWindow,
  runConditions
} from "../run-conditions.mjs"

test("AUDIT_CONTEXT_WINDOW is auto, an in-range integer, or unset", () => {
  assert.equal(parseContextWindow(undefined), undefined)
  assert.equal(parseContextWindow(""), undefined)
  assert.equal(parseContextWindow("  "), undefined)
  assert.equal(parseContextWindow("auto"), "auto")
  assert.equal(parseContextWindow("32768"), 32768)
  assert.equal(parseContextWindow(" 8192 "), 8192)
  assert.equal(parseContextWindow("131072"), 131072)
  for (const bad of ["8191", "131073", "-1", "1e5", "32k", "0", "Auto", "1.5"])
    assert.throws(() => parseContextWindow(bad), /AUDIT_CONTEXT_WINDOW/, bad)
})

test("the context window is seeded as the storage layer holds it, only when asked for", () => {
  assert.deepEqual(agentLocalSettings(), {
    "agent-enabled-v1": "true",
    "agent-permission-mode-v1": '"allow_routine"'
  })
  assert.deepEqual(agentLocalSettings({ contextWindow: 65536 }), {
    "agent-enabled-v1": "true",
    "agent-permission-mode-v1": '"allow_routine"',
    "agent-context-window-v1": "65536"
  })
  assert.equal(
    agentLocalSettings({ contextWindow: "auto" })["agent-context-window-v1"],
    '"auto"'
  )
})

test("the seeded keys are the extension's registered keys", () => {
  const keys = readFileSync(
    join(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../.."),
      "src/lib/constants/keys.ts"
    ),
    "utf8"
  )
  for (const key of Object.keys(agentLocalSettings({ contextWindow: 8192 })))
    assert.ok(keys.includes(`"${key}"`), key)
})

test("an explicit window is recorded as resolved; auto is recorded as not exposed", () => {
  assert.deepEqual(
    runConditions({ contextWindow: 65536, approvalScope: "task_origins" }),
    {
      approvalPolicy: {
        mode: "automatic",
        decision: "approve",
        scope: "task_origins",
        outOfScope: "unanswered"
      },
      agentContextWindow: {
        setting: 65536,
        applied: "AUDIT_CONTEXT_WINDOW",
        resolved: { tokens: 65536, source: "user" }
      },
      durableReceipts: "unobserved"
    }
  )
  const unset = runConditions({ approvalScope: "any_origin" })
  assert.deepEqual(unset.agentContextWindow, {
    setting: "auto",
    applied: "extension_default",
    resolved: { source: "not_exposed" }
  })
  assert.deepEqual(unset.approvalPolicy, {
    mode: "automatic",
    decision: "approve",
    scope: "any_origin"
  })
  assert.deepEqual(
    runConditions({ contextWindow: "auto", approvalScope: "any_origin" })
      .agentContextWindow.resolved,
    { source: "not_exposed" }
  )
})
