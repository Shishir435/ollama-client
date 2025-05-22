import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { useAutoResizeTextarea } from "@/hooks/use-auto-resize-textarea"
import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constant"
import { cn } from "@/lib/utils"
import { Circle, Send } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { useStorage } from "@plasmohq/storage/hook"

import BugReportIcon from "./bug-report-icon"
import { MarkdownRenderer } from "./markdown-renderer"
import ModelMenu from "./model-menu"
import SettingsButton from "./settings-button"
import WelcomeScreen from "./welcome-screen"

type Role = "user" | "assistant"

interface ChatMessage {
  role: Role
  content: string
}

function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [selectedModel] = useStorage<string>(
    STORAGE_KEYS.OLLAMA.SELECTED_MODEL,
    ""
  )
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useAutoResizeTextarea(textareaRef, input)

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const sendMessage = async () => {
    if (!input.trim()) return

    const userMessage: ChatMessage = { role: "user", content: input }
    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    setInput("")
    setIsLoading(true)

    chrome.runtime.sendMessage(
      {
        type: MESSAGE_KEYS.OLLAMA.CHAT_WITH_MODEL,
        payload: {
          model: selectedModel,
          messages: newMessages
        }
      },
      (response) => {
        setIsLoading(false)
        if (response.success) {
          const lastMessage = response.data.choices?.[0]?.message
          if (lastMessage?.role && lastMessage?.content) {
            setMessages([...newMessages, lastMessage])
          } else {
            setMessages([
              ...newMessages,
              { role: "assistant", content: "❌ Invalid response from model." }
            ])
          }
        } else {
          setMessages([
            ...newMessages,
            { role: "assistant", content: `❌ Error: ${response.error}` }
          ])
        }
      }
    )
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !isLoading) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className="flex h-screen flex-col rounded-md p-1">
      {messages.length === 0 ? (
        <WelcomeScreen />
      ) : (
        <ScrollArea className="flex-1 scrollbar-none">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={cn(
                "my-1 rounded-md p-3 text-sm",
                msg.role === "user"
                  ? "ml-auto max-w-[80%] self-end bg-blue-100 text-blue-900"
                  : "mr-auto max-w-[80%] self-start bg-gray-200 text-gray-900"
              )}>
              {msg.role === "assistant" ? (
                <MarkdownRenderer content={msg.content} />
              ) : (
                msg.content
              )}
            </div>
          ))}
          <div ref={scrollRef} />
        </ScrollArea>
      )}

      <div className="sticky bottom-0 z-10 w-full">
        <div className="relative h-auto">
          <Textarea
            id="chat-input-textarea"
            ref={textareaRef}
            placeholder="Type your message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="max-h-[300px] min-h-[80px] w-full resize-none overflow-hidden rounded-b-2xl pb-10"
            autoFocus
          />
          <div className="absolute bottom-0 left-2 flex items-center gap-2">
            <ModelMenu />
            <SettingsButton />
            <BugReportIcon />
          </div>
          <Button
            onClick={sendMessage}
            disabled={isLoading}
            className="absolute right-0 top-1/2 mr-2 -translate-y-1/2">
            {isLoading ? <Circle size="16" /> : <Send size="16" />}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default Chat
