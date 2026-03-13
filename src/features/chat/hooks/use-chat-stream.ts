import { useRef } from "react"
import { useTranslation } from "react-i18next"
import { useToast } from "@/hooks/use-toast"

import { browser } from "@/lib/browser-api"
import { ERROR_MESSAGES, MESSAGE_KEYS } from "@/lib/constants"
import type { ChatMessage } from "@/types"

interface StreamOptions {
  model: string
  messages: ChatMessage[]
  sessionId?: string
  generatedMessage?: ChatMessage
}

interface StreamMessage {
  type?: string
  payload?: {
    sources?: Array<{
      id: string | number
      title: string
      content: string
      score: number
      source?: string
      chunkIndex?: number
      fileId?: string
      type?: string
    }>
    query?: string
  }
  delta?: string
  thinkingDelta?: string
  done?: boolean
  error?: {
    status: number
    message: string
  }
  aborted?: boolean
  metrics?: Record<string, unknown>
}

interface UseChatStreamProps {
  setMessages: (messages: ChatMessage[]) => void
  setIsLoading: (v: boolean) => void
  setIsStreaming: (v: boolean) => void
  onToken?: (token: string) => void
}

type ThinkingParserState = {
  inThinking: boolean
  pending: string
}

const THINK_OPEN_TAGS = ["<think>", "<thinking>", "<reasoning>"]
const THINK_CLOSE_TAGS = ["</think>", "</thinking>", "</reasoning>"]
const MAX_TAG_LENGTH = Math.max(
  ...THINK_OPEN_TAGS.map((tag) => tag.length),
  ...THINK_CLOSE_TAGS.map((tag) => tag.length)
)

const findTag = (text: string, tags: string[]) => {
  let foundIndex = -1
  let foundTag = ""

  for (const tag of tags) {
    const index = text.indexOf(tag)
    if (index === -1) continue
    if (foundIndex === -1 || index < foundIndex) {
      foundIndex = index
      foundTag = tag
    }
  }

  if (foundIndex === -1) {
    return null
  }

  return { index: foundIndex, tag: foundTag }
}

const splitPartialTag = (text: string, tags: string[]) => {
  const maxCheck = Math.min(MAX_TAG_LENGTH - 1, text.length)

  for (let length = maxCheck; length > 0; length -= 1) {
    const tail = text.slice(-length)
    if (tags.some((tag) => tag.startsWith(tail))) {
      return { chunk: text.slice(0, -length), pending: tail }
    }
  }

  return { chunk: text, pending: "" }
}

const splitThinkingDelta = (delta: string, state: ThinkingParserState) => {
  let text = `${state.pending}${delta}`
  state.pending = ""

  if (!state.inThinking && !text.includes("<")) {
    return { visible: text, thinking: "" }
  }

  let visible = ""
  let thinking = ""

  while (text.length > 0) {
    if (state.inThinking) {
      const closeMatch = findTag(text, THINK_CLOSE_TAGS)
      if (!closeMatch) {
        const { chunk, pending } = splitPartialTag(text, THINK_CLOSE_TAGS)
        thinking += chunk
        state.pending = pending
        break
      }

      thinking += text.slice(0, closeMatch.index)
      text = text.slice(closeMatch.index + closeMatch.tag.length)
      state.inThinking = false
      continue
    }

    const openMatch = findTag(text, THINK_OPEN_TAGS)
    if (!openMatch) {
      const { chunk, pending } = splitPartialTag(text, THINK_OPEN_TAGS)
      visible += chunk
      state.pending = pending
      break
    }

    visible += text.slice(0, openMatch.index)
    text = text.slice(openMatch.index + openMatch.tag.length)
    state.inThinking = true
  }

  return { visible, thinking }
}

