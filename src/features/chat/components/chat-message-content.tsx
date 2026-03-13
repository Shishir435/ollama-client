import { useEffect, useMemo, useState } from "react"

import { MarkdownRenderer } from "@/components/markdown-renderer"
import { ChatMessageLoadingIndicator } from "@/features/chat/components/chat-message-loading-indicator"
import { ChatMessageMetrics } from "@/features/chat/components/chat-message-metrics"
import { FileAttachmentDisplay } from "@/features/chat/components/file-attachment-display"
import { Brain, ChevronDown } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"
import type { ChatMessage } from "@/types"

export const ChatMessageContent = ({
  msg,
  isUser,
  isLoading = false,
  isStreaming = false
}: {
  msg: ChatMessage
  isUser: boolean
  isLoading?: boolean
  isStreaming?: boolean
}) => {
  const [showThinking, setShowThinking] = useState(false)
  const [userToggledThinking, setUserToggledThinking] = useState(false)

  const hasThinking = !isUser && Boolean(msg.thinking?.trim())
  const showThinkingIndicator =
    !isUser && isLoading && Boolean(msg.thinking?.trim()) && !msg.content.trim()
  const loadingLabel = showThinkingIndicator
    ? "Thinking"
    : isStreaming
      ? "Typing"
      : "Queued"

  const thinkingPreview = useMemo(() => {
    if (!hasThinking) return ""
    const text = msg.thinking?.trim() || ""
    if (text.length <= 220) return text
    return `${text.slice(0, 220)}...`
  }, [hasThinking, msg.thinking])

  const reasoningId = useMemo(() => {
    const base = msg.id ?? msg.timestamp ?? "message"
    return `reasoning-${String(base)}`
  }, [msg.id, msg.timestamp])
  const reasoningButtonId = useMemo(() => {
    const base = msg.id ?? msg.timestamp ?? "message"
    return `reasoning-button-${String(base)}`
  }, [msg.id, msg.timestamp])
  const messageKey = `${msg.id ?? ""}:${msg.timestamp ?? ""}`

  useEffect(() => {
    void messageKey
    setUserToggledThinking(false)
    setShowThinking(false)
  }, [messageKey])

  useEffect(() => {
    if (isUser || !hasThinking || userToggledThinking) return
    const autoOpen = isStreaming || showThinkingIndicator
    setShowThinking(autoOpen)
  }, [
    hasThinking,
    isStreaming,
    isUser,
    showThinkingIndicator,
    userToggledThinking
  ])

  useEffect(() => {
    if (isUser || userToggledThinking) return
    if (!isStreaming && !isLoading) {
      setShowThinking(false)
    }
  }, [isLoading, isStreaming, isUser, userToggledThinking])

  return (
    <div
      className={cn(
        "w-full max-w-[90vw] rounded-xl p-3 text-sm shadow-xs sm:max-w-2xl sm:p-4",
        "hover:shadow-md",
        isUser
          ? "bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-100"
          : "bg-gray-50 text-gray-900 dark:bg-gray-800 dark:text-gray-100",
        "border",
        isUser
          ? "border-gray-300 dark:border-gray-600"
          : "border-gray-200 dark:border-gray-700"
      )}>
      {/* File Attachments */}
      {msg.attachments && msg.attachments.length > 0 && (
        <FileAttachmentDisplay attachments={msg.attachments} />
      )}
      {hasThinking && (
        <div className="group mb-2 rounded-lg border border-muted-foreground/15 bg-linear-to-b from-muted/40 to-transparent px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
          <button
            type="button"
            id={reasoningButtonId}
            aria-expanded={showThinking}
            aria-controls={reasoningId}
            className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-0.5 text-[11px] font-medium text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50"
            onClick={() => {
              setShowThinking((prev) => !prev)
              setUserToggledThinking(true)
            }}>
            <span className="flex items-center gap-2">
              <Brain className="size-3" />
              <span>Reasoning</span>
              {isStreaming && (
                <span className="ml-1 inline-flex size-1.5 animate-pulse rounded-full bg-emerald-400/80" />
              )}
            </span>
            <span className="flex items-center gap-1">
              <span>{showThinking ? "Hide" : "Show"}</span>
              <ChevronDown
                className={`size-3 transition ${
                  showThinking ? "rotate-180" : ""
                }`}
              />
            </span>
          </button>
          {!showThinking && thinkingPreview ? (
            <button
              type="button"
              className="mt-1 line-clamp-2 w-full text-left text-xs italic text-foreground/55 transition group-hover:text-foreground/70"
              onClick={() => {
                setShowThinking(true)
                setUserToggledThinking(true)
              }}>
              {thinkingPreview}
            </button>
          ) : null}
          {showThinking && (
            <div
              id={reasoningId}
              className="mt-2 border-l-2 border-emerald-400/40 pl-3 text-xs italic text-foreground/70">
              <MarkdownRenderer content={msg.thinking ?? ""} />
            </div>
          )}
        </div>
      )}
      <div className="prose prose-sm prose-gray max-w-none dark:prose-invert">
        <MarkdownRenderer content={msg.content} />
        {isLoading && !isUser && (
          <ChatMessageLoadingIndicator
            label={loadingLabel}
            showDots={isStreaming}
          />
        )}
        {!isUser && msg.done && msg.metrics && (
          <ChatMessageMetrics metrics={msg.metrics} />
        )}
      </div>
    </div>
  )
}
