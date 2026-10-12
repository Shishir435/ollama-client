#!/usr/bin/env node
import { appendFileSync } from "node:fs"
import readline from "node:readline"

const lines = readline.createInterface({ input: process.stdin })
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
const imageThreads = new Set()
const delayedImageThreads = new Set()
const nativeSearchThreads = new Set()
const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXsAAAAASUVORK5CYII="

const handleInitialize = (message) => {
  send({ id: message.id, result: { userAgent: "fake-codex" } })
}

const handleModelList = (message) => {
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
}

const handleCapabilities = (message) => {
  send({
    id: message.id,
    result: { namespaceTools: true, imageGeneration: true, webSearch: true }
  })
}

const isImageThreadRequest = (message) => {
  const instructions = message.params?.developerInstructions
  return (
    instructions?.includes("$imagegen") &&
    instructions?.includes("image_gen") &&
    instructions?.includes("do not complete the turn without an image")
  )
}

const handleThreadStart = (message) => {
  appendFileSync("thread-starts.jsonl", `${JSON.stringify(message.params)}\n`)
  appendFileSync("argv.json", `${JSON.stringify(process.argv.slice(2))}\n`)
  if (isImageThreadRequest(message)) {
    const threadId =
      message.params?.model === "fake-codex-delayed"
        ? "thread-image-delayed"
        : "thread-image"
    imageThreads.add(threadId)
    if (threadId === "thread-image-delayed") delayedImageThreads.add(threadId)
    send({ id: message.id, result: { thread: { id: threadId } } })
    return
  }

  const nativeSearch = message.params?.config?.web_search !== "disabled"
  const valid =
    message.params?.approvalPolicy === "never" &&
    message.params?.sandbox === "read-only" &&
    message.params?.ephemeral === true &&
    message.params?.developerInstructions?.startsWith("Stay concise") &&
    message.params?.dynamicTools?.[0]?.name === "lookup"
  if (!valid) {
    send({
      id: message.id,
      error: { code: -32602, message: "invalid thread policy" }
    })
    return
  }
  const threadId = nativeSearch ? "thread-search" : "thread-1"
  if (nativeSearch) nativeSearchThreads.add(threadId)
  send({ id: message.id, result: { thread: { id: threadId } } })
}

const completeNativeSearchTurn = (message) => {
  const threadId = message.params?.threadId
  send({ id: message.id, result: { turn: { id: "turn-search" } } })
  send({
    method: "item/started",
    params: {
      threadId,
      turnId: "turn-search",
      item: {
        type: "agentMessage",
        id: "commentary-1",
        phase: "commentary",
        text: ""
      }
    }
  })
  send({
    method: "item/agentMessage/delta",
    params: {
      threadId,
      turnId: "turn-search",
      itemId: "commentary-1",
      delta: "Checking sources."
    }
  })
  send({
    method: "item/completed",
    params: {
      threadId,
      turnId: "turn-search",
      item: {
        type: "agentMessage",
        id: "commentary-1",
        phase: "commentary",
        text: "Checking sources."
      }
    }
  })
  send({
    method: "item/started",
    params: {
      threadId,
      turnId: "turn-search",
      item: { type: "webSearch", id: "search-1", query: "", action: null }
    }
  })
  send({
    method: "item/completed",
    params: {
      threadId,
      turnId: "turn-search",
      item: {
        type: "webSearch",
        id: "search-1",
        query: "current answer",
        action: { type: "search", query: "current answer" },
        results: [
          {
            type: "text_result",
            title: "Current answer",
            url: "https://example.com/current"
          }
        ]
      }
    }
  })
  send({
    method: "item/started",
    params: {
      threadId,
      turnId: "turn-search",
      item: {
        type: "agentMessage",
        id: "final-1",
        phase: "final_answer",
        text: ""
      }
    }
  })
  send({
    method: "item/agentMessage/delta",
    params: {
      threadId,
      turnId: "turn-search",
      itemId: "final-1",
      delta: "Verified answer."
    }
  })
  send({
    method: "turn/completed",
    params: {
      threadId,
      turn: { id: "turn-search", status: "completed", error: null }
    }
  })
}

const completeImageTurn = (message) => {
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
}

const handleImageTurnStart = (message) => {
  const threadId = message.params?.threadId
  if (delayedImageThreads.has(threadId)) {
    appendFileSync("turn-start-pending", "1")
    setTimeout(
      () => send({ id: message.id, result: { turn: { id: "turn-delayed" } } }),
      100
    )
    return
  }
  completeImageTurn(message)
}

const handleTurnStart = (message) => {
  if (imageThreads.has(message.params?.threadId)) {
    handleImageTurnStart(message)
    return
  }
  if (nativeSearchThreads.has(message.params?.threadId)) {
    completeNativeSearchTurn(message)
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
  /**
   * The call and a notification in one write, so the proxy reads both in the
   * same tick: the call parks the leg, and the notification must still reach
   * the leg that resumes it rather than be lost to the suspension.
   */
  process.stdout.write(
    `${JSON.stringify({
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
    })}\n${JSON.stringify({
      method: "item/reasoning/summaryTextDelta",
      params: { threadId: "thread-1", turnId: "turn-1", delta: "Waiting. " }
    })}\n`
  )
  /**
   * After the call, as a live App Server sends it: the tool is dispatched as
   * soon as the model emits it, and usage lands when the response completes.
   */
  setTimeout(() => sendTokenUsage({ inputTokens: 1000, outputTokens: 50 }), 50)
}

const handleTurnInterrupt = (message) => {
  appendFileSync("interrupts", `${message.params?.turnId}\n`)
  send({ id: message.id, result: {} })
}

/** The thread's running usage, as `thread/tokenUsage/updated` reports it. */
const sendTokenUsage = (total) =>
  send({
    method: "thread/tokenUsage/updated",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      tokenUsage: {
        total: {
          cachedInputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: total.inputTokens + total.outputTokens,
          ...total
        },
        last: total,
        modelContextWindow: 272000
      }
    }
  })

const handleToolResult = () => {
  sendTokenUsage({
    inputTokens: 2500,
    outputTokens: 120,
    cachedInputTokens: 900,
    reasoningOutputTokens: 40
  })
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
}

const handleConfigRead = (message) => {
  send({
    id: message.id,
    result: {
      config: {
        mcp_servers: { alpha: { command: "alpha" }, "beta-docs": { url: "x" } }
      },
      origins: {}
    }
  })
}

/** Ephemeral threads cannot be deleted, exactly as the real App Server says. */
const handleThreadClose = (message) => {
  appendFileSync(
    "thread-closes.jsonl",
    `${JSON.stringify({ method: message.method, ...message.params })}\n`
  )
  if (message.method === "thread/delete") {
    send({
      id: message.id,
      error: { code: -32600, message: "thread is not persisted" }
    })
    return
  }
  send({ id: message.id, result: {} })
}

const handlers = new Map([
  ["config/read", handleConfigRead],
  ["thread/delete", handleThreadClose],
  ["thread/unsubscribe", handleThreadClose],
  ["initialize", handleInitialize],
  ["model/list", handleModelList],
  ["modelProvider/capabilities/read", handleCapabilities],
  ["thread/start", handleThreadStart],
  ["turn/start", handleTurnStart],
  ["turn/interrupt", handleTurnInterrupt]
])

lines.on("line", (line) => {
  const message = JSON.parse(line)
  const handler = handlers.get(message.method)
  if (handler) {
    handler(message)
    return
  }
  if (message.id === "dynamic-tool-1" && message.result) {
    handleToolResult()
    return
  }
  if (message.id !== undefined) send({ id: message.id, result: {} })
})
