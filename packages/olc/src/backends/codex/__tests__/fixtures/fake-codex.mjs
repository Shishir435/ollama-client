#!/usr/bin/env node
import readline from "node:readline"

const lines = readline.createInterface({ input: process.stdin })
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)

lines.on("line", (line) => {
  const message = JSON.parse(line)
  if (message.method === "initialize") {
    send({ id: message.id, result: { userAgent: "fake-codex" } })
    return
  }
  if (message.method === "model/list") {
    send({
      id: message.id,
      result: {
        data: [
          {
            id: "fake-codex",
            displayName: "Fake Codex",
            inputModalities: ["text", "image"],
            supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
            defaultReasoningEffort: "medium",
            isDefault: true
          }
        ],
        nextCursor: null
      }
    })
    return
  }
  if (message.method === "thread/start") {
    const valid =
      message.params?.approvalPolicy === "never" &&
      message.params?.sandbox === "read-only" &&
      message.params?.ephemeral === true &&
      message.params?.developerInstructions === "Stay concise" &&
      message.params?.dynamicTools?.[0]?.name === "lookup"
    if (!valid) {
      send({
        id: message.id,
        error: { code: -32602, message: "invalid thread policy" }
      })
      return
    }
    send({ id: message.id, result: { thread: { id: "thread-1" } } })
    return
  }
  if (message.method === "turn/start") {
    send({ id: message.id, result: { turn: { id: "turn-1" } } })
    send({
      id: "dynamic-tool-1",
      method: "item/tool/call",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        callId: "call-1",
        namespace: null,
        tool: "lookup",
        arguments: { query: "answer" }
      }
    })
    return
  }
  if (message.id === "dynamic-tool-1" && message.result) {
    send({
      method: "item/reasoning/summaryTextDelta",
      params: { threadId: "thread-1", turnId: "turn-1", delta: "Checked. " }
    })
    send({
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", turnId: "turn-1", delta: "Result: 42" }
    })
    send({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "completed", error: null }
      }
    })
    return
  }
  if (message.id !== undefined) send({ id: message.id, result: {} })
})
