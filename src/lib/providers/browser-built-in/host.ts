import { isTrustedPersistenceSender } from "@/lib/persistence/host-authorization"
import {
  promptAPI,
  createPromptSession,
  promptAvailability,
  TEXT_OPTIONS,
  type PromptSession,
  type PromptMessage
} from "./api"
import type { BrowserModelErrorCode } from "./errors"
import {
  BROWSER_MODEL_PORT,
  HostRequestSchema,
  type HostEvent
} from "./protocol"

/** System policy belongs in initialPrompts; promptStreaming rejects system roles. */
const splitPrompts = (messages: PromptMessage[]) => {
  const policy = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n")
  const conversation = messages.filter((message) => message.role !== "system")
  return {
    initialPrompts: [
      ...(policy ? [{ role: "system" as const, content: policy }] : []),
      ...conversation.slice(0, -1)
    ],
    prompt: conversation.slice(-1)
  }
}

/** Shares the existing offscreen host; never opens a document or a database. */
export const registerBrowserModelHost = (): void => {
  let activeSessions = 0
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== BROWSER_MODEL_PORT) return
    const sender = port.sender
    if (
      !sender ||
      sender.tab ||
      !isTrustedPersistenceSender(
        sender,
        chrome.runtime.id,
        chrome.runtime.getURL("")
      ) ||
      (sender.url && sender.url !== chrome.runtime.getURL("background.js"))
    ) {
      port.disconnect()
      return
    }
    const controller = new AbortController()
    let session: PromptSession | undefined
    let started = false
    let closed = false
    let completed = false
    let leased = false
    let failure: Exclude<BrowserModelErrorCode, "disconnected"> | undefined
    let reader: ReadableStreamDefaultReader<string> | undefined
    const destroySession = () => {
      const current = session
      session = undefined
      try {
        current?.destroy()
      } catch {
        /* AbortSignal may already have destroyed it. */
      }
    }
    const clean = () => {
      clearInterval(heartbeat)
      clearTimeout(deadline)
      destroySession()
      if (leased) {
        activeSessions -= 1
        leased = false
      }
    }
    const close = () => {
      if (closed) return
      closed = true
      controller.abort()
      void reader?.cancel().catch(() => undefined)
      clean()
      try {
        port.disconnect()
      } catch {
        /* Already disconnected. */
      }
    }
    const send = (event: HostEvent): boolean => {
      if (closed || completed) return false
      try {
        port.postMessage(event)
        return true
      } catch {
        close()
        return false
      }
    }
    const finish = (event: HostEvent) => {
      send(event)
      completed = true
      controller.abort()
      clean()
    }
    const heartbeat = setInterval(() => send({ type: "heartbeat" }), 20_000)
    const deadline = setTimeout(() => {
      finish({ type: "error", code: "timeout" })
      close()
    }, 300_000)
    port.onDisconnect.addListener(close)
    port.onMessage.addListener((raw: unknown) => {
      if (started || closed) return
      started = true
      const parsed = HostRequestSchema.safeParse(raw)
      if (!parsed.success) {
        finish({ type: "error", code: "unsupported" })
        return
      }
      void (async () => {
        const availability = await promptAvailability()
        controller.signal.throwIfAborted()
        if (parsed.data.op === "status") {
          finish({ type: "status", availability })
          return
        }
        if (availability !== "available") {
          finish({
            type: "error",
            code: availability === "unavailable" ? "unavailable" : "not-ready"
          })
          return
        }
        const api = promptAPI()
        if (!api) {
          finish({ type: "error", code: "unavailable" })
          return
        }
        if (activeSessions >= 2) {
          finish({ type: "error", code: "busy" })
          return
        }
        const prompts =
          parsed.data.op === "stream"
            ? splitPrompts(parsed.data.messages)
            : undefined
        if (prompts && prompts.prompt.length === 0) {
          finish({ type: "error", code: "unsupported" })
          return
        }
        activeSessions += 1
        leased = true
        session = await createPromptSession({
          ...TEXT_OPTIONS,
          ...(prompts ? { initialPrompts: prompts.initialPrompts } : {}),
          signal: controller.signal
        })
        controller.signal.throwIfAborted()
        if (
          typeof session.promptStreaming !== "function" ||
          typeof session.destroy !== "function"
        ) {
          finish({ type: "error", code: "unsupported" })
          return
        }
        if (!prompts) {
          finish({ type: "status", availability: "available" })
          return
        }
        session.addEventListener(
          "contextoverflow",
          () => {
            failure = "context-too-large"
            controller.abort()
          },
          { once: true }
        )
        reader = session
          .promptStreaming(prompts.prompt, { signal: controller.signal })
          .getReader()
        let outputChars = 0
        let hasText = false
        for (;;) {
          const { done, value } = await reader.read()
          controller.signal.throwIfAborted()
          if (done) break
          if (typeof value !== "string") {
            failure = "unsupported"
            throw new Error("Unsupported stream format")
          }
          outputChars += value.length
          hasText ||= /\S/u.test(value)
          if (outputChars > 8_000_000) {
            failure = "unsupported"
            throw new Error("Response limit exceeded")
          }
          if (!send({ type: "delta", delta: value })) return
        }
        finish(hasText ? { type: "done" } : { type: "error", code: "failed" })
      })()
        .catch((error: unknown) => {
          if (!closed) {
            const name = error instanceof DOMException ? error.name : undefined
            const code =
              name === "QuotaExceededError"
                ? "context-too-large"
                : name === "NotAllowedError"
                  ? "not-ready"
                  : name === "NotSupportedError" || error instanceof TypeError
                    ? "unsupported"
                    : "failed"
            finish({ type: "error", code: failure ?? code })
          }
        })
        .finally(() => {
          try {
            reader?.releaseLock()
          } catch {
            /* A cancelled pending read may still own the lock. */
          }
          clean()
        })
    })
  })
}
