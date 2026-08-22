#!/usr/bin/env node
import { appendFileSync } from "node:fs"
import readline from "node:readline"

const lines = readline.createInterface({ input: process.stdin })
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
const imageThreads = new Set()
const delayedImageThreads = new Set()
const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXsAAAAASUVORK5CYII="

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
  if (message.method === "modelProvider/capabilities/read") {
    send({
      id: message.id,
      result: { namespaceTools: true, imageGeneration: true, webSearch: true }
    })
    return
  }
  if (message.method === "thread/start") {
    const isImage = message.params?.developerInstructions?.includes(
      "built-in image generation tool"
    )
    if (isImage) {
      const threadId =
        message.params?.model === "fake-codex-delayed"
          ? "thread-image-delayed"
          : "thread-image"
      imageThreads.add(threadId)
      if (threadId === "thread-image-delayed") delayedImageThreads.add(threadId)
      send({ id: message.id, result: { thread: { id: threadId } } })
      return
    }
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
    if (imageThreads.has(message.params?.threadId)) {
      if (delayedImageThreads.has(message.params?.threadId)) {
        appendFileSync("turn-start-pending", "1")
        setTimeout(
          () =>
            send({ id: message.id, result: { turn: { id: "turn-delayed" } } }),
          100
        )
        return
      }
      send({ id: message.id, result: { turn: { id: "turn-image" } } })
      send({
        method: "item/completed",
        params: {
          threadId: "thread-image",
          turnId: "turn-image",
          item: {
            type: "imageGeneration",
            id: "image-1",
            status: "completed",
            revisedPrompt: "A tiny red square",
            result: ONE_PIXEL_PNG
          }
        }
      })
      send({
        method: "turn/completed",
        params: {
          threadId: "thread-image",
          turn: { id: "turn-image", status: "completed", error: null }
        }
      })
      return
    }
    if (message.params?.effort !== "medium") {
      send({
        id: message.id,
        error: { code: -32602, message: "invalid reasoning effort" }
      })
      return
    }
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
  if (message.method === "turn/interrupt") {
    appendFileSync("interrupts", `${message.params?.turnId}\n`)
    send({ id: message.id, result: {} })
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
