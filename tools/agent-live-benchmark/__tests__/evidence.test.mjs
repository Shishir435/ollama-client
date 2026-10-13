import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import {
  appendFailureDigest,
  callTimeline,
  decisionTrace,
  failureDigest,
  plainQualificationState,
  recordFixtureRequest,
  scrubSecrets,
  streamedToolCalls,
  writeAttemptEvidence
} from "../evidence.mjs"

const sse = (...frames) =>
  `${frames.map((frame) => `data: ${JSON.stringify(frame)}`).join("\n")}\ndata: [DONE]\n`

const decisionCall = {
  path: "/v1/chat/completions",
  started: 1_100,
  elapsedMs: 900,
  status: 200,
  retries: 1,
  request: { tools: [{ function: { name: "agent_decision" } }] },
  response: sse(
    {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                function: { name: "agent_decision", arguments: '{"action":' }
              }
            ]
          }
        }
      ]
    },
    {
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, function: { arguments: '"click"}' } }]
          }
        }
      ]
    },
    { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    { usage: { prompt_tokens: 1200, completion_tokens: 40 } }
  )
}
const chatCall = {
  path: "/v1/chat/completions",
  started: 2_500,
  elapsedMs: 300,
  status: 200,
  request: { tools: [{ function: { name: "browser_task" } }] },
  response: sse(
    { choices: [{ delta: { content: "I couldn't find " } }] },
    { choices: [{ delta: { content: "the button." }, finish_reason: "stop" }] }
  )
}

test("streamed tool-call fragments are reassembled", () => {
  assert.deepEqual(streamedToolCalls(decisionCall.response), [
    { name: "agent_decision", arguments: '{"action":"click"}' }
  ])
})

test("the timeline says where each call's time and tokens went", () => {
  assert.deepEqual(callTimeline([decisionCall, chatCall], 1_000), [
    {
      phase: "decision",
      atMs: 100,
      elapsedMs: 900,
      status: 200,
      retries: 1,
      promptTokens: 1200,
      completionTokens: 40,
      finish: "tool_calls",
      tools: ["agent_decision"]
    },
    {
      phase: "chat",
      atMs: 1_500,
      elapsedMs: 300,
      status: 200,
      finish: "stop",
      tools: []
    }
  ])
  assert.deepEqual(decisionTrace([decisionCall, chatCall]), [
    '{"action":"click"}'
  ])
})

test("a failure digest carries the codes, retries, decisions and replies", () => {
  const digest = failureDigest(
    {
      task: "traps_validation",
      attempt: 2,
      verdict: "reported_failure",
      failureOrigin: "plan",
      successClaimed: "not_claimed",
      status: "answered_in_chat",
      answer: "x".repeat(1_000)
    },
    [decisionCall, chatCall]
  )
  assert.equal(digest.retries, 1)
  assert.deepEqual(digest.lastDecisions, ['{"action":"click"}'])
  assert.equal(digest.chatText, "I couldn't find the button.")
  assert.equal(digest.answer.length, 400)
})

test("fixture requests are logged with the status they were answered with", () => {
  const log = []
  const res = new EventEmitter()
  recordFixtureRequest(log, { method: "POST", url: "/q/a/effect/save" }, res)
  res.statusCode = 422
  res.emit("finish")
  assert.equal(log[0].status, 422)
  assert.equal(log[0].path, "/q/a/effect/save")
  recordFixtureRequest(undefined, { method: "GET", url: "/" }, res)
})

test("evidence is written privately, without images or credentials", () => {
  const dir = mkdtempSync(join(tmpdir(), "evidence-"))
  try {
    writeAttemptEvidence(join(dir, "a-1", "local-debug"), {
      wire: [
        {
          request: {
            headers: { authorization: "Bearer secret" },
            messages: [{ content: [{ type: "image_url", image_url: "data:" }] }]
          }
        }
      ],
      qualificationState: plainQualificationState({
        task: { id: "t", family: "traps", goal: "long" },
        reads: new Set(["/q/t"]),
        effects: []
      })
    })
    const text = readFileSync(
      join(dir, "a-1", "local-debug", "evidence.json"),
      "utf8"
    )
    assert.ok(!text.includes("secret"))
    assert.ok(!text.includes("data:"))
    assert.deepEqual(JSON.parse(text).qualificationState.reads, ["/q/t"])
    appendFailureDigest(join(dir, "local-debug"), { task: "a" })
    appendFailureDigest(join(dir, "local-debug"), { task: "b" })
    assert.equal(
      readFileSync(join(dir, "local-debug", "failures.jsonl"), "utf8")
        .trim()
        .split("\n").length,
      2
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("credentials inside strings are scrubbed from evidence, request paths and digests", () => {
  assert.equal(
    scrubSecrets("upstream said: Authorization: Bearer abcdef0123456789"),
    "upstream said: Authorization: Bearer [REDACTED]"
  )
  assert.equal(
    scrubSecrets("/q/a/search?q=kettle&api_key=s3cr3tvalue&page=2"),
    "/q/a/search?q=kettle&api_key=[REDACTED]&page=2"
  )
  assert.equal(
    scrubSecrets("key sk-or-v1-0123456789abcdef0123 leaked"),
    "key [REDACTED] leaked"
  )
  assert.equal(
    scrubSecrets("Status: Active. Offer 1 costs 12."),
    "Status: Active. Offer 1 costs 12."
  )

  const log = []
  recordFixtureRequest(
    log,
    { method: "GET", url: "/q/a?token=abc123&q=x" },
    new EventEmitter()
  )
  assert.equal(log[0].path, "/q/a?token=[REDACTED]&q=x")

  const dir = mkdtempSync(join(tmpdir(), "evidence-"))
  try {
    writeAttemptEvidence(dir, {
      wire: [{ response: "error: invalid Bearer abcdefghijkl0123" }]
    })
    assert.ok(
      !readFileSync(join(dir, "evidence.json"), "utf8").includes("abcdefghijkl")
    )
    appendFailureDigest(dir, { answer: "used password=hunter22 to sign in" })
    assert.ok(
      !readFileSync(join(dir, "failures.jsonl"), "utf8").includes("hunter22")
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