export const useChatStream = ({
  setMessages,
  setIsLoading,
  setIsStreaming,
  onToken
}: UseChatStreamProps) => {
  const { t } = useTranslation()
  const { toast } = useToast()
  const portRef = useRef<browser.Runtime.Port | null>(null)
  const currentMessagesRef = useRef<ChatMessage[]>([])

  const startStream = ({
    model,
    messages,
    sessionId,
    generatedMessage
  }: StreamOptions) => {
    // Create port synchronously BEFORE any async operations
    const port = browser.runtime.connect({
      name: MESSAGE_KEYS.PROVIDER.STREAM_RESPONSE
    })
    portRef.current = port

    setIsLoading(true)
    setIsStreaming(false)

    const assistantMessage: ChatMessage = generatedMessage || {
      role: "assistant",
      content: "",
      model
    }

    // Initialize with user + assistant shell
    currentMessagesRef.current = [...messages, assistantMessage]
    setMessages(currentMessagesRef.current)

    let firstChunk = true
    const thinkingState: ThinkingParserState = {
      inThinking: false,
      pending: ""
    }

    const listener = (msg: StreamMessage) => {
      if (firstChunk) {
        setIsStreaming(true)
        firstChunk = false
      }

      if (msg.type === "rag_sources" && msg.payload?.sources) {
        assistantMessage.metrics = {
          ...assistantMessage.metrics,
          ragSources: msg.payload.sources,
          ragQuery: msg.payload.query
        }
        return
      }

      let didUpdate = false

      if (msg.thinkingDelta) {
        assistantMessage.thinking = `${assistantMessage.thinking || ""}${msg.thinkingDelta}`
        didUpdate = true
      }

      if (msg.delta !== undefined) {
        const { visible, thinking } = splitThinkingDelta(
          msg.delta,
          thinkingState
        )

        if (thinking) {
          assistantMessage.thinking = `${assistantMessage.thinking || ""}${thinking}`
          didUpdate = true
        }

        if (visible) {
          if (onToken) {
            onToken(visible)
          }

          assistantMessage.content += visible
          didUpdate = true
        }
      }

      if (didUpdate) {
        const updated = [
          ...currentMessagesRef.current.slice(0, -1),
          { ...assistantMessage }
        ]
        currentMessagesRef.current = updated
        setMessages(updated)
      }

      if (msg.done || msg.error || msg.aborted) {
        setIsLoading(false)
        setIsStreaming(false)

        let finalMessages: ChatMessage[]

        if (msg.error) {
          const errMsg =
            ERROR_MESSAGES[msg.error.status] ??
            t("chat.errors.unknown_error", {
              message: msg.error.message || t("chat.errors.no_message")
            })
          finalMessages = [
            ...currentMessagesRef.current.slice(0, -1),
            { role: "assistant", content: errMsg, done: true }
          ]
          toast({
            variant: "destructive",
            title: t("chat.errors.response_failed_title"),
            description:
              msg.error.message || t("chat.errors.unknown_error_description")
          })
        } else {
          finalMessages = [
            ...currentMessagesRef.current.slice(0, -1),
            {
              ...assistantMessage,
              metrics: {
                ...assistantMessage.metrics,
                ...msg.metrics
              },
              done: true
            }
          ]
        }

        currentMessagesRef.current = finalMessages
        setMessages(finalMessages)

        port.onMessage.removeListener(listener)
        port.disconnect()
        portRef.current = null
      }
    }

    port.onMessage.addListener(listener)

    port.postMessage({
      type: MESSAGE_KEYS.PROVIDER.CHAT_WITH_MODEL,
      payload: {
        model,
        messages,
        sessionId
      }
    })
  }

  const stopStream = () => {
    // Handle case where port hasn't been created yet
    if (!portRef.current) {
      console.warn("Stop requested but port not created yet")
      setIsLoading(false)
      setIsStreaming(false)
      return
    }

    try {
      portRef.current.postMessage({
        type: MESSAGE_KEYS.PROVIDER.STOP_GENERATION
      })
    } catch (error) {
      console.error("Failed to send stop message:", error)
    } finally {
      // Always reset state, even if message fails
      setIsLoading(false)
      setIsStreaming(false)
    }
  }

  return {
    startStream,
    stopStream
  }
}
